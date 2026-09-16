import { Document, DocumentMetadata, DocumentSummary, RemoteSource } from '@/domain/entities/document';
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
  /**
   * Tope de tamano en bytes. No lo ofrece la query string: lo usa el barrido
   * para dejar fuera lo que el escaner no puede leer. Un documento sin tamano
   * guardado entra, que es lo que hace tambien `exceedsScanLimit`.
   */
  maxSize?: number;
  from?: Date;
  to?: Date;
  sort: 'creationDate' | 'modificationDate' | 'name' | 'scanStatus';
  order: 'asc' | 'desc';
}

// Lo minimo para decidir que cambio en Drive sin traer documentos enteros.
export interface RemoteState {
  id: string;
  fileId: string;
  // null si su carpeta se quito: la adopta la siguiente carpeta que lo vea.
  folder: string | null;
  revision: string;
  indexStatus: IndexStatus;
  discharged: boolean;
}

export interface DocumentPage {
  total: number;
  documents: DocumentSummary[];
}

export interface DocumentRepository {
  // Con `remote` el documento es de Drive; sin el, de disco.
  create(organization:string, metadata:DocumentMetadata, scan:ScanRecord, indexStatus:IndexStatus, scope?:TransactionScope, remote?:RemoteSource): Promise<Document>;
  findById(organization:string, id:string): Promise<Document | null>;
  replaceFile(organization:string, id:string, metadata:DocumentMetadata, scan:ScanRecord, scope?:TransactionScope): Promise<Document>;
  updateMetadata(organization:string, id:string, metadata:DocumentMetadata): Promise<Document>;
  // Solo el veredicto: un reanalisis no toca el contenido, asi que tampoco
  // modification_date, que describe el documento y no lo que se sabe de el.
  recordScan(organization:string, id:string, scan:ScanRecord, scope?:TransactionScope): Promise<Document>;
  // Devuelve la ruta de la fila borrada, o null si no existia.
  remove(organization:string, id:string): Promise<string | null>;
  list(filter:DocumentListFilter): Promise<DocumentPage>;

  /**
   * Todos los de Drive de la organizacion, dados de baja incluidos: un fichero
   * que reaparece revive su documento, y uno que ya importo otra carpeta
   * solapada no se duplica. Paginado por keyset sobre id.
   */
  listRemoteState(organization:string, afterId:string | null, limit:number): Promise<RemoteState[]>;
  /**
   * Nueva revision desde Drive. Tambien revive un documento dado de baja: es el
   * mismo fichero, con su id. `metadata` se mezcla con la guardada, asi que las
   * claves que edita el cliente y no llegan aqui se conservan. Sin `scan` ni
   * `indexStatus` se conservan veredicto e indice.
   */
  updateRemote(organization:string, id:string, metadata:Partial<DocumentMetadata>, remote:RemoteSource,
    scan:ScanRecord | null, indexStatus:IndexStatus | null, scope?:TransactionScope): Promise<Document>;
  // Baja logica; los chunks los borra quien llama, en la misma transaccion.
  discharge(organization:string, ids:string[], scope?:TransactionScope): Promise<void>;

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
