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

export const toIndexInfoResponse = (document:Document) => ({
  index_status: document.index.status,
  index_model: document.index.model ?? null,
  index_converter: document.index.converter ?? null,
  index_chunker_version: document.index.chunkerVersion ?? null,
  index_chunks: document.index.chunks ?? null,
  index_error: document.index.error ?? null,
  index_date: document.index.date ?? null
});

export const toVersionResponse = (version:StoredVersion) => ({
  version: version.version,
  created_at: version.createdAt
});
