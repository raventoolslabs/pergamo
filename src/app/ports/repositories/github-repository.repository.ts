import { GitHubRepository } from '@/domain/entities/github';

export interface NewGitHubRepository {
  organization: string;
  owner: string;
  repository: string;
  branch: string;
  indexDocuments: boolean;
  storeContent: boolean;
  excludes: string[];
}

export interface GitHubRepositoryRepository {
  create(repository:NewGitHubRepository): Promise<GitHubRepository>;
  findById(organization:string, id:string): Promise<GitHubRepository | null>;
  list(organization:string): Promise<GitHubRepository[]>;
  // Todas las organizaciones: el arranque reprograma las sincronizaciones periodicas.
  listAll(): Promise<GitHubRepository[]>;
  /**
   * Cambia las exclusiones y olvida el ultimo commit: si no, una rama parada
   * daria la pasada por hecha y las nuevas exclusiones no se aplicarian nunca.
   */
  updateExcludes(organization:string, id:string, excludes:string[]): Promise<GitHubRepository | null>;
  remove(organization:string, id:string): Promise<boolean>;
  // `commit` solo avanza cuando la pasada llego al final sin fallo.
  recordSync(id:string, date:Date, commit:string | null, error?:string): Promise<void>;
}
