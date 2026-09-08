import Config from '@/shared/config';
import log from '@/shared/logger';
import sequelize from '@/infrastructure/db/client';
import { startWorker, stopWorker } from '@/api/queue/index.worker';
import { indexQueue } from '@/infrastructure/queue/index.queue';

/**
 * Worker suelto: el mismo codigo que el embebido, en su propio proceso.
 *
 * En produccion interesa separarlo porque abre ficheros no confiables con un
 * parser de documentos, y porque una reindexacion no debe competir por CPU con
 * las peticiones de la API.
 */
process.on('unhandledRejection', (reason:any) => {
  log.error(`Unhandled rejection: ${reason?.stack || reason}`);
});

const shutdown = async (signal:string) => {

  log.info(`${signal} received: finishing the job in progress`);

  await stopWorker();
  await indexQueue.close();
  await sequelize.close().catch(() => {});

  process.exit(0);
};

process.on('SIGTERM', () => { shutdown('SIGTERM'); });
process.on('SIGINT', () => { shutdown('SIGINT'); });

const start = async () => {

  if(!Config.indexing.enabled) throw new Error(
    'INDEXING_ENABLED is not enabled: there is nothing for this worker to do.');

  await startWorker();
};

start().catch((error:any) => {
  log.error(`Worker startup failed: ${error?.message || error}`);
  process.exit(1);
});
