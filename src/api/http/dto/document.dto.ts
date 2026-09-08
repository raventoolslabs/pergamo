import { Document, DocumentSummary } from '@/domain/entities/document';
import { StoredVersion } from '@/app/ports/services/file-storage.service';

/**
 * Forma de salida de la API, en snake_case y con las columnas ausentes como
 * null explicito: la entidad usa `undefined`, y JSON.stringify borraria la
 * clave, cambiando un contrato que ya consumen otros clientes.
 */
export const toDocumentResponse = (document:DocumentSummary) => ({
  id: document.id,
  creation_date: document.creationDate,
  modification_date: document.modificationDate,
  scan_status: document.scanStatus,
  scan_signature: document.scanSignature ?? null,
  scan_engine: document.scanEngine ?? null,
  metadata: document.metadata
});

export const toScanInfoResponse = (document:Document) => ({
  scan_status: document.scanStatus,
  scan_signature: document.scanSignature ?? null,
  scan_engine: document.scanEngine ?? null,
  scan_date: document.scanDate ?? null
});

export const toVersionResponse = (version:StoredVersion) => ({
  version: version.version,
  created_at: version.createdAt
});
