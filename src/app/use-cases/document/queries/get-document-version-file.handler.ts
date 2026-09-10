import { NotFoundError } from '@/domain/exceptions/domain.exception';
import { Document } from '@/domain/entities/document';
import { DocumentDeps } from '../dependencies';
import { assertNotQuarantined } from '../quarantine';
import { getDocument } from './get-document.handler';

export interface DocumentVersionFile {
  document: Document;
  filePath: string;
}

/**
 * Una version archivada es el mismo contenido que el documento, una copia atras,
 * asi que pasa por la misma puerta de cuarentena: retener el fichero actual y
 * entregar el anterior no retiene nada.
 *
 * Lo que sale es el ZIP que dejo `archiveVersion`, no el fichero original.
 */
export const getDocumentVersionFile = async (organization:string, id:string, version:number, deps:DocumentDeps):Promise<DocumentVersionFile> => {

  const document = await getDocument(organization, id, deps);

  assertNotQuarantined(document);

  const filePath = deps.storage.resolveVersion(
    deps.storage.resolve(organization, document.path), version);

  if(!await deps.storage.exists(filePath)) throw new NotFoundError(
    'VERSION_NOT_FOUND', `Document ${id} has no version ${version}`);

  return { document, filePath };
}
