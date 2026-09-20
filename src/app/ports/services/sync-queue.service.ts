import { SyncProgress } from '@/domain/entities/remote';

export type SyncStatus = 'idle' | 'queued' | 'running' | 'done' | 'failed';

export interface SyncState {
  status: SyncStatus;
  progress?: SyncProgress;
  error?: string;
}

/**
 * Una sincronizacion viva por origen —carpeta de Drive o repositorio de
 * GitHub—, no mas, igual que el barrido.
 */
export interface SyncQueue {
  /** Devuelve el estado resultante: el del trabajo que ya hubiera, o el del nuevo. */
  enqueueSync(organization:string, source:string): Promise<SyncState>;
  syncState(organization:string, source:string): Promise<SyncState>;
  // Periodica si el intervalo configurado es > 0; con 0 retira la que hubiera en Redis.
  schedule(organization:string, source:string): Promise<void>;
  unschedule(organization:string, source:string): Promise<void>;
  close(): Promise<void>;
}
