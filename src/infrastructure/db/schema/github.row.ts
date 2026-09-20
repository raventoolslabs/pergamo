export interface GitHubSettingsRow {
  organization: string;
  creation_date: Date;
  modification_date: Date;
  api_url: string | null;
  // Sellado. Solo lo abre el propio repositorio.
  token: string | null;
}

export interface GitHubRepositoryRow {
  id: string;
  organization: string;
  owner: string;
  repository: string;
  branch: string;
  index_documents: boolean;
  store_content: boolean;
  excludes: string[];
  last_commit: string | null;
  creation_date: Date;
  sync_date: Date | null;
  sync_error: string | null;
}
