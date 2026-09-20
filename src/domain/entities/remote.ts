/** Lo que una sincronizacion lleva hecho. Se publica mientras corre. */
export interface SyncProgress {
  seen: number;
  created: number;
  updated: number;
  restored: number;
  discharged: number;
  skipped: number;
}
