import Redis from 'ioredis';

import Config from '@/shared/config';

export const QUEUE_NAME = 'document-index';
export const JOB_NAME = 'index-document';

// Cola propia y no un nombre de trabajo mas en la del indice: son dos ritmos
// distintos —un barrido del corpus entero contra documentos sueltos— y comparten
// worker, no turno.
export const RESCAN_QUEUE_NAME = 'document-rescan';
export const RESCAN_JOB_NAME = 'sweep-pending-documents';

/**
 * BullMQ EXIGE maxRetriesPerRequest a null: con el valor por defecto, ioredis
 * aborta los comandos bloqueantes con los que el worker espera trabajo.
 */
export const connection = () => new Redis(Config.queue.redis_url, {
  maxRetriesPerRequest: null
});
