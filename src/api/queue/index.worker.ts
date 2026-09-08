import { UnrecoverableError, Worker } from 'bullmq';
import Redis from 'ioredis';

import Config from '@/shared/config';
import log from '@/shared/logger';
import { ConversionUnsupportedError } from '@/domain/exceptions/indexing.exception';
import { indexDocument } from '@/app/use-cases/indexing/commands/index-document.handler';
import { indexingDeps, prepareWorker, queueConnection, QUEUE_NAME } from '@/container';

// docker stop manda SIGKILL a los diez segundos, asi que esperar mas que esto a
// que termine el trabajo en curso no sirve de nada.
const SHUTDOWN_TIMEOUT_MS = 30000;

let worker:Worker = null;
let redis:Redis = null;

/**
 * Consumidor de la cola: la otra puerta de entrada a los casos de uso, al lado
 * de HTTP. Por eso vive en `api` y no junto al productor, que implementa un
 * puerto y por tanto es infraestructura.
 *
 * Comprueba el esquema y el proveedor ANTES de aceptar trabajos: un modelo que
 * no esta o una dimension que no cuadra deben impedir el arranque, no aparecer
 * a mitad de una reindexacion con la mitad del corpus ya escrita.
 */
export const startWorker = async () => {

  if(worker) return worker;

  await prepareWorker();

  redis = queueConnection();

  worker = new Worker(QUEUE_NAME, async (job) => {

    const { document, organization } = job.data;

    try {

      return await indexDocument({ document, organization }, indexingDeps);

    } catch(error:any) {

      // Reintentar no va a cambiar el mimetype: falla a la primera y se queda
      // en el registro de fallidos para que alguien lo mire.
      if(error instanceof ConversionUnsupportedError) throw new UnrecoverableError(error.message);

      throw error;
    }

  }, {
    connection: redis,
    prefix: Config.indexing.queue_prefix,
    concurrency: Config.indexing.concurrency,
    // El defecto son 30 segundos, y un PDF de trescientas paginas lo supera:
    // BullMQ daria el trabajo por perdido y lo entregaria a otro worker
    // mientras el primero sigue convirtiendo.
    lockDuration: 300000
  });

  worker.on('completed', (job, outcome) =>
    log.info(`Indexing ${job.data.document}: ${outcome}`));

  worker.on('failed', (job, error) =>
    log.error(`Indexing ${job?.data?.document} failed (attempt ${job?.attemptsMade}): ${error.message}`));

  log.info(`Indexing worker listening on ${QUEUE_NAME} (concurrency ${Config.indexing.concurrency})`);

  return worker;
}

export const stopWorker = async () => {

  if(!worker) return;

  const [closingWorker, closingRedis] = [worker, redis];
  worker = null;
  redis = null;

  // close() espera al trabajo en curso; el tope evita que un documento enorme
  // convierta un apagado ordenado en un SIGKILL.
  await Promise.race([
    closingWorker.close(),
    new Promise((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS))
  ]);

  await closingRedis.quit().catch(() => closingRedis.disconnect());
}
