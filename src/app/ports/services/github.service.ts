import { GitHubEntry, GitHubFile } from '@/domain/entities/github';

/**
 * Los metodos reciben la organizacion y nunca el token: el adaptador lo
 * descifra para si mismo, y ningun secreto atraviesa la capa app.
 */
export interface GitHubClient {
  // Repositorios a los que alcanza el token, para el selector.
  repositories(organization:string): Promise<GitHubEntry[]>;
  branches(organization:string, owner:string, repository:string): Promise<string[]>;
  // Commit en el que esta la rama ahora mismo.
  head(organization:string, owner:string, repository:string, branch:string): Promise<string>;
  // Perezoso, y solo Markdown: el arbol entero no interesa.
  walk(organization:string, owner:string, repository:string, commit:string): AsyncIterable<GitHubFile>;
  // false si el blob ya no existe. Se baja por sha, que es inmutable.
  download(organization:string, owner:string, repository:string, sha:string, target:string): Promise<boolean>;
}
