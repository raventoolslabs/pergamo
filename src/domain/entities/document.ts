import { ScanStatus } from '@/domain/value-objects/scan-status';

/**
 * Documento depositado.
 *
 * `metadata` conserva sus claves en snake_case: es un JSONB que se devuelve
 * literal al cliente y que el trigger new_document() amplia por su cuenta, asi
 * que su forma es un contrato de datos, no el nombrado de la entidad.
 */
export interface DocumentMetadata {
  name: string;
  original_name: string;
  mimetype: string;
  extension: string;
  hash: string;
  size?: number;
  tags: string[];
  [key: string]: unknown;
}

export interface Document {
  id: string;
  creationDate: Date;
  modificationDate: Date;
  // Ruta en disco relativa a la organizacion: la calcula el trigger al insertar.
  path: string;
  organization: string;
  metadata: DocumentMetadata;
  scanStatus: ScanStatus;
  scanSignature?: string;
  scanEngine?: string;
  scanDate?: Date;
}

// Lo que un listado necesita: sin `path`, que es almacenamiento y no sale nunca.
export interface DocumentSummary {
  id: string;
  creationDate: Date;
  modificationDate: Date;
  metadata: DocumentMetadata;
  scanStatus: ScanStatus;
  scanSignature?: string;
  scanEngine?: string;
}

export interface ScanInfo {
  scanStatus: ScanStatus;
  scanSignature?: string;
  scanEngine?: string;
  scanDate?: Date;
}
