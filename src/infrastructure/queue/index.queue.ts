import { Queue } from 'bullmq';
import Redis from 'ioredis';

import Config from '@/shared/config';
import log from '@/shared/logger';
import { IndexQueue } from '@/app/ports/services/index-queue.service';
import { connection, JOB_NAME, QUEUE_NAME } from './connection';

let queue:Queue = null;
let redis:Redis = null;

/**
 * Perezosa a proposito: con la indexacion desactivada no se abre conexion con
 * Redis, y las pruebas que no la usan no se quedan colgadas esperando a que se
 * cierre un socket que nadie pidio.
 */
const get = () => {

  if(!queue) {
    redis = connection();
    queue = new Queue(QUEUE_NAME, { connection: redis, prefix: Config.indexing.queue_prefix });
  }

  return queue;
}

export const indexQueue:IndexQueue = {

  async enqueue(document, organization) {

    await get().add(JOB_NAME, { document, organization }, {
      // Idempotencia por identificador de documento, con la trampa que hay que
      // conocer: mientras el trabajo siga en el conjunto de completados, un add
      // con el mismo id SE IGNORA EN SILENCIO. De ahi removeOnComplete.
      jobId: document,
      attempts: 3,
      backoff: { type: 'exponential', delay: 30000 },
      removeOnComplete: true,
      removeOnFail: { age: 604800 }
    });

    log.debug(`Document ${document} queued for indexing`);
  },

  // BullMQ no cierra una conexion que se le entrega hecha: la deja abierta y el
  // proceso no termina. Se cierra aqui, que es quien la creo.
  async close() {

    if(!queue) return;

    const [closingQueue, closingRedis] = [queue, redis];
    queue = null;
    redis = null;

    await closingQueue.close();
    await closingRedis.quit().catch(() => closingRedis.disconnect());
  }
};
