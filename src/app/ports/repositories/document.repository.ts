import { Document, DocumentMetadata, DocumentSummary } from '@/domain/entities/document';
import { ScanStatus } from '@/domain/value-objects/scan-status';
import { TransactionScope } from '@/app/ports/unit-of-work';

export interface ScanRecord {
  scanStatus: ScanStatus;
  scanSignature: string | null;
  scanEngine: string | null;
  scanDate: Date | null;
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
  create(organization:string, metadata:DocumentMetadata, scan:ScanRecord, scope?:TransactionScope): Promise<Document>;
  findById(organization:string, id:string): Promise<Document | null>;
  replaceFile(organization:string, id:string, metadata:DocumentMetadata, scan:ScanRecord, scope?:TransactionScope): Promise<Document>;
  updateMetadata(organization:string, id:string, metadata:DocumentMetadata): Promise<Document>;
  // Devuelve la ruta de la fila borrada, o null si no existia.
  remove(organization:string, id:string): Promise<string | null>;
  list(filter:DocumentListFilter): Promise<DocumentPage>;
}
