import { ScanStatus } from '@/domain/value-objects/scan-status';
import { IndexStatus } from '@/domain/value-objects/index-status';
import { DocumentSource } from '@/domain/entities/document';

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
  source: DocumentSource;
  remote_file_id: string | null;
  remote_folder: string | null;
  remote_revision: string | null;
  remote_view_link: string | null;
  discharge_date: Date | null;
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
  source: DocumentSource;
  remote_view_link: string | null;
  total: string;
}

export interface RemoteStateRow {
  id: string;
  remote_file_id: string;
  remote_folder: string | null;
  remote_revision: string;
  index_status: IndexStatus;
  discharged: boolean;
}
