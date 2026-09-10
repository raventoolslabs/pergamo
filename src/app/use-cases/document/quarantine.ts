import { Document } from '@/domain/entities/document';
import { LockedError } from '@/domain/exceptions/domain.exception';
import { isQuarantined } from '@/domain/value-objects/scan-status';

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

/**
 * Puerta unica de la cuarentena, y por eso vive aqui y no dentro de la descarga:
 * el fichero y el texto que se extrajo de el son el mismo contenido, asi que
 * retener uno y entregar el otro no retiene nada.
 *
 * No se aplica al leer metadatos: es como el cliente descubre por que esta
 * bloqueado.
 */
export const assertNotQuarantined = (document:Document) => {

  if(isQuarantined(document.scanStatus)) throw new LockedError(
    'SCAN_NOT_CLEAN', quarantineReason(document));
}
