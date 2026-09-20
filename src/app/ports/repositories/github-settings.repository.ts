import { GitHubSettings } from '@/domain/entities/github';

export interface SaveGitHubSettings {
  organization: string;
  // null lo deja en github.com.
  apiUrl?: string | null;
  // string guarda o rota; null quita; ausente mantiene el que hubiera.
  token?: string | null;
}

/**
 * Credenciales en claro. Solo las pide el cliente de GitHub; ningun caso de uso
 * las toca.
 */
export interface GitHubCredentials {
  apiUrl: string;
  token: string;
}

export interface GitHubSettingsRepository {
  find(organization:string): Promise<GitHubSettings | null>;
  // El token entra en claro y se guarda sellado.
  save(input:SaveGitHubSettings): Promise<GitHubSettings>;
  remove(organization:string): Promise<void>;
  // Unico camino por el que el token sale en claro.
  credentials(organization:string): Promise<GitHubCredentials | null>;
}
