import { Worker } from 'bullmq';
import Redis from 'ioredis';

import Config from '@/shared/config';
import log from '@/shared/logger';
import { documentDeps, queueConnection, RESCAN_QUEUE_NAME } from '@/container';
import { sweepPendingDocuments } from '@/app/use-cases/document/commands/sweep-pending-documents.handler';

const SHUTDOWN_TIMEOUT_MS = 30000;

let worker:Worker = null;
let redis:Redis = null;

/**
 * Consumidor del barrido de pendientes, hermano del que indexa: vive en `api`
 * porque llama a un caso de uso, no porque implemente un puerto.
 *
 * Un barrido puede durar mucho —analiza el corpus entero de una organizacion—,
 * de ahi el lock largo y la concurrencia de uno: dos barridos a la vez
 * competirian por el mismo clamd.
 */
export const startRescanWorker = async () => {

  if(worker) return worker;

  redis = queueConnection();

  worker = new Worker(RESCAN_QUEUE_NAME, async (job) => {

    const { organization } = job.data;

    return sweepPendingDocuments({
      organization,
      trace: `sweep ${job.id}`,
      report: (progress) => job.updateProgress(progress as any)
    }, documentDeps);

  }, {
    connection: redis,
    prefix: Config.queue.prefix,
    concurrency: 1,
    // Cada documento renueva el lock al publicar su avance, pero entre uno y el
    // siguiente puede pasar un fichero grande entero: el defecto de 30 segundos
    // daria el barrido por perdido a media faena.
    lockDuration: 300000
  });

  worker.on('completed', (job, outcome:any) =>
    log.info(`Rescan sweep ${job.id}: ${outcome?.scanned ?? 0} scanned, ${outcome?.skipped ?? 0} skipped`));

  worker.on('failed', (job, error) =>
    log.error(`Rescan sweep ${job?.id} failed: ${error.message}`));

  log.info(`Rescan worker listening on ${RESCAN_QUEUE_NAME}`);

  return worker;
}

export const stopRescanWorker = async () => {

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
