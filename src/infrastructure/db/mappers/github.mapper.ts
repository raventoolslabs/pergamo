import { GitHubRepository, GitHubSettings } from '@/domain/entities/github';
import { GitHubRepositoryRow, GitHubSettingsRow } from '@/infrastructure/db/schema/github.row';

const optional = <T>(value:T | null) => value === null ? undefined : value;

export const toGitHubSettings = (row:GitHubSettingsRow):GitHubSettings => ({
  organization: row.organization,
  apiUrl: optional(row.api_url),
  hasToken: row.token !== null,
  creationDate: row.creation_date,
  modificationDate: row.modification_date
});

export const toGitHubRepository = (row:GitHubRepositoryRow):GitHubRepository => ({
  id: row.id,
  organization: row.organization,
  owner: row.owner,
  repository: row.repository,
  branch: row.branch,
  name: `${row.owner}/${row.repository}`,
  indexDocuments: row.index_documents,
  storeContent: row.store_content,
  excludes: row.excludes,
  lastCommit: optional(row.last_commit),
  creationDate: row.creation_date,
  syncDate: optional(row.sync_date),
  syncError: optional(row.sync_error)
});
