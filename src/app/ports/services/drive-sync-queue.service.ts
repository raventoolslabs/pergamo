// La cola es la misma para Drive y para GitHub; estos nombres se conservan
// porque es como la llama todo el codigo de Drive.
export type {
  SyncQueue as DriveSyncQueue,
  SyncState as DriveSyncState,
  SyncStatus as DriveSyncStatus
} from '@/app/ports/services/sync-queue.service';
