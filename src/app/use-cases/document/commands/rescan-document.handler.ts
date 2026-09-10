import Config from '@/shared/config';
import log from '@/shared/logger';
import { Document } from '@/domain/entities/document';
import { ScannerUnavailableError } from '@/domain/exceptions/scanner-unavailable.exception';
import { LockedError, ServiceUnavailableError, ValidationError } from '@/domain/exceptions/domain.exception';
import { DocumentDeps } from '../dependencies';
import { exceedsScanLimit, scanStoredFile } from '../scan-stored-file';
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

  // 'error' es un fichero que no esta en el almacen. Volver a mirar donde ya no
  // hay nada solo reescribe el mismo estado: lo que falta es revisar el volumen.
  if(document.scanStatus === 'error') throw new ValidationError(
    'FILE_MISSING', 'The file is missing from storage: a rescan cannot bring it back');

  if(exceedsScanLimit(document)) throw new ValidationError(
    'FILE_TOO_LARGE_TO_SCAN',
    `File is larger than the ${Config.max_file_size} bytes the scanner reads: it cannot be scanned`);

  try {

    const { document: scanned } = await scanStoredFile(document, deps, trace);

    return scanned;

  } catch(error:any) {

    if(!(error instanceof ScannerUnavailableError)) throw error;

    // El veredicto guardado se queda como estaba: un analisis que no llego a
    // correr no puede degradar lo que si dijo el anterior.
    log.error(`${trace} | Rescan of document ${id} could not run: ${error.message}`);

    throw new ServiceUnavailableError(
      'SCANNER_UNAVAILABLE', 'The scanner did not answer: the document keeps its previous verdict');
  }
}
