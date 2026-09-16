export interface DriveConnectionRow {
  organization: string;
  creation_date: Date;
  google_account: string;
  scope: string;
  revoked_date: Date | null;
}

export interface DriveFolderRow {
  id: string;
  organization: string;
  folder_id: string;
  name: string;
  index_documents: boolean;
  creation_date: Date;
  sync_date: Date | null;
  sync_error: string | null;
}
