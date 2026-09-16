import { Document, DocumentSummary } from '@/domain/entities/document';
import { RemoteState } from '@/app/ports/repositories/document.repository';
import { DocumentRow, DocumentSummaryRow, RemoteStateRow } from '@/infrastructure/db/schema/document.row';

// Las columnas nulas de Postgres se traducen a ausencia: la entidad las declara
// opcionales, no nulables, y asi no hay dos formas de decir «no hay».
const optional = <T>(value:T | null) => value === null ? undefined : value;

export const toDocument = (row:DocumentRow):Document => ({
  id: row.id,
  creationDate: row.creation_date,
  modificationDate: row.modification_date,
  path: row.path,
  organization: row.organization,
  metadata: row.metadata,
  scanStatus: row.scan_status,
  scanSignature: optional(row.scan_signature),
  scanEngine: optional(row.scan_engine),
  scanDate: optional(row.scan_date),
  index: {
    status: row.index_status,
    model: optional(row.index_model),
    converter: optional(row.index_converter),
    chunkerVersion: optional(row.index_chunker_version),
    chunks: optional(row.index_chunks),
    error: optional(row.index_error),
    date: optional(row.index_date)
  },
  source: row.source,
  remote: row.drive_file_id === null ? undefined : {
    fileId: row.drive_file_id,
    folder: optional(row.drive_folder),
    revision: row.drive_revision,
    viewLink: optional(row.drive_view_link)
  },
  dischargeDate: optional(row.discharge_date)
});

export const toDocumentSummary = (row:DocumentSummaryRow):DocumentSummary => ({
  id: row.id,
  creationDate: row.creation_date,
  modificationDate: row.modification_date,
  metadata: row.metadata,
  scanStatus: row.scan_status,
  scanSignature: optional(row.scan_signature),
  scanEngine: optional(row.scan_engine),
  source: row.source
});

export const toRemoteState = (row:RemoteStateRow):RemoteState => ({
  id: row.id,
  fileId: row.drive_file_id,
  folder: row.drive_folder,
  revision: row.drive_revision,
  indexStatus: row.index_status,
  discharged: row.discharged
});
