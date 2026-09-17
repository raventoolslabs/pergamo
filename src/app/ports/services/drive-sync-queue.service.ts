import { SyncProgress } from '@/domain/entities/drive';

export type DriveSyncStatus = 'idle' | 'queued' | 'running' | 'done' | 'failed';

export interface DriveSyncState {
  status: DriveSyncStatus;
  progress?: SyncProgress;
  error?: string;
}

/** Una sincronizacion viva por carpeta, no mas, igual que el barrido. */
export interface DriveSyncQueue {
  /** Devuelve el estado resultante: el del trabajo que ya hubiera, o el del nuevo. */
  enqueueSync(organization:string, folder:string): Promise<DriveSyncState>;
  syncState(organization:string, folder:string): Promise<DriveSyncState>;
  // Periodica si DRIVE_SYNC_INTERVAL_MS > 0; con 0 retira la que hubiera en Redis.
  schedule(organization:string, folder:string): Promise<void>;
  unschedule(organization:string, folder:string): Promise<void>;
  close(): Promise<void>;
}
