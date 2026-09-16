import { z } from "zod";

import { DriveConnection, DriveEntry, DriveFolder } from '@/domain/entities/drive';
import { DriveSyncState } from '@/app/ports/services/drive-sync-queue.service';

/**
 * Sin .strict(), a diferencia del resto: Google anade scope, authuser, prompt
 * y hd, y con .strict() cada conexion correcta seria un 400.
 */
export const driveCallbackQuerySchema = z.object({
  code: z.string().min(1).max(2048),
  state: z.string().min(1).max(4096)
});

export const driveFolderBodySchema = z.object({
  folder_id: z.string().min(1).max(128),
  index: z.boolean().default(false)
}).strict();

export const driveBrowseQuerySchema = z.object({
  folder: z.string().min(1).max(128).optional()
}).strict();

export const toDriveConnectionResponse = (connection:DriveConnection | null) => ({
  connected: !!connection && !connection.revokedDate,
  google_account: connection?.googleAccount ?? null,
  creation_date: connection?.creationDate ?? null,
  revoked_date: connection?.revokedDate ?? null
});

export const toDriveFolderResponse = (folder:DriveFolder) => ({
  id: folder.id,
  folder_id: folder.folderId,
  name: folder.name,
  index_documents: folder.indexDocuments,
  creation_date: folder.creationDate,
  sync_date: folder.syncDate ?? null,
  sync_error: folder.syncError ?? null
});

export const toDriveEntryResponse = (entry:DriveEntry) => ({
  id: entry.id,
  name: entry.name
});

export const toDriveSyncResponse = (state:DriveSyncState) => ({
  status: state.status,
  progress: state.progress ?? null,
  error: state.error ?? null
});
