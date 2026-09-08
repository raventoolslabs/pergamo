import path from 'path';
import mime from 'mime-types';

import Config from '@/shared/config';
import { sha256File } from '@/shared/hash';
import { Document, DocumentMetadata } from '@/domain/entities/document';
import { ValidationError } from '@/domain/exceptions/domain.exception';
import { DocumentDeps } from '../dependencies';
import { inspectUpload, verifyContent } from '../inspect-upload';

export interface UploadedFile {
  path: string;
  originalname: string;
  mimetype: string;
  size: number;
}

export interface UploadDocumentInput {
  organization: string;
  file: UploadedFile;
  trace: string;
}

export const uploadDocument = async (input:UploadDocumentInput, deps:DocumentDeps):Promise<Document> => {

  const { organization, file, trace } = input;

  // La comprobacion de la allowlist va antes del escaneo: no cuesta E/S y
  // evita transmitir a clamd ficheros que se van a rechazar igualmente.
  if(!Config.valid_mimetype.includes(file.mimetype)) throw new ValidationError(
    'INVALID_MIMETYPE', `Invalid mimetype "${file.mimetype}"`);

  const scan = await inspectUpload(file.path, file.mimetype, deps, trace);

  // Despues del escaneo, para que un infectado se rechace como infectado y no
  // por un desajuste de firma.
  await verifyContent(file.path, file.mimetype, deps);

  const metadata:DocumentMetadata = {
    name: path.parse(file.originalname).name,
    original_name: file.originalname,
    mimetype: file.mimetype,
    extension: mime.extension(file.mimetype) as string,
    hash: await sha256File(file.path) as string,
    // Dato del deposito, como el hash: se fija aqui y no se recalcula. Los
    // documentos anteriores a esta clave no lo tienen.
    size: file.size,
    tags: []
  };

  // Se confirma en base de datos solo despues de que el fichero este en su
  // sitio: un fallo del `mv` dejaria una fila sin contenido.
  return deps.unitOfWork.run(async (scope) => {

    const document = await deps.documents.create(organization, metadata, scan, scope);

    await deps.storage.move(file.path, deps.storage.resolve(organization, document.path));

    return document;
  });
}
