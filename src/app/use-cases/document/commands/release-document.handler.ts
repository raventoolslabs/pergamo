import log from '@/shared/logger';
import { Document } from '@/domain/entities/document';
import { ValidationError } from '@/domain/exceptions/domain.exception';
import { ScanStatus } from '@/domain/value-objects/scan-status';
import { DocumentDeps } from '../dependencies';
import { getDocument } from '../queries/get-document.handler';

export interface ReleaseDocumentInput {
  organization: string;
  id: string;
  trace: string;
}

/**
 * Lo que se libera es una retencion sobre un fichero que esta: una firma que
 * resulto ser un falso positivo, o un contenido activo que alguien ha revisado.
 *
 * 'error' no entra: ahi falta el fichero del almacen, y marcarlo 'clean' seria
 * afirmar que se entrega algo que no existe.
 */
const RELEASABLE:ScanStatus[] = ['infected', 'malicious'];

/**
 * Misma politica que `npm run scan:release`: pasa a 'clean' CONSERVANDO la
 * firma, para que siga siendo trazable y se pueda decidir si merece entrar en
 * las exclusiones del escaner. El fichero no se toca: alterarlo destruiria su
 * hash y su firma electronica.
 */
export const releaseDocument = async (input:ReleaseDocumentInput, deps:DocumentDeps):Promise<Document> => {

  const { organization, id, trace } = input;

  const document = await getDocument(organization, id, deps);

  if(!RELEASABLE.includes(document.scanStatus)) throw new ValidationError(
    'NOT_QUARANTINED', `Document is not under a quarantine that can be lifted (${document.scanStatus})`);

  log.warn(`${trace} | Document ${id} released from "${document.scanStatus}" to "clean". Retained signature: ${document.scanSignature || 'none'}`);

  return deps.documents.recordScan(organization, id, {
    scanStatus: 'clean',
    scanSignature: document.scanSignature ?? null,
    scanEngine: document.scanEngine ?? null,
    scanDate: new Date()
  });
}
