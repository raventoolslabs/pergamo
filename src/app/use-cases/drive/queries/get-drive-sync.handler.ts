import { DriveFolder } from '@/domain/entities/drive';
import { NotFoundError } from '@/domain/exceptions/domain.exception';
import { DriveSyncState } from '@/app/ports/services/drive-sync-queue.service';
import { DriveDeps } from '../dependencies';
import { assertDriveEnabled } from '../drive-enabled';

export const getDriveFolder = async (organization:string, id:string, deps:DriveDeps):Promise<DriveFolder> => {

  assertDriveEnabled();

  const folder = await deps.folders.findById(organization, id);

  if(!folder) throw new NotFoundError('DRIVE_FOLDER_NOT_FOUND', `Drive folder ${id} not exists in organization ${organization}`);

  return folder;
}

export const getDriveSync = async (organization:string, id:string, deps:DriveDeps):Promise<DriveSyncState> => {

  await getDriveFolder(organization, id, deps);

  return deps.syncQueue.syncState(organization, id);
}
