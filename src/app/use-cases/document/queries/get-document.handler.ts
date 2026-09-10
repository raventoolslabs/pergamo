import { Document } from '@/domain/entities/document';
import { NotFoundError, ValidationError } from '@/domain/exceptions/domain.exception';
import { DocumentDeps } from '../dependencies';

/**
 * Lectura por identificador dentro de la organizacion del solicitante. Es el
 * unico camino por el que se resuelve un documento, asi que el aislamiento
 * entre organizaciones no depende de que cada endpoint se acuerde de filtrar.
 */
export const getDocument = async (organization:string, id:string, deps:DocumentDeps):Promise<Document> => {

  // El token master no lleva organizacion, y sin este corte la consulta se
  // queda sin el parametro y revienta con un 500 opaco. Mismo mensaje que en
  // listDocuments: el problema es la sesion, no el documento.
  if(!organization) throw new ValidationError('ORGANIZATION_REQUIRED',
    'A master token has no organization: log in as an organization to read documents');

  const document = await deps.documents.findById(organization, id);

  if(!document) throw new NotFoundError('NO_CONTENT', `Document with id ${id} not exists`);

  return document;
}
