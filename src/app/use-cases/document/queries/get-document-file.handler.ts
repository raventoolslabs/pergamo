import { Document } from '@/domain/entities/document';
import { NotFoundError } from '@/domain/exceptions/domain.exception';
import { DocumentDeps } from '../dependencies';
import { assertNotQuarantined } from '../quarantine';
import { getDocument } from './get-document.handler';

export interface DocumentFile {
  document: Document;
  filePath: string;
  // Lo llama quien entrega, al cerrarse la respuesta: el temporal de Drive muere con ella.
  release(): Promise<void>;
}

export const getDocumentFile = async (organization:string, id:string, deps:DocumentDeps):Promise<DocumentFile> => {

  const document = await getDocument(organization, id, deps);

  assertNotQuarantined(document);

  const content = await deps.content.fetch(document);

  if(!content) throw new NotFoundError('FILE_MISSING', `The file of document ${id} is missing`);

  return { document, ...content };
}
