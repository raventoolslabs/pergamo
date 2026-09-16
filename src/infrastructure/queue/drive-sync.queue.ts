import { Job, Queue } from 'bullmq';
import Redis from 'ioredis';

import Config from '@/shared/config';
import log from '@/shared/logger';
import { DriveSyncQueue, DriveSyncState, DriveSyncStatus } from '@/app/ports/services/drive-sync-queue.service';
import { connection, DRIVE_SYNC_JOB_NAME, DRIVE_SYNC_QUEUE_NAME } from './connection';

let queue:Queue = null;
let redis:Redis = null;

/** Perezosa: sin sincronizaciones no se abre conexion con Redis. */
const get = () => {

  if(!queue) {
    redis = connection();
    queue = new Queue(DRIVE_SYNC_QUEUE_NAME, { connection: redis, prefix: Config.queue.prefix });
  }

  return queue;
}

// Sin dos puntos: BullMQ los reserva para separar sus claves.
const syncId = (organization:string, folder:string) => `${DRIVE_SYNC_JOB_NAME}--${organization}--${folder}`;
const schedulerId = (organization:string, folder:string) => `${syncId(organization, folder)}--every`;

const LIVE:DriveSyncStatus[] = ['queued', 'running'];

const stateOf = async (job:Job):Promise<DriveSyncState> => {

  const status = await job.getState();

  const mapped:DriveSyncStatus =
    status === 'completed' ? 'done'
    : status === 'failed' ? 'failed'
    : status === 'active' ? 'running'
    : 'queued';

  return {
    status: mapped,
    progress: ((mapped === 'done' ? job.returnvalue : null) || job.progress || undefined) as DriveSyncState['progress'],
    error: status === 'failed' ? job.failedReason : undefined
  };
}

const JOB_OPTIONS = {
  // Sin reintento inmediato: la siguiente pasada retoma, porque el diff es el checkpoint.
  attempts: 1,
  removeOnComplete: { age: 3600 },
  removeOnFail: { age: 3600 }
};

export const driveSyncQueue:DriveSyncQueue = {

  async enqueueSync(organization, folder) {

    const id = syncId(organization, folder);
    const existing = await get().getJob(id);

    if(existing) {

      const state = await stateOf(existing);

      if(LIVE.includes(state.status)) return state;

      // BullMQ ignora en silencio un add cuyo identificador siga en completados o fallidos.
      await existing.remove();
    }

    const job = await get().add(DRIVE_SYNC_JOB_NAME, { organization, folder }, { jobId: id, ...JOB_OPTIONS });

    log.info(`Drive sync queued for folder ${folder} of organization ${organization}`);

    return stateOf(job);
  },

  async syncState(organization, folder) {

    const job = await get().getJob(syncId(organization, folder));

    return job ? stateOf(job) : { status: 'idle' };
  },

  // Con intervalo 0 tambien se retira: los planificadores viven en Redis y
  // sobreviven a un cambio de configuracion.
  async schedule(organization, folder) {

    if(Config.drive.sync_interval_ms <= 0) return driveSyncQueue.unschedule(organization, folder);

    await get().upsertJobScheduler(schedulerId(organization, folder), { every: Config.drive.sync_interval_ms }, {
      name: DRIVE_SYNC_JOB_NAME,
      data: { organization, folder },
      opts: JOB_OPTIONS
    });
  },

  async unschedule(organization, folder) {
    await get().removeJobScheduler(schedulerId(organization, folder));
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
