import Redis from 'ioredis';

import Config from '@/shared/config';

export const QUEUE_NAME = 'document-index';
export const JOB_NAME = 'index-document';

/**
 * BullMQ EXIGE maxRetriesPerRequest a null: con el valor por defecto, ioredis
 * aborta los comandos bloqueantes con los que el worker espera trabajo.
 */
export const connection = () => new Redis(Config.indexing.redis_url, {
  maxRetriesPerRequest: null
});
