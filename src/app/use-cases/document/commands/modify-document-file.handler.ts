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
  trace: string;
}

export const modifyDocumentFile = async (input:ModifyDocumentFileInput, deps:DocumentDeps):Promise<Document> => {

  const { organization, id, file, trace } = input;

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

  // Reemplazar el fichero no puede desindexar un documento por omision: se
  // conserva la intencion, se tiran los vectores del contenido anterior y
  // vuelve a la cola. Dejarlos hasta que el trabajo corra los haria buscables
  // apuntando a un contenido que ya no esta.
  const reindex = current.index.status !== 'none';

  // Se confirma en base de datos solo despues de que el fichero este en su
  // sitio, para no dejar metadatos describiendo un contenido que no existe.
  const document = await deps.unitOfWork.run(async (scope) => {

    const updated = await deps.documents.replaceFile(organization, id, metadata, scan, scope);

    if(reindex) {
      await deps.chunks.deleteByDocument(id, scope);
      await deps.documents.setIndexStatus(
        id, isQuarantined(scan.scanStatus) ? 'none' : 'pending', null, scope);
    }

    const filePath = deps.storage.resolve(organization, updated.path);

    if(Config.max_version_file > 1) await deps.storage.archiveVersion(id, filePath);

    await deps.storage.move(file.path, filePath);

    return updated;
  });

  if(reindex && !isQuarantined(scan.scanStatus)) {
    deps.queue.enqueue(id, organization)
      .catch((error:any) => log.error(`${trace} | Document ${id} replaced but not queued: ${error.message}`));
  }

  return document;
}
