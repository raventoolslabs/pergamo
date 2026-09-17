// Solo lectura: Pergamo nunca escribe en Drive.
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

/**
 * Conexion de una organizacion con su Google Drive. El refresh_token no forma
 * parte de la entidad: solo lo lee el adaptador de Drive, sellado.
 */
export interface DriveConnection {
  organization: string;
  googleAccount: string;
  scope: string;
  creationDate: Date;
  // Google invalido el token: hay que volver a conectar.
  revokedDate?: Date;
}

/**
 * Cliente OAuth propio de la organizacion. El secreto no forma parte de la
 * entidad: solo lo abre el repositorio, para el adaptador de Drive.
 */
export interface DriveSettings {
  organization: string;
  clientId: string;
  // Hay secreto guardado. Sin el no se puede autorizar nada.
  hasSecret: boolean;
  creationDate: Date;
  modificationDate: Date;
}

export interface DriveFolder {
  id: string;
  organization: string;
  folderId: string;
  name: string;
  indexDocuments: boolean;
  creationDate: Date;
  syncDate?: Date;
  syncError?: string;
}

// Carpeta de Drive tal cual se ofrece en el selector.
export interface DriveEntry {
  id: string;
  name: string;
}

export interface DriveFile {
  id: string;
  name: string;
  mimetype: string;
  size?: number;
  // Solo los binarios lo traen; Docs, Sheets y Slides no.
  md5Checksum?: string;
  version: string;
  modifiedTime: string;
  viewLink?: string;
}

/** Lo que una sincronizacion lleva hecho. Se publica mientras corre. */
export interface SyncProgress {
  seen: number;
  created: number;
  updated: number;
  restored: number;
  discharged: number;
  skipped: number;
}
