import { z } from "zod";

import { GitHubEntry, GitHubRepository, GitHubSettings } from '@/domain/entities/github';
import { SyncState } from '@/app/ports/services/sync-queue.service';

/**
 * El token entra en claro una sola vez y no vuelve a salir: string lo guarda o
 * lo rota, null lo quita, y ausente lo deja como estaba, que es lo que permite
 * corregir la URL de la API sin volver a escribirlo.
 */
export const githubSettingsBodySchema = z.object({
  api_url: z.string().url().max(256).nullable().optional(),
  token: z.string().min(1).max(512).nullable().optional()
}).strict();

// Patrones glob relativos a la raiz de la rama. El tope es para que una lista
// disparatada no se recorra por cada fichero del arbol.
const excludes = z.array(z.string().min(1).max(255)).max(100).default([]);

export const githubRepositoryBodySchema = z.object({
  owner: z.string().min(1).max(128),
  repository: z.string().min(1).max(128),
  branch: z.string().min(1).max(255),
  index: z.boolean().default(false),
  store_content: z.boolean().default(false),
  excludes
}).strict();

export const githubExcludesBodySchema = z.object({ excludes }).strict();

export const githubBranchesQuerySchema = z.object({
  owner: z.string().min(1).max(128),
  repository: z.string().min(1).max(128)
}).strict();

export const toGitHubSettingsResponse = (settings:GitHubSettings | null) => ({
  configured: !!settings?.hasToken,
  api_url: settings?.apiUrl ?? null,
  creation_date: settings?.creationDate ?? null,
  modification_date: settings?.modificationDate ?? null
});

export const toGitHubRepositoryResponse = (repository:GitHubRepository) => ({
  id: repository.id,
  owner: repository.owner,
  repository: repository.repository,
  branch: repository.branch,
  name: repository.name,
  index_documents: repository.indexDocuments,
  store_content: repository.storeContent,
  excludes: repository.excludes,
  last_commit: repository.lastCommit ?? null,
  creation_date: repository.creationDate,
  sync_date: repository.syncDate ?? null,
  sync_error: repository.syncError ?? null
});

export const toGitHubEntryResponse = (entry:GitHubEntry) => ({
  owner: entry.owner,
  repository: entry.repository,
  default_branch: entry.defaultBranch,
  private: entry.private
});

export const toGitHubSyncResponse = (state:SyncState) => ({
  status: state.status,
  progress: state.progress ?? null,
  error: state.error ?? null
});
