import Config from '@/shared/config';
import log from '@/shared/logger';
import sequelize from '@/infrastructure/db/client';
import { startWorker, stopWorker } from '@/api/queue/index.worker';
import { startRescanWorker, stopRescanWorker } from '@/api/queue/rescan.worker';
import { startDriveSyncWorker, stopDriveSyncWorker } from '@/api/queue/drive-sync.worker';
import { indexQueue } from '@/infrastructure/queue/index.queue';
import { rescanQueue } from '@/infrastructure/queue/rescan.queue';
import { driveSyncQueue } from '@/infrastructure/queue/drive-sync.queue';

/**
 * Worker suelto: el mismo codigo que el embebido, en su propio proceso.
 *
 * En produccion interesa separarlo porque abre ficheros no confiables con un
 * parser de documentos, y porque una reindexacion no debe competir por CPU con
 * las peticiones de la API.
 *
 * Atiende dos colas independientes, y cada una la levanta lo que la usa: un
 * despliegue con antivirus y sin indexacion tiene barridos que atender.
 */
process.on('unhandledRejection', (reason:any) => {
  log.error(`Unhandled rejection: ${reason?.stack || reason}`);
});

const shutdown = async (signal:string) => {

  log.info(`${signal} received: finishing the job in progress`);

  await Promise.all([stopWorker(), stopRescanWorker(), stopDriveSyncWorker()]);
  await Promise.all([indexQueue.close(), rescanQueue.close(), driveSyncQueue.close()]);
  await sequelize.close().catch(() => {});

  process.exit(0);
};

process.on('SIGTERM', () => { shutdown('SIGTERM'); });
process.on('SIGINT', () => { shutdown('SIGINT'); });

const start = async () => {

  if(!Config.indexing.enabled && !Config.enable_antivirus && !Config.drive.enabled) throw new Error(
    'None of INDEXING_ENABLED, ENABLE_ANTIVIRUS or DRIVE_ENABLED is enabled: there is nothing for this worker to do.');

  // El del indice comprueba antes el esquema y el proveedor de embeddings; el
  // del barrido no necesita ninguno de los dos.
  if(Config.indexing.enabled) await startWorker();
  if(Config.enable_antivirus) await startRescanWorker();
  if(Config.drive.enabled) await startDriveSyncWorker();
};

start().catch((error:any) => {
  log.error(`Worker startup failed: ${error?.message || error}`);
  process.exit(1);
});
