import { StoredVersion } from '@/app/ports/services/file-storage.service';
import { DocumentDeps } from '../dependencies';
import { getDocument } from './get-document.handler';

export const listDocumentVersions = async (organization:string, id:string, deps:DocumentDeps):Promise<StoredVersion[]> => {

  const document = await getDocument(organization, id, deps);

  return deps.storage.listVersions(deps.storage.resolve(organization, document.path));
}
