import { Document } from '@/domain/entities/document';
import { LockedError } from '@/domain/exceptions/domain.exception';
import { isQuarantined } from '@/domain/value-objects/scan-status';
import { DocumentDeps } from '../dependencies';
import { getDocument } from './get-document.handler';

// El motivo viaja en el 423 porque cada uno se resuelve de otra manera:
// 'infected' y 'malicious' exigen revision, 'error' exige mirar el almacen.
const quarantineReason = (document:Document) => {

  if(document.scanStatus === 'infected')
    return `Document is quarantined: detected as ${document.scanSignature}`;

  if(document.scanStatus === 'malicious')
    return `Document is quarantined: it carries active content (${document.scanSignature}). ` +
      'A rescan does not clear this state: it requires a manual review.';

  return 'Document file is missing from storage: it cannot be delivered until the deployment is reviewed';
}

export interface DocumentFile {
  document: Document;
  filePath: string;
}

export const getDocumentFile = async (organization:string, id:string, deps:DocumentDeps):Promise<DocumentFile> => {

  const document = await getDocument(organization, id, deps);

  // Solo aqui, no al leer metadatos: los de un documento retenido si deben
  // poder consultarse, porque es como el cliente descubre por que lo esta.
  if(isQuarantined(document.scanStatus)) throw new LockedError(
    'SCAN_NOT_CLEAN', quarantineReason(document));

  return { document, filePath: deps.storage.resolve(organization, document.path) };
}
