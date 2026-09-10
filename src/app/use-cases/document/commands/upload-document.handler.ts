import path from 'path';
import mime from 'mime-types';

import Config from '@/shared/config';
import log from '@/shared/logger';
import { sha256File } from '@/shared/hash';
import { Document, DocumentMetadata } from '@/domain/entities/document';
import { ValidationError } from '@/domain/exceptions/domain.exception';
import { IndexStatus } from '@/domain/value-objects/index-status';
import { isQuarantined } from '@/domain/value-objects/scan-status';
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
  index: boolean;
  trace: string;
}

export const uploadDocument = async (input:UploadDocumentInput, deps:DocumentDeps):Promise<Document> => {

  const { organization, file, index, trace } = input;

  // Lo primero de todo: pedir indexacion en un despliegue que no la tiene es un
  // 400 y no un silencio. El cliente no debe creer que tiene vectores.
  if(index && !Config.indexing.enabled) throw new ValidationError(
    'INDEXING_DISABLED', 'This deployment does not index documents');

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

  // Lo retenido no se abre, asi que un deposito en cuarentena no entra en la
  // cola aunque se haya pedido indexarlo. La regla es la misma que la de la
  // entrega y no «solo lo aprobado»: exigir 'clean' dejaria sin indice a todo
  // despliegue sin antivirus, y tambien a lo depositado con clamd caido.
  const indexStatus:IndexStatus = index && !isQuarantined(scan.scanStatus) ? 'pending' : 'none';

  // Se confirma en base de datos solo despues de que el fichero este en su
  // sitio: un fallo del `mv` dejaria una fila sin contenido.
  const document = await deps.unitOfWork.run(async (scope) => {

    const created = await deps.documents.create(organization, metadata, scan, indexStatus, scope);

    await deps.storage.move(file.path, deps.storage.resolve(organization, created.path));

    return created;
  });

  // Despues del commit, y sin poder tumbar la subida: Redis caido no invalida
  // un deposito ya confirmado, y el barrido de reserva lo recupera.
  if(indexStatus === 'pending') {
    deps.queue.enqueue(document.id, organization)
      .catch((error:any) => log.error(`${trace} | Document ${document.id} stored but not queued: ${error.message}`));
  }

  return document;
}
