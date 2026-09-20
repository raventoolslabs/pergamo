import path from 'path';
import { randomUUID } from 'crypto';

import Config from '@/shared/config';
import log from '@/shared/logger';
import { DocumentMetadata, RemoteSource } from '@/domain/entities/document';
import { SyncProgress } from '@/domain/entities/remote';
import { githubFileId, GitHubFile, GitHubRepository, isExcluded, MARKDOWN_MIMETYPE } from '@/domain/entities/github';
import { IndexStatus } from '@/domain/value-objects/index-status';
import { RemoteState, ScanRecord } from '@/app/ports/repositories/document.repository';
import { GitHubDeps } from '../dependencies';

export interface SyncGitHubRepositoryInput {
  organization: string;
  repository: string;
  trace: string;
  report?: (progress:SyncProgress) => Promise<void> | void;
}

const PAGE_SIZE = 1000;
const DISCHARGE_BATCH = 500;
const REPORT_EVERY = 50;

// Sin veredicto: lo analiza el barrido de pendientes, bajandolo por DocumentContent.
const PENDING_SCAN:ScanRecord = { scanStatus: 'pending', scanSignature: null, scanEngine: null, scanDate: null };

// Renombrar un fichero es dar de baja un documento y crear otro: la identidad es
// la ruta, igual que en Git.
const fileIdOf = (repository:GitHubRepository, filePath:string) => githubFileId({
  owner: repository.owner, repository: repository.repository, branch: repository.branch, path: filePath
});

const metadataOf = (repository:GitHubRepository, file:GitHubFile):DocumentMetadata => ({
  // La ruta entera, que es lo unico que distingue los veinte README.md de un repositorio.
  name: file.path.replace(/\.(md|markdown)$/i, ''),
  original_name: path.basename(file.path),
  mimetype: MARKDOWN_MIMETYPE,
  extension: path.extname(file.path).slice(1).toLowerCase(),
  // Solo tiene que cambiar si y solo si cambia el contenido: el sha del blob es
  // el hash del contenido, asi que lo cumple por construccion. Lo usa finishIndexing.
  hash: `github:${file.sha}`,
  size: file.size,
  // De donde salio, para quien lea los metadatos del documento.
  repository: repository.name,
  branch: repository.branch,
  path: file.path,
  tags: []
});

const loadRemoteState = async (organization:string, deps:GitHubDeps) => {

  const known = new Map<string, RemoteState>();

  for(let afterId:string = null; ;) {
    const page = await deps.documents.listRemoteState(organization, 'github', afterId, PAGE_SIZE);
    page.forEach((state) => known.set(state.fileId, state));
    if(page.length < PAGE_SIZE) return known;
    afterId = page[page.length - 1].id;
  }
};

/**
 * Diff entre lo importado y lo que hay hoy en la rama, igual que el de Drive.
 *
 * Lo primero es el commit: si la rama no ha avanzado desde la ultima pasada no
 * hay nada que comparar, y el recorrido del arbol se ahorra entero. Cuando si ha
 * avanzado, lo que decide documento a documento es el sha del blob.
 */
export const syncGitHubRepository = async (input:SyncGitHubRepositoryInput, deps:GitHubDeps):Promise<SyncProgress> => {

  const { organization, trace, report } = input;

  const progress:SyncProgress = { seen: 0, created: 0, updated: 0, restored: 0, discharged: 0, skipped: 0 };

  const repository = await deps.repositories.findById(organization, input.repository);

  // Se quito mientras esperaba en la cola.
  if(!repository) return progress;

  const head = await deps.github.head(organization, repository.owner, repository.repository, repository.branch);

  if(head === repository.lastCommit) {
    await deps.repositories.recordSync(repository.id, new Date(), head);
    log.info(`${trace} | GitHub repository ${repository.id} already at ${head}: nothing to sync`);
    return progress;
  }

  // ponytail: el estado remoto de la organizacion entera en memoria; es una
  // proyeccion de cinco columnas, paginar el diff si llega a millones.
  const known = await loadRemoteState(organization, deps);
  const toIndex:string[] = [];
  let walkCompleted = false;
  let failure:Error = null;

  try {

    for await (const file of deps.github.walk(organization, repository.owner, repository.repository, head)) {

      progress.seen++;
      if(report && progress.seen % REPORT_EVERY === 0) await report({ ...progress });

      // Lo excluido no se toca aqui y tampoco se borra de `known`: si ya estaba
      // archivado, la baja de mas abajo lo retira, y quitar la exclusion lo revive.
      if(isExcluded(file.path, repository.excludes) || file.size > Config.max_file_size) {
        progress.skipped++;
        continue;
      }

      const fileId = fileIdOf(repository, file.path);
      const state = known.get(fileId);
      known.delete(fileId);

      const unchanged = state && !state.discharged && state.revision === file.sha && state.folder === repository.id;
      if(unchanged) continue;

      const remote:RemoteSource = {
        source: 'github', fileId, folder: repository.id, revision: file.sha, viewLink: file.viewLink
      };

      // Antes de tocar la base: si la copia falla, la fila conserva su revision
      // y la siguiente pasada vuelve a intentarlo.
      let copy = repository.storeContent ? await download(repository, file, deps) : null;

      // Sin versionado: el historial de un documento de GitHub es el del repositorio.
      const store = async (relative:string) => {
        if(!copy) return;
        await deps.storage.move(copy, deps.storage.resolve(organization, relative));
        copy = null;
      };

      try {

        if(!state) {

          const indexStatus:IndexStatus = repository.indexDocuments ? 'pending' : 'none';
          const created = await deps.documents.create(
            organization, metadataOf(repository, file), PENDING_SCAN, indexStatus, undefined, remote);

          await store(created.path);

          progress.created++;
          if(indexStatus === 'pending') toIndex.push(created.id);

        } else {

          // Revivido, decide el repositorio; cambiado, se reindexa solo lo que tenia indice.
          const indexStatus:IndexStatus = state.discharged ?
            (repository.indexDocuments ? 'pending' : 'none') :
            (state.indexStatus === 'none' ? 'none' : 'pending');

          // Solo adoptado, sin cambios: conserva veredicto e indice.
          const changed = state.discharged || state.revision !== file.sha;

          // En una revision nueva se mezcla con lo guardado: sin `tags`, el
          // cliente no pierde sus etiquetas porque cambie el fichero.
          const { tags, ...revised } = metadataOf(repository, file);

          const updated = await deps.documents.updateRemote(organization, state.id, revised, remote,
            changed ? PENDING_SCAN : null, changed ? indexStatus : null);

          if(changed) await store(updated.path);

          if(state.discharged) progress.restored++;
          else if(changed) progress.updated++;
          if(changed && indexStatus === 'pending') toIndex.push(state.id);
        }

      } finally {
        // Si no llego a su sitio, no deja rastro en temporal.
        if(copy) await deps.storage.removeTemp(copy).catch(() => {});
      }
    }

    walkCompleted = true;

  } catch(error:any) {
    failure = error;
    log.error(`${trace} | GitHub sync of repository ${repository.id} aborted after ${progress.seen} files: ${error.message}`);
  }

  // Solo con el recorrido completo: uno cortado a mitad por la red o la cuota
  // daria de baja todo lo que no llego a ver.
  if(walkCompleted) {

    const gone = [...known.values()]
      .filter((state) => state.folder === repository.id && !state.discharged)
      .map((state) => state.id);

    for(let start = 0; start < gone.length; start += DISCHARGE_BATCH) {

      const batch = gone.slice(start, start + DISCHARGE_BATCH);

      await deps.unitOfWork.run(async (scope) => {
        for(const id of batch) await deps.chunks.deleteByDocument(id, scope);
        await deps.documents.discharge(organization, batch, scope);
      });

      progress.discharged += batch.length;
    }
  }

  // El commit solo avanza con la pasada entera y sin fallo: si no, la siguiente
  // vuelve a comparar el arbol contra lo archivado.
  await deps.repositories.recordSync(repository.id, new Date(),
    walkCompleted && !failure ? head : null, failure?.message);

  // Despues de escribir: Redis caido no deshace lo sincronizado, y el barrido de
  // reserva de la indexacion recoge los 'pending'.
  for(const id of toIndex) {
    await deps.indexQueue.enqueue(id, organization)
      .catch((error:any) => log.error(`${trace} | Document ${id} synced but not queued: ${error.message}`));
  }

  if(Config.enable_antivirus && progress.created + progress.updated + progress.restored > 0) {
    await deps.rescanQueue.enqueueSweep(organization)
      .catch((error:any) => log.error(`${trace} | GitHub sync done but the scan sweep was not queued: ${error.message}`));
  }

  if(report) await report({ ...progress });

  log.info(`${trace} | GitHub sync of repository ${repository.id}: ${JSON.stringify(progress)}`);

  if(failure) throw failure;

  return progress;
}

/**
 * La copia en Pergamo, para los repositorios que la piden: asi el documento se
 * puede descargar y reindexar aunque la API deje de estar disponible. Sin ella,
 * el binario se baja de GitHub cada vez que se necesita.
 */
const download = async (repository:GitHubRepository, file:GitHubFile, deps:GitHubDeps):Promise<string | null> => {

  const target = path.join(Config.tmp_base, `github-${randomUUID()}`);

  const downloaded = await deps.github.download(
    repository.organization, repository.owner, repository.repository, file.sha, target);

  if(downloaded) return target;

  // El blob ya no esta: se archiva la fila igual, y el contenido lo resolvera la
  // API o la siguiente pasada.
  await deps.storage.removeTemp(target).catch(() => {});
  return null;
};
