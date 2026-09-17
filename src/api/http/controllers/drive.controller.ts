import { StatusCodes } from 'http-status-codes';

import { driveDeps as deps } from '@/container';
import { DRIVE_SCOPE } from '@/domain/entities/drive';
import { ValidationError } from '@/domain/exceptions/domain.exception';
import { formatIssues } from '@/shared/validation';
import {
  driveBrowseQuerySchema, driveCallbackQuerySchema, driveFolderBodySchema,
  toDriveConnectionResponse, toDriveEntryResponse, toDriveFolderResponse, toDriveSyncResponse
} from '@/api/http/dto/drive.dto';
import { connectDrive } from '@/app/use-cases/drive/commands/connect-drive.handler';
import { completeDriveConnection } from '@/app/use-cases/drive/commands/complete-drive-connection.handler';
import { disconnectDrive } from '@/app/use-cases/drive/commands/disconnect-drive.handler';
import { addDriveFolder } from '@/app/use-cases/drive/commands/add-drive-folder.handler';
import { removeDriveFolder } from '@/app/use-cases/drive/commands/remove-drive-folder.handler';
import { startDriveSync } from '@/app/use-cases/drive/commands/start-drive-sync.handler';
import { getDriveConnection } from '@/app/use-cases/drive/queries/get-drive-connection.handler';
import { listDriveFolders } from '@/app/use-cases/drive/queries/list-drive-folders.handler';
import { getDriveSync } from '@/app/use-cases/drive/queries/get-drive-sync.handler';
import { browseDrive } from '@/app/use-cases/drive/queries/browse-drive.handler';

const trace = (req:any) => `${req.method} ${req.originalUrl} - ${req.id}`;

const parse = <T>(schema:{ safeParse:(value:unknown) => any }, value:unknown, code:string):T => {
  const result = schema.safeParse(value);
  if(!result.success) throw new ValidationError(code, formatIssues(result.error));
  return result.data;
};

/**
 * Lo abre el navegador al volver de Google, no un cliente de API: el exito es
 * una redireccion a la interfaz. Un state falsificado o caducado sigue siendo 401.
 */
const callback = async (req, res, next) => {

  try {

    // Quien rechaza el permiso en Google vuelve sin code: no es un fallo nuestro.
    if(typeof req.query.error === 'string') {
      return res.redirect(`/drive?error=${encodeURIComponent(req.query.error)}`);
    }

    // La pantalla de Google deja desmarcar Drive y aun asi devuelve code: sin este
    // permiso la conexion no sirve, asi que no se guarda.
    if(typeof req.query.scope === 'string' && !req.query.scope.split(' ').includes(DRIVE_SCOPE)) {
      return res.redirect('/drive?error=scope_missing');
    }

    const query = parse<{ code:string; state:string }>(driveCallbackQuerySchema, req.query, 'INVALID_QUERY');

    await completeDriveConnection(query, deps);

    res.redirect('/drive?connected=1');

  } catch (error) {
    next(error);
  }
};

const connection = async (req, res, next) => {
  try {
    res.status(StatusCodes.OK).json(toDriveConnectionResponse(await getDriveConnection(req.user.organization, deps)));
  } catch (error) {
    next(error);
  }
};

const connect = async (req, res, next) => {
  try {
    res.status(StatusCodes.OK).json(await connectDrive(req.user.organization, deps));
  } catch (error) {
    next(error);
  }
};

const disconnect = async (req, res, next) => {
  try {
    await disconnectDrive(req.user.organization, deps);
    res.status(StatusCodes.NO_CONTENT).end();
  } catch (error) {
    next(error);
  }
};

const browse = async (req, res, next) => {
  try {
    const { folder } = parse<{ folder?:string }>(driveBrowseQuerySchema, req.query, 'INVALID_QUERY');
    const entries = await browseDrive(req.user.organization, folder, deps);
    res.status(StatusCodes.OK).json(entries.map(toDriveEntryResponse));
  } catch (error) {
    next(error);
  }
};

const folders = async (req, res, next) => {
  try {
    res.status(StatusCodes.OK).json((await listDriveFolders(req.user.organization, deps)).map(toDriveFolderResponse));
  } catch (error) {
    next(error);
  }
};

const addFolder = async (req, res, next) => {
  try {
    const body = parse<{ folder_id:string; index:boolean }>(driveFolderBodySchema, req.body, 'INVALID_BODY');
    const folder = await addDriveFolder({
      organization: req.user.organization, folderId: body.folder_id, index: body.index, trace: trace(req)
    }, deps);
    res.status(StatusCodes.CREATED).json(toDriveFolderResponse(folder));
  } catch (error) {
    next(error);
  }
};

const removeFolder = async (req, res, next) => {
  try {
    await removeDriveFolder(req.user.organization, req.params.id, deps);
    res.status(StatusCodes.NO_CONTENT).end();
  } catch (error) {
    next(error);
  }
};

const startSync = async (req, res, next) => {
  try {
    res.status(StatusCodes.ACCEPTED).json(toDriveSyncResponse(await startDriveSync(req.user.organization, req.params.id, deps)));
  } catch (error) {
    next(error);
  }
};

const syncState = async (req, res, next) => {
  try {
    res.status(StatusCodes.OK).json(toDriveSyncResponse(await getDriveSync(req.user.organization, req.params.id, deps)));
  } catch (error) {
    next(error);
  }
};

export { addFolder, browse, callback, connect, connection, disconnect, folders, removeFolder, startSync, syncState };
