import { ScanStatus } from '@/domain/value-objects/scan-status';
import { IndexStatus } from '@/domain/value-objects/index-status';

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

export type DocumentSource = 'disk' | 'drive';

/**
 * Donde vive el binario de un documento de Drive. `revision` es lo que decide si
 * cambio: se compara, nunca se descarga para calcular un hash.
 */
export interface RemoteSource {
  fileId: string;
  // Ausente si la carpeta se quito: el documento sigue hasta que se de de baja.
  folder?: string;
  revision: string;
  viewLink?: string;
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
  index: IndexState;
  source: DocumentSource;
  remote?: RemoteSource;
  dischargeDate?: Date;
}

/**
 * Estado de la indexacion semantica. En columnas propias y nunca dentro de
 * `metadata`: esa la modifica el cliente por una allowlist configurable, y una
 * clave de estado ahi le dejaria marcarse como indexado a si mismo.
 */
export interface IndexState {
  status: IndexStatus;
  model?: string;
  converter?: string;
  chunkerVersion?: string;
  chunks?: number;
  error?: string;
  date?: Date;
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
  source: DocumentSource;
  driveViewLink?: string;
}

export interface ScanInfo {
  scanStatus: ScanStatus;
  scanSignature?: string;
  scanEngine?: string;
  scanDate?: Date;
}
