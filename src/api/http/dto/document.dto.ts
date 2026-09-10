import { Document, DocumentSummary } from '@/domain/entities/document';
import { StoredChunk } from '@/app/ports/repositories/document-chunk.repository';
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

/**
 * `content` sale tal cual se guardo, migas de pan incluidas: es exactamente el
 * texto que se embebio, y es lo unico que permite comprobar que lo indexado y
 * lo que se ve son lo mismo.
 *
 * El vector no aparece, aqui ni en ningun otro sitio.
 */
export const toChunkResponse = (chunk:StoredChunk) => ({
  chunk_id: chunk.id,
  position: chunk.position,
  content: chunk.content,
  page: chunk.page ?? null,
  section: chunk.section ?? null,
  heading_path: chunk.headingPath,
  content_type: chunk.contentType,
  length: chunk.length
});

export const toVersionResponse = (version:StoredVersion) => ({
  version: version.version,
  created_at: version.createdAt
});
