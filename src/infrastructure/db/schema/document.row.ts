import { ScanStatus } from '@/domain/value-objects/scan-status';
import { IndexStatus } from '@/domain/value-objects/index-status';

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
  index_status: IndexStatus;
  index_model: string | null;
  index_converter: string | null;
  index_chunker_version: string | null;
  index_chunks: number | null;
  index_error: string | null;
  index_date: Date | null;
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
