import Config from '@/shared/config';
import log from '@/shared/logger';
import { Document } from '@/domain/entities/document';
import { isQuarantined } from '@/domain/value-objects/scan-status';
import { LockedError, ServiceUnavailableError, ValidationError } from '@/domain/exceptions/domain.exception';
import { DocumentDeps } from '../dependencies';
import { getDocument } from '../queries/get-document.handler';

export interface ReindexDocumentInput {
  organization: string;
  id: string;
  trace: string;
}

/**
 * Vuelve a encolar la indexacion de un documento ya depositado, sin tocar su
 * fichero: es la unica via para indexar lo que se deposito sin pedirlo, y para
 * recuperar un trabajo que se perdio.
 *
 * Los trozos anteriores no se borran aqui. El fichero no ha cambiado, asi que
 * siguen describiendolo, y el trabajo los reemplaza al terminar: borrarlos
 * ahora dejaria el documento fuera de las busquedas mientras dura la cola.
 */
export const reindexDocument = async (input:ReindexDocumentInput, deps:DocumentDeps):Promise<Document> => {

  const { organization, id, trace } = input;

  // La propiedad primero, como en el reanalisis: sin esto un tenant averigua
  // que identificadores ajenos existen por el error que recibe.
  const document = await getDocument(organization, id, deps);

  if(!Config.indexing.enabled) throw new ValidationError(
    'INDEXING_DISABLED', 'This deployment does not index documents');

  // Lo retenido no se abre, y convertir es abrirlo con un parser. Misma regla
  // que en el deposito y que en el propio trabajo de indexacion.
  if(isQuarantined(document.scanStatus)) throw new LockedError(
    'SCAN_NOT_CLEAN', 'Document is quarantined: its content is not opened, so it cannot be indexed');

  // 'pending' si entra: es justo el estado en el que queda un encolado que
  // fallo, y volver a pedirlo es lo unico que lo saca de ahi. Con un worker
  // dentro del documento, en cambio, una segunda pasada duplicaria el trabajo.
  if(document.index.status === 'indexing') throw new ValidationError(
    'INDEXING_IN_PROGRESS', 'The document is being indexed right now: wait for that run to finish');

  await deps.documents.setIndexStatus(id, 'pending');

  // Redis caido deja el documento en 'pending' contra una cola que no lo tiene,
  // que es exactamente lo que este caso de uso arregla: se dice, y quien pidio
  // la indexacion puede volver a pedirla.
  try {

    await deps.queue.enqueue(id, organization);

  } catch(error:any) {

    log.error(`${trace} | Document ${id} marked for indexing but not queued: ${error.message}`);

    throw new ServiceUnavailableError(
      'QUEUE_UNAVAILABLE', 'The indexing queue did not answer: the document is marked, but nothing is running yet');
  }

  return getDocument(organization, id, deps);
}
