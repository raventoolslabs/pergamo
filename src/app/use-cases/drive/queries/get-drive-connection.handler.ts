import { DriveConnection } from '@/domain/entities/drive';
import { DriveDeps } from '../dependencies';
import { assertDriveEnabled } from '../drive-enabled';

export const getDriveConnection = async (organization:string, deps:DriveDeps):Promise<DriveConnection | null> => {

  assertDriveEnabled();

  return deps.connections.find(organization);
}
