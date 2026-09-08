export interface StoredVersion {
  version: number;
  createdAt: Date;
}

export interface FileStorage {
  /** Ruta absoluta de un documento a partir de su `path`, relativo a la organizacion. */
  resolve(organization:string, relative:string): string;
  move(from:string, to:string): Promise<void>;
  exists(filePath:string): Promise<boolean>;
  /** Rota las versiones anteriores y comprime la actual antes de sustituirla. */
  archiveVersion(id:string, filePath:string): Promise<void>;
  listVersions(filePath:string): Promise<StoredVersion[]>;
  removeDocument(organization:string, relative:string): Promise<void>;
  removeTemp(filePath:string): Promise<void>;
}
