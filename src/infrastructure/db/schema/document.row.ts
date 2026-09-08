import { ScanStatus } from '@/domain/value-objects/scan-status';

export interface DocumentRow {
  id: string;
  creation_date: Date;
  modification_date: Date;
  path: string;
  organization: string;
  metadata: any;
  scan_status: ScanStatus;
  scan_signature: string | null;
  scan_engine: string | null;
  scan_date: Date | null;
}

// Lo que devuelve el listado: sin `path`, y con el total de la ventana.
export interface DocumentSummaryRow {
  id: string;
  creation_date: Date;
  modification_date: Date;
  metadata: any;
  scan_status: ScanStatus;
  scan_signature: string | null;
  scan_engine: string | null;
  total: string;
}
