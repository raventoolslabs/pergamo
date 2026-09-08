import { Document } from '@/domain/entities/document';
import { NotFoundError } from '@/domain/exceptions/domain.exception';
import { DocumentDeps } from '../dependencies';

/**
 * Lectura por identificador dentro de la organizacion del solicitante. Es el
 * unico camino por el que se resuelve un documento, asi que el aislamiento
 * entre organizaciones no depende de que cada endpoint se acuerde de filtrar.
 */
export const getDocument = async (organization:string, id:string, deps:DocumentDeps):Promise<Document> => {

  const document = await deps.documents.findById(organization, id);

  if(!document) throw new NotFoundError('NO_CONTENT', `Document with id ${id} not exists`);

  return document;
}
