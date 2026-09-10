import { Job, Queue } from 'bullmq';
import Redis from 'ioredis';

import Config from '@/shared/config';
import log from '@/shared/logger';
import { RescanQueue, SweepState, SweepStatus } from '@/app/ports/services/rescan-queue.service';
import { connection, RESCAN_JOB_NAME, RESCAN_QUEUE_NAME } from './connection';

let queue:Queue = null;
let redis:Redis = null;

/** Perezosa, como la del indice: sin barridos no se abre conexion con Redis. */
const get = () => {

  if(!queue) {
    redis = connection();
    queue = new Queue(RESCAN_QUEUE_NAME, { connection: redis, prefix: Config.queue.prefix });
  }

  return queue;
}

/**
 * Un trabajo por organizacion, y el identificador es el control: dos peticiones
 * seguidas no pueden dejar dos barridos recorriendo el mismo corpus.
 *
 * Sin dos puntos: BullMQ los rechaza en un identificador propio, porque son los
 * que separa sus claves de Redis.
 */
const sweepId = (organization:string) => `${RESCAN_JOB_NAME}--${organization}`;

const LIVE:SweepStatus[] = ['queued', 'running'];

const stateOf = async (job:Job):Promise<SweepState> => {

  const status = await job.getState();

  // 'waiting-children' y 'prioritized' no se usan aqui, pero el tipo de BullMQ
  // los incluye: lo que no sea terminado ni fallido es un barrido vivo.
  const mapped:SweepStatus =
    status === 'completed' ? 'done'
    : status === 'failed' ? 'failed'
    : status === 'active' ? 'running'
    : 'queued';

  return {
    status: mapped,
    progress: ((mapped === 'done' ? job.returnvalue : null) || job.progress || undefined) as SweepState['progress'],
    error: status === 'failed' ? job.failedReason : undefined
  };
}

export const rescanQueue:RescanQueue = {

  async enqueueSweep(organization) {

    const id = sweepId(organization);
    const existing = await get().getJob(id);

    if(existing) {

      const state = await stateOf(existing);

      // Ya hay uno recorriendo el corpus: se devuelve ese en vez de encolar un
      // segundo. Pedirlo dos veces no es un error de quien llama.
      if(LIVE.includes(state.status)) return state;

      // Y si termino hay que RETIRARLO antes de volver a encolar: BullMQ ignora
      // en silencio un add cuyo identificador siga en completados o fallidos.
      await existing.remove();
    }

    const job = await get().add(RESCAN_JOB_NAME, { organization }, {
      jobId: id,
      // Sin reintento: el barrido solo aborta entero cuando el escaner no
      // contesta, y volver a lanzarlo contra un clamd caido no arregla nada.
      attempts: 1,
      // Se conserva una hora para poder contar como fue el ultimo barrido.
      removeOnComplete: { age: 3600 },
      removeOnFail: { age: 3600 }
    });

    log.info(`Rescan sweep queued for organization ${organization}`);

    return stateOf(job);
  },

  async sweepState(organization) {

    const job = await get().getJob(sweepId(organization));

    return job ? stateOf(job) : { status: 'idle' };
  },

  // BullMQ no cierra una conexion que se le entrega hecha: la cierra quien la creo.
  async close() {

    if(!queue) return;

    const [closingQueue, closingRedis] = [queue, redis];
    queue = null;
    redis = null;

    await closingQueue.close();
    await closingRedis.quit().catch(() => closingRedis.disconnect());
  }
};
