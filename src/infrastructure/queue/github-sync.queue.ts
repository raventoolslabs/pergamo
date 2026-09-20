import Config from '@/shared/config';
import { SyncQueue } from '@/app/ports/services/sync-queue.service';
import { GITHUB_SYNC_JOB_NAME, GITHUB_SYNC_QUEUE_NAME } from './connection';
import { remoteSyncQueue } from './remote-sync.queue';

export const githubSyncQueue:SyncQueue = remoteSyncQueue({
  queueName: GITHUB_SYNC_QUEUE_NAME,
  jobName: GITHUB_SYNC_JOB_NAME,
  interval: () => Config.github.sync_interval_ms,
  label: 'GitHub'
});
