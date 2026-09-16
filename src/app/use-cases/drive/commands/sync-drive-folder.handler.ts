import path from 'path';
import mime from 'mime-types';

import Config from '@/shared/config';
import log from '@/shared/logger';
import { DocumentMetadata, RemoteSource } from '@/domain/entities/document';
import { DriveFile, SyncProgress } from '@/domain/entities/drive';
import { IndexStatus } from '@/domain/value-objects/index-status';
import { RemoteState, ScanRecord } from '@/app/ports/repositories/document.repository';
import { DriveDeps } from '../dependencies';

export interface SyncDriveFolderInput {
  organization: string;
  folder: string;
  trace: string;
  report?: (progress:SyncProgress) => Promise<void> | void;
}

const PAGE_SIZE = 1000;
const DISCHARGE_BATCH = 500;
const REPORT_EVERY = 50;

// Sin veredicto: lo analiza el barrido de pendientes, bajandolo por DocumentContent.
const PENDING_SCAN:ScanRecord = { scanStatus: 'pending', scanSignature: null, scanEngine: null, scanDate: null };

// Los binarios traen md5; los nativos no, y su version sube con cada cambio.
const revisionOf = (file:DriveFile) => file.md5Checksum ?? `${file.version}:${file.modifiedTime}`;

const metadataOf = (file:DriveFile, revision:string):DocumentMetadata => {

  const extension = mime.extension(file.mimetype) as string;
  // Un nativo exportado no trae extension en el nombre; un binario si.
  const exported = !path.extname(file.name) || mime.lookup(file.name) !== file.mimetype;

  return {
    name: exported ? file.name : path.parse(file.name).name,
    original_name: exported ? `${file.name}.${extension}` : file.name,
    mimetype: file.mimetype,
    extension,
    // Solo tiene que cambiar si y solo si cambia el contenido: lo usa finishIndexing.
    hash: `drive:${revision}`,
    size: file.size,
    tags: []
  };
};

const loadRemoteState = async (organization:string, deps:DriveDeps) => {

  const known = new Map<string, RemoteState>();

  for(let afterId:string = null; ;) {
    const page = await deps.documents.listRemoteState(organization, afterId, PAGE_SIZE);
    page.forEach((state) => known.set(state.fileId, state));
    if(page.length < PAGE_SIZE) return known;
    afterId = page[page.length - 1].id;
  }
};

/**
 * Diff entre lo importado y lo que hay hoy en la carpeta. No hay caso de uso de
 * importar: importar es esto contra un lado vacio. Tampoco hay checkpoint: si
 * algo corta, la siguiente pasada recalcula el diff.
 */
export const syncDriveFolder = async (input:SyncDriveFolderInput, deps:DriveDeps):Promise<SyncProgress> => {

  const { organization, trace, report } = input;

  const progress:SyncProgress = { seen: 0, created: 0, updated: 0, restored: 0, discharged: 0, skipped: 0 };

  const folder = await deps.folders.findById(organization, input.folder);

  // Se quito mientras esperaba en la cola.
  if(!folder) return progress;

  // ponytail: el estado remoto de la organizacion entera en memoria; es una
  // proyeccion de cinco columnas, paginar el diff si llega a millones.
  const known = await loadRemoteState(organization, deps);
  const toIndex:string[] = [];
  let walkCompleted = false;
  let failure:Error = null;

  try {

    for await (const file of deps.drive.walk(organization, folder.folderId)) {

      progress.seen++;
      if(report && progress.seen % REPORT_EVERY === 0) await report({ ...progress });

      if(!Config.valid_mimetype.includes(file.mimetype) || (file.size ?? 0) > Config.max_file_size) {
        progress.skipped++;
        continue;
      }

      const revision = revisionOf(file);
      const state = known.get(file.id);
      known.delete(file.id);

      // De otra carpeta sincronizada que tambien lo contiene: es suyo.
      if(state && state.folder !== null && state.folder !== folder.id) continue;

      const remote:RemoteSource = { fileId: file.id, folder: folder.id, revision, viewLink: file.viewLink };
      const metadata = metadataOf(file, revision);
      // En una revision nueva se mezcla con lo guardado: sin `tags`, el cliente
      // no pierde sus etiquetas porque cambie el fichero.
      const { tags, ...revised } = metadata;

      if(!state) {

        const indexStatus:IndexStatus = folder.indexDocuments ? 'pending' : 'none';
        const created = await deps.documents.create(organization, metadata, PENDING_SCAN, indexStatus, undefined, remote);

        progress.created++;
        if(indexStatus === 'pending') toIndex.push(created.id);

      } else if(state.discharged || state.revision !== revision || state.folder === null) {

        // Revivido, decide la carpeta; cambiado, se reindexa solo lo que tenia indice.
        const indexStatus:IndexStatus = state.discharged ?
          (folder.indexDocuments ? 'pending' : 'none') :
          (state.indexStatus === 'none' ? 'none' : 'pending');

        // Solo adoptado, sin cambios: conserva veredicto e indice.
        const changed = state.discharged || state.revision !== revision;
        await deps.documents.updateRemote(organization, state.id, revised, remote,
          changed ? PENDING_SCAN : null, changed ? indexStatus : null);

        if(state.discharged) progress.restored++;
        else if(changed) progress.updated++;
        if(changed && indexStatus === 'pending') toIndex.push(state.id);
      }
    }

    walkCompleted = true;

  } catch(error:any) {
    failure = error;
    log.error(`${trace} | Drive sync of folder ${folder.id} aborted after ${progress.seen} files: ${error.message}`);
  }

  // Solo con el recorrido completo: uno cortado a mitad por la red o la cuota
  // daria de baja todo lo que no llego a ver.
  if(walkCompleted) {

    const gone = [...known.values()]
      .filter((state) => state.folder === folder.id && !state.discharged)
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

  await deps.folders.recordSync(folder.id, new Date(), failure?.message);

  // Despues de escribir: Redis caido no deshace lo sincronizado, y el barrido de
  // reserva de la indexacion recoge los 'pending'.
  for(const id of toIndex) {
    await deps.indexQueue.enqueue(id, organization)
      .catch((error:any) => log.error(`${trace} | Document ${id} synced but not queued: ${error.message}`));
  }

  if(report) await report({ ...progress });

  log.info(`${trace} | Drive sync of folder ${folder.id}: ${JSON.stringify(progress)}`);

  if(failure) throw failure;

  return progress;
}
