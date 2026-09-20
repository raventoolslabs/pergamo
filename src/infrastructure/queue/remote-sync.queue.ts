import { Job, Queue } from 'bullmq';
import Redis from 'ioredis';

import Config from '@/shared/config';
import log from '@/shared/logger';
import { SyncQueue, SyncState, SyncStatus } from '@/app/ports/services/sync-queue.service';
import { connection } from './connection';

export interface RemoteSyncQueueOptions {
  queueName: string;
  jobName: string;
  // Se lee en cada llamada: el intervalo es configuracion, no un valor de arranque.
  interval: () => number;
  // Para el log, que es lo unico que distingue a una cola de otra.
  label: string;
}

const LIVE:SyncStatus[] = ['queued', 'running'];

const JOB_OPTIONS = {
  // Sin reintento inmediato: la siguiente pasada retoma, porque el diff es el checkpoint.
  attempts: 1,
  removeOnComplete: { age: 3600 },
  removeOnFail: { age: 3600 }
};

const stateOf = async (job:Job):Promise<SyncState> => {

  const status = await job.getState();

  const mapped:SyncStatus =
    status === 'completed' ? 'done'
    : status === 'failed' ? 'failed'
    : status === 'active' ? 'running'
    : 'queued';

  return {
    status: mapped,
    progress: ((mapped === 'done' ? job.returnvalue : null) || job.progress || undefined) as SyncState['progress'],
    error: status === 'failed' ? job.failedReason : undefined
  };
}

/**
 * La cola de sincronizaciones, que Drive y GitHub usan igual: cambian el nombre,
 * el intervalo y poco mas. El dato del trabajo se llama `folder` porque es el
 * que ya consumen los workers; para GitHub es el id del repositorio.
 */
export const remoteSyncQueue = (options:RemoteSyncQueueOptions):SyncQueue => {

  let queue:Queue = null;
  let redis:Redis = null;

  /** Perezosa: sin sincronizaciones no se abre conexion con Redis. */
  const get = () => {

    if(!queue) {
      redis = connection();
      queue = new Queue(options.queueName, { connection: redis, prefix: Config.queue.prefix });
    }

    return queue;
  }

  // Sin dos puntos: BullMQ los reserva para separar sus claves.
  const syncId = (organization:string, source:string) => `${options.jobName}--${organization}--${source}`;
  const schedulerId = (organization:string, source:string) => `${syncId(organization, source)}--every`;

  const instance:SyncQueue = {

    async enqueueSync(organization, source) {

      const id = syncId(organization, source);
      const existing = await get().getJob(id);

      if(existing) {

        const state = await stateOf(existing);

        if(LIVE.includes(state.status)) return state;

        // BullMQ ignora en silencio un add cuyo identificador siga en completados o fallidos.
        await existing.remove();
      }

      const job = await get().add(options.jobName, { organization, folder: source }, { jobId: id, ...JOB_OPTIONS });

      log.info(`${options.label} sync queued for ${source} of organization ${organization}`);

      return stateOf(job);
    },

    async syncState(organization, source) {

      const job = await get().getJob(syncId(organization, source));

      return job ? stateOf(job) : { status: 'idle' };
    },

    // Con intervalo 0 tambien se retira: los planificadores viven en Redis y
    // sobreviven a un cambio de configuracion.
    async schedule(organization, source) {

      if(options.interval() <= 0) return instance.unschedule(organization, source);

      await get().upsertJobScheduler(schedulerId(organization, source), { every: options.interval() }, {
        name: options.jobName,
        data: { organization, folder: source },
        opts: JOB_OPTIONS
      });
    },

    async unschedule(organization, source) {
      await get().removeJobScheduler(schedulerId(organization, source));
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

  return instance;
}
