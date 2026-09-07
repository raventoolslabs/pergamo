/** Cuarentena decidida por Pergamo, no por el escaner: no la levanta un
    reanalisis, solo una liberacion manual en el servidor. */
export type ScanStatus = 'pending' | 'clean' | 'infected' | 'error' | 'malicious';

/**
 * El backend guarda un JSONB libre y solo garantiza las claves que fija el
 * trigger de insercion; el resto depende de VALID_METADATA_MODIFY.
 */
export interface DocumentMetadata {
  uuid: string;
  uuid_sha256?: string;
  name: string;
  original_name?: string;
  mimetype: string;
  extension: string;
  hash: string;
  /** Falta en los documentos depositados antes de que la subida lo guardara. */
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
  /** Motor y base de firmas con que se aprobo. Nulo en un 'clean' que nunca
      paso por un escaner: es lo unico que separa analizado de guardado sin
      mirar. */
  scan_engine: string | null;
  metadata: DocumentMetadata;
}

export interface DocumentList {
  total: number;
  limit: number;
  offset: number;
  documents: DocumentSummary[];
}

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

export interface ServerConfig {
  /** Ausente en servidores anteriores a que /config lo sirviera: ahi no se
      afirma ni una cosa ni la otra. */
  enable_antivirus?: boolean;
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
  /** Uno o varios estados separados por comas ('infected,malicious'). */
  scan_status?: string;
  /** Franja de deposito, inclusiva. Instantes ISO con zona: creation_date esta
      en UTC y el formulario recoge hora local. */
  from?: string;
  to?: string;
  sort?: 'creation_date' | 'modification_date';
  order?: 'asc' | 'desc';
}
