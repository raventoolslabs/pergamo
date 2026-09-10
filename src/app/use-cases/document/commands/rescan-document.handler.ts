import Config from '@/shared/config';
import log from '@/shared/logger';
import { Document } from '@/domain/entities/document';
import { ScanRecord } from '@/app/ports/repositories/document.repository';
import { ScannerUnavailableError } from '@/domain/exceptions/scanner-unavailable.exception';
import { LockedError, ServiceUnavailableError, ValidationError } from '@/domain/exceptions/domain.exception';
import { DocumentDeps } from '../dependencies';
import { getDocument } from '../queries/get-document.handler';

export interface RescanDocumentInput {
  organization: string;
  id: string;
  trace: string;
}

/**
 * Reanalisis de un documento ya depositado, con la misma politica que el
 * barrido de `npm run scan:rescan`.
 *
 * No mira el contenido activo, que si mira el deposito: esa cuarentena solo se
 * levanta a mano, y un boton que puede imponerla convierte una comprobacion
 * rutinaria en una decision que nadie pidio tomar.
 */
export const rescanDocument = async (input:RescanDocumentInput, deps:DocumentDeps):Promise<Document> => {

  const { organization, id, trace } = input;

  const document = await getDocument(organization, id, deps);

  // La propiedad primero, como en el reemplazo: sin esto un tenant averigua que
  // identificadores ajenos existen por el error que recibe.
  if(!Config.enable_antivirus) throw new ValidationError(
    'ANTIVIRUS_DISABLED', 'This deployment has no scanner to rescan with');

  // Retenido por lo que lleva dentro, no por una firma: el escaner lo
  // encontraria limpio y liberaria justo lo que se decidio retener.
  if(document.scanStatus === 'malicious') throw new LockedError(
    'SCAN_NOT_CLEAN',
    `Document is quarantined: it carries active content (${document.scanSignature}). ` +
    'A rescan does not clear this state: it requires a manual review.');

  const filePath = deps.storage.resolve(organization, document.path);

  const record = async (scan:ScanRecord) => deps.documents.recordScan(organization, id, scan);

  // Que el fichero falte no es un veredicto favorable: se marca 'error' y sale
  // de la cola del barrido, porque otro escaneo no lo devuelve a su sitio.
  if(!await deps.storage.exists(filePath)) {
    log.warn(`${trace} | Document ${id}: file not found at ${filePath}`);
    return record({
      scanStatus: 'error',
      scanSignature: 'FILE_MISSING',
      scanEngine: null,
      scanDate: new Date()
    });
  }

  try {

    const result = await deps.scanner.check(filePath);

    if(result.infected) log.warn(`${trace} | Document ${id} QUARANTINED: ${result.signature}`);

    return await record({
      scanStatus: result.infected ? 'infected' : 'clean',
      scanSignature: result.infected ? result.signature ?? null : null,
      scanEngine: result.engine,
      scanDate: new Date()
    });

  } catch(error:any) {

    if(!(error instanceof ScannerUnavailableError)) throw error;

    // El veredicto guardado se queda como estaba: un analisis que no llego a
    // correr no puede degradar lo que si dijo el anterior.
    log.error(`${trace} | Rescan of document ${id} could not run: ${error.message}`);

    throw new ServiceUnavailableError(
      'SCANNER_UNAVAILABLE', 'The scanner did not answer: the document keeps its previous verdict');
  }
}
