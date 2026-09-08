import { Document, DocumentSummary } from '@/domain/entities/document';
import { DocumentRow, DocumentSummaryRow } from '@/infrastructure/db/schema/document.row';

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
  scanDate: optional(row.scan_date)
});

export const toDocumentSummary = (row:DocumentSummaryRow):DocumentSummary => ({
  id: row.id,
  creationDate: row.creation_date,
  modificationDate: row.modification_date,
  metadata: row.metadata,
  scanStatus: row.scan_status,
  scanSignature: optional(row.scan_signature),
  scanEngine: optional(row.scan_engine)
});
