export type ScanStatus = 'pending' | 'clean' | 'infected' | 'error';

/**
 * Metadatos de un documento. El backend guarda un JSONB libre y solo garantiza
 * las claves que fija el trigger de insercion y la subida; el resto depende de
 * VALID_METADATA_MODIFY, que es configurable por despliegue.
 */
export interface DocumentMetadata {
  uuid: string;
  uuid_sha256?: string;
  name: string;
  original_name?: string;
  mimetype: string;
  extension: string;
  hash: string;
  /** Bytes del fichero. No lo tienen los documentos depositados antes de que
      la subida empezara a guardarlo, asi que siempre hay que comprobarlo. */
  size?: number;
  organization?: string;
  creation_date?: string;
  tags?: string[];
  [key: string]: unknown;
}

export interface DocumentSummary {
  id: string;
  creation_date: string;
  modification_date: string;
  scan_status: ScanStatus;
  scan_signature: string | null;
  metadata: DocumentMetadata;
}

export interface DocumentList {
  total: number;
  limit: number;
  offset: number;
  documents: DocumentSummary[];
}

/** Respuesta de GET /document/:id/scan. */
export interface ScanInfo {
  scan_status: ScanStatus;
  scan_signature: string | null;
  scan_engine: string | null;
  scan_date: string | null;
}

export interface DocumentVersion {
  version: number;
  created_at: string;
}

export interface Organization {
  id: string;
  name: string;
  creation_date: string;
  modification_date: string;
  discharge_date: string | null;
}

export interface OrganizationList {
  total: number;
  limit: number;
  offset: number;
  organizations: Organization[];
}

/** Limites del despliegue, servidos por GET /config. */
export interface ServerConfig {
  valid_mimetype: string[];
  valid_metadata_modify: string[];
  max_file_size: number;
  max_version_file: number;
}

export interface DocumentQuery {
  limit?: number;
  offset?: number;
  name?: string;
  tag?: string;
  /** Uno o varios estados separados por comas ('infected,error'): la interfaz
      agrupa en 'En cuarentena' los dos que bloquean por algo que revisar. */
  scan_status?: string;
  /** Franja de deposito, inclusiva. Instantes ISO con zona: creation_date esta
      en UTC y el formulario recoge hora local. */
  from?: string;
  to?: string;
  sort?: 'creation_date' | 'modification_date';
  order?: 'asc' | 'desc';
}
