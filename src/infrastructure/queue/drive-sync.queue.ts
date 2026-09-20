import Config from '@/shared/config';
import { DriveSyncQueue } from '@/app/ports/services/drive-sync-queue.service';
import { DRIVE_SYNC_JOB_NAME, DRIVE_SYNC_QUEUE_NAME } from './connection';
import { remoteSyncQueue } from './remote-sync.queue';

export const driveSyncQueue:DriveSyncQueue = remoteSyncQueue({
  queueName: DRIVE_SYNC_QUEUE_NAME,
  jobName: DRIVE_SYNC_JOB_NAME,
  interval: () => Config.drive.sync_interval_ms,
  label: 'Drive'
});
