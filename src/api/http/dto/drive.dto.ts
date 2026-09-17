import { z } from "zod";

import Config from '@/shared/config';
import { DriveConnection, DriveEntry, DriveFolder, DriveSettings } from '@/domain/entities/drive';
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

/**
 * client_secret entra en claro una sola vez y no vuelve a salir: string lo
 * guarda o lo rota, null lo quita, y ausente lo deja como estaba, que es lo que
 * permite corregir el client_id sin volver a escribirlo.
 */
export const driveSettingsBodySchema = z.object({
  client_id: z.string().min(1).max(256),
  client_secret: z.string().min(1).max(512).nullable().optional()
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

export const toDriveSettingsResponse = (settings:DriveSettings | null) => ({
  configured: !!settings?.hasSecret,
  // El client_id no es secreto: viaja en la URL de autorizacion de Google.
  client_id: settings?.clientId ?? null,
  // Del despliegue y no de la organizacion, pero es lo que hay que registrar en
  // el proyecto de Google Cloud, asi que se publica aqui. De lectura.
  redirect_uri: Config.drive.redirect_uri ?? null,
  creation_date: settings?.creationDate ?? null,
  modification_date: settings?.modificationDate ?? null
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
