import { DocumentListFilter, DocumentPage } from '@/app/ports/repositories/document.repository';
import { ValidationError } from '@/domain/exceptions/domain.exception';
import { DocumentDeps } from '../dependencies';

export const listDocuments = async (filter:DocumentListFilter, deps:DocumentDeps):Promise<DocumentPage> => {

  // El token master no lleva organizacion: sin este corte la consulta filtra
  // por undefined y el master creeria que no hay documentos.
  if(!filter.organization) throw new ValidationError('ORGANIZATION_REQUIRED',
    'A master token has no organization: log in as an organization to list documents');

  return deps.documents.list(filter);
}
