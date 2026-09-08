import path from 'path';
import mime from 'mime-types';

import Config from '@/shared/config';
import { sha256File } from '@/shared/hash';
import { Document } from '@/domain/entities/document';
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

  // Se confirma en base de datos solo despues de que el fichero este en su
  // sitio, para no dejar metadatos describiendo un contenido que no existe.
  return deps.unitOfWork.run(async (scope) => {

    const document = await deps.documents.replaceFile(organization, id, metadata, scan, scope);

    const filePath = deps.storage.resolve(organization, document.path);

    if(Config.max_version_file > 1) await deps.storage.archiveVersion(id, filePath);

    await deps.storage.move(file.path, filePath);

    return document;
  });
}
