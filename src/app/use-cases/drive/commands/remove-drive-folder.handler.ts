import { NotFoundError } from '@/domain/exceptions/domain.exception';
import { DriveDeps } from '../dependencies';
import { assertDriveEnabled } from '../drive-enabled';

/**
 * Deja de sincronizar la carpeta. Sus documentos se quedan, sin carpeta: el
 * binario sigue en Drive, y otra carpeta que los contenga los adopta.
 */
export const removeDriveFolder = async (organization:string, id:string, deps:DriveDeps):Promise<void> => {

  assertDriveEnabled();

  if(!await deps.folders.findById(organization, id)) throw new NotFoundError(
    'DRIVE_FOLDER_NOT_FOUND', `Drive folder ${id} not exists in organization ${organization}`);

  await deps.syncQueue.unschedule(organization, id);
  await deps.folders.remove(organization, id);
}
