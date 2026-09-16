import { Worker } from 'bullmq';
import Redis from 'ioredis';

import Config from '@/shared/config';
import log from '@/shared/logger';
import { driveDeps, queueConnection, DRIVE_SYNC_QUEUE_NAME } from '@/container';
import { syncDriveFolder } from '@/app/use-cases/drive/commands/sync-drive-folder.handler';

const SHUTDOWN_TIMEOUT_MS = 30000;

let worker:Worker = null;
let redis:Redis = null;

/**
 * Consumidor de sincronizaciones de Drive, hermano del barrido. Concurrencia de
 * uno: la cuota de la API de Google es por proyecto, y dos recorridos a la vez
 * solo se la reparten.
 */
export const startDriveSyncWorker = async () => {

  if(worker) return worker;

  redis = queueConnection();

  worker = new Worker(DRIVE_SYNC_QUEUE_NAME, async (job) => {

    const { organization, folder } = job.data;

    return syncDriveFolder({
      organization,
      folder,
      trace: `drive-sync ${job.id}`,
      report: (progress) => job.updateProgress(progress as any)
    }, driveDeps);

  }, {
    connection: redis,
    prefix: Config.queue.prefix,
    concurrency: 1,
    // Entre dos avances puede ir una pagina de mil ficheros con esperas por cuota.
    lockDuration: 300000
  });

  worker.on('failed', (job, error) =>
    log.error(`Drive sync ${job?.id} failed: ${error.message}`));

  log.info(`Drive sync worker listening on ${DRIVE_SYNC_QUEUE_NAME}`);

  return worker;
}

export const stopDriveSyncWorker = async () => {

  if(!worker) return;

  const [closingWorker, closingRedis] = [worker, redis];
  worker = null;
  redis = null;

  await Promise.race([
    closingWorker.close(),
    new Promise((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS))
  ]);

  await closingRedis.quit().catch(() => closingRedis.disconnect());
}
