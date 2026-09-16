import { DriveConnection, DriveFolder } from '@/domain/entities/drive';
import { DriveConnectionRow, DriveFolderRow } from '@/infrastructure/db/schema/drive.row';

const optional = <T>(value:T | null) => value === null ? undefined : value;

export const toDriveConnection = (row:DriveConnectionRow):DriveConnection => ({
  organization: row.organization,
  googleAccount: row.google_account,
  scope: row.scope,
  creationDate: row.creation_date,
  revokedDate: optional(row.revoked_date)
});

export const toDriveFolder = (row:DriveFolderRow):DriveFolder => ({
  id: row.id,
  organization: row.organization,
  folderId: row.folder_id,
  name: row.name,
  indexDocuments: row.index_documents,
  creationDate: row.creation_date,
  syncDate: optional(row.sync_date),
  syncError: optional(row.sync_error)
});
