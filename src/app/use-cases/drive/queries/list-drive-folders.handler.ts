import { DriveFolder } from '@/domain/entities/drive';
import { DriveDeps } from '../dependencies';
import { assertDriveEnabled } from '../drive-enabled';

export const listDriveFolders = async (organization:string, deps:DriveDeps):Promise<DriveFolder[]> => {

  assertDriveEnabled();

  return deps.folders.list(organization);
}
