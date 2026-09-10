/** Lo que el barrido lleva contado. Se publica mientras corre. */
export interface SweepProgress {
  scanned: number;
  clean: number;
  quarantined: number;
  missing: number;
  /** Mayores de lo que el escaner lee: se dejan como estaban. */
  skipped: number;
  total: number;
}

export type SweepStatus = 'idle' | 'queued' | 'running' | 'done' | 'failed';

export interface SweepState {
  status: SweepStatus;
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
