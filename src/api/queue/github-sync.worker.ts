import { Worker } from 'bullmq';
import Redis from 'ioredis';

import Config from '@/shared/config';
import log from '@/shared/logger';
import { githubDeps, queueConnection, GITHUB_SYNC_QUEUE_NAME } from '@/container';
import { syncGitHubRepository } from '@/app/use-cases/github/commands/sync-github-repository.handler';

const SHUTDOWN_TIMEOUT_MS = 30000;

let worker:Worker = null;
let redis:Redis = null;

/**
 * Consumidor de sincronizaciones de GitHub, hermano del de Drive. Concurrencia
 * de uno: la cuota de la API es del token, y dos recorridos a la vez solo se la
 * reparten.
 */
export const startGitHubSyncWorker = async () => {

  if(worker) return worker;

  redis = queueConnection();

  worker = new Worker(GITHUB_SYNC_QUEUE_NAME, async (job) => {

    const { organization, folder } = job.data;

    return syncGitHubRepository({
      organization,
      repository: folder,
      trace: `github-sync ${job.id}`,
      report: (progress) => job.updateProgress(progress as any)
    }, githubDeps);

  }, {
    connection: redis,
    prefix: Config.queue.prefix,
    concurrency: 1,
    // Entre dos avances puede ir un arbol entero con esperas por cuota.
    lockDuration: 300000
  });

  worker.on('failed', (job, error) =>
    log.error(`GitHub sync ${job?.id} failed: ${error.message}`));

  log.info(`GitHub sync worker listening on ${GITHUB_SYNC_QUEUE_NAME}`);

  return worker;
}

export const stopGitHubSyncWorker = async () => {

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
