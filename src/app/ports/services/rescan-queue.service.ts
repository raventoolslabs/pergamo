/** Lo que el barrido lleva contado. Se publica mientras corre. */
export interface SweepProgress {
  scanned: number;
  clean: number;
  quarantined: number;
  missing: number;
  /** Los que fallaron por lo suyo; el barrido siguio con el resto. */
  failed: number;
  total: number;
}

export type SweepStatus = 'idle' | 'queued' | 'running' | 'done' | 'failed';

export interface SweepState {
  status: SweepStatus;
  /** Cuantos quedan por analizar de los que el escaner puede leer. */
  pending?: number;
  progress?: SweepProgress;
  /** Por que fallo, cuando fallo. */
  error?: string;
}

/**
 * Un barrido vivo por organizacion, no mas. El control es del adaptador porque
 * es quien conoce el almacen de trabajos.
 */
export interface RescanQueue {
  /** Devuelve el estado resultante: el del trabajo que ya hubiera, o el del nuevo. */
  enqueueSweep(organization:string): Promise<SweepState>;
  sweepState(organization:string): Promise<SweepState>;
  close(): Promise<void>;
}
