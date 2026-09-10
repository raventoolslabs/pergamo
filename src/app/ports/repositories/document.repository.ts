import { Document, DocumentMetadata, DocumentSummary } from '@/domain/entities/document';
import { IndexStatus } from '@/domain/value-objects/index-status';
import { ScanStatus } from '@/domain/value-objects/scan-status';
import { TransactionScope } from '@/app/ports/unit-of-work';

export interface ScanRecord {
  scanStatus: ScanStatus;
  scanSignature: string | null;
  scanEngine: string | null;
  scanDate: Date | null;
}

export interface IndexResult {
  model: string;
  converter: string;
  chunkerVersion: string;
  chunks: number;
}

export interface DocumentListFilter {
  organization: string;
  limit: number;
  offset: number;
  name?: string;
  tag?: string;
  scanStatus?: ScanStatus[];
  from?: Date;
  to?: Date;
  sort: 'creationDate' | 'modificationDate';
  order: 'asc' | 'desc';
}

export interface DocumentPage {
  total: number;
  documents: DocumentSummary[];
}

export interface DocumentRepository {
  create(organization:string, metadata:DocumentMetadata, scan:ScanRecord, indexStatus:IndexStatus, scope?:TransactionScope): Promise<Document>;
  findById(organization:string, id:string): Promise<Document | null>;
  replaceFile(organization:string, id:string, metadata:DocumentMetadata, scan:ScanRecord, scope?:TransactionScope): Promise<Document>;
  updateMetadata(organization:string, id:string, metadata:DocumentMetadata): Promise<Document>;
  // Solo el veredicto: un reanalisis no toca el contenido, asi que tampoco
  // modification_date, que describe el documento y no lo que se sabe de el.
  recordScan(organization:string, id:string, scan:ScanRecord, scope?:TransactionScope): Promise<Document>;
  // Devuelve la ruta de la fila borrada, o null si no existia.
  remove(organization:string, id:string): Promise<string | null>;
  list(filter:DocumentListFilter): Promise<DocumentPage>;

  setIndexStatus(document:string, status:IndexStatus, error?:string, scope?:TransactionScope): Promise<void>;

  /**
   * Cierra la indexacion solo si el fichero sigue siendo el que se convirtio.
   *
   * Devuelve false cuando el hash ya no coincide —modifyFile lo reemplazo a
   * mitad—, y esa condicion, y no la deduplicacion de la cola, es lo que
   * garantiza que los vectores correspondan al fichero que hay en disco.
   */
  finishIndexing(document:string, hash:string, result:IndexResult, scope?:TransactionScope): Promise<boolean>;
}
