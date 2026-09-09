import path from 'path';
import mime from 'mime-types';

import Config from '@/shared/config';
import log from '@/shared/logger';
import { sha256File } from '@/shared/hash';
import { Document } from '@/domain/entities/document';
import { isQuarantined } from '@/domain/value-objects/scan-status';
import { ValidationError } from '@/domain/exceptions/domain.exception';
import { DocumentDeps } from '../dependencies';
import { inspectUpload, verifyContent } from '../inspect-upload';
import { getDocument } from '../queries/get-document.handler';
import { UploadedFile } from './upload-document.handler';

export interface ModifyDocumentFileInput {
  organization: string;
  id: string;
  file: UploadedFile;
  // Ausente conserva la intencion anterior; true y false la cambian.
  index?: boolean;
  trace: string;
}

export const modifyDocumentFile = async (input:ModifyDocumentFileInput, deps:DocumentDeps):Promise<Document> => {

  const { organization, id, file, index, trace } = input;

  // Por delante incluso de la propiedad, como en la subida: es una propiedad
  // del despliegue —/config ya la publica— y no dice nada del documento pedido.
  if(index && !Config.indexing.enabled) throw new ValidationError(
    'INDEXING_DISABLED', 'This deployment does not index documents');

  // La propiedad va primero: con el escaneo delante, un tenant podia forzar
  // analisis de 50 MB contra identificadores ajenos y recibir el 404 despues.
  const current = await getDocument(organization, id, deps);

  if(file.mimetype !== current.metadata.mimetype) throw new ValidationError(
    'INVALID_MIMETYPE', 'Invalid mimetype');

  const scan = await inspectUpload(file.path, file.mimetype, deps, trace);

  await verifyContent(file.path, file.mimetype, deps);

  const metadata = {
    ...current.metadata,
    name: path.parse(file.originalname).name,
    original_name: file.originalname,
    mimetype: file.mimetype,
    extension: mime.extension(file.mimetype) as string,
    hash: await sha256File(file.path) as string
  };

  const hadIndex = current.index.status !== 'none';

  // Reemplazar el fichero no desindexa por omision: sin '?index' se conserva lo
  // que hubiera. Con el se pide o se retira de forma expresa, y es la unica via
  // para sacar un documento de 'none' sin reindexar el corpus entero.
  const wantIndex = index ?? hadIndex;

  // Con la indexacion apagada no se hereda una intencion que nadie puede
  // cumplir: quedaria en 'pending' contra una cola sin consumidor.
  const willIndex = wantIndex && Config.indexing.enabled && !isQuarantined(scan.scanStatus);

  // Se confirma en base de datos solo despues de que el fichero este en su
  // sitio, para no dejar metadatos describiendo un contenido que no existe.
  const document = await deps.unitOfWork.run(async (scope) => {

    const updated = await deps.documents.replaceFile(organization, id, metadata, scan, scope);

    // Los vectores del contenido anterior se van aunque ya no se quiera indice:
    // dejarlos los haria buscables apuntando a un fichero que ya no esta.
    if(hadIndex || wantIndex) {
      await deps.chunks.deleteByDocument(id, scope);
      await deps.documents.setIndexStatus(id, willIndex ? 'pending' : 'none', null, scope);
    }

    const filePath = deps.storage.resolve(organization, updated.path);

    if(Config.max_version_file > 1) await deps.storage.archiveVersion(id, filePath);

    await deps.storage.move(file.path, filePath);

    return updated;
  });

  if(willIndex) {
    deps.queue.enqueue(id, organization)
      .catch((error:any) => log.error(`${trace} | Document ${id} replaced but not queued: ${error.message}`));
  }

  return document;
}
