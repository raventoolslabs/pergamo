import { DriveSettings } from '@/domain/entities/drive';

export interface SaveDriveSettings {
  organization: string;
  clientId: string;
  // string guarda o rota; null quita; ausente mantiene el que hubiera.
  clientSecret?: string | null;
}

/**
 * Credenciales en claro. Solo las pide el adaptador de OAuth; ningun caso de uso
 * las toca. modificationDate es la huella con la que el adaptador sabe que su
 * cliente cacheado ha quedado viejo.
 */
export interface DriveCredentials {
  clientId: string;
  clientSecret: string;
  modificationDate: Date;
}

export interface DriveSettingsRepository {
  find(organization:string): Promise<DriveSettings | null>;
  // El secreto entra en claro y se guarda sellado.
  save(input:SaveDriveSettings): Promise<DriveSettings>;
  remove(organization:string): Promise<void>;
  // Unico camino por el que el secreto sale en claro.
  credentials(organization:string): Promise<DriveCredentials | null>;
}
