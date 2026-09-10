import { Document } from '@/domain/entities/document';
import { DocumentDeps } from '../dependencies';
import { assertNotQuarantined } from '../quarantine';
import { getDocument } from './get-document.handler';

export interface DocumentFile {
  document: Document;
  filePath: string;
}

export const getDocumentFile = async (organization:string, id:string, deps:DocumentDeps):Promise<DocumentFile> => {

  const document = await getDocument(organization, id, deps);

  assertNotQuarantined(document);

  return { document, filePath: deps.storage.resolve(organization, document.path) };
}
