import { DriveSettings } from '@/domain/entities/drive';
import { DriveDeps } from '../dependencies';
import { assertDriveEnabled } from '../drive-enabled';

export const getDriveSettings = async (organization:string, deps:DriveDeps):Promise<DriveSettings | null> => {

  assertDriveEnabled();

  return deps.settings.find(organization);
}
