import { DriveEntry } from '@/domain/entities/drive';
import { DriveDeps } from '../dependencies';
import { assertDriveEnabled } from '../drive-enabled';

// Subcarpetas para el selector; sin carpeta, la raiz de Mi unidad.
export const browseDrive = async (organization:string, folderId:string | undefined, deps:DriveDeps):Promise<DriveEntry[]> => {

  assertDriveEnabled();

  return deps.drive.children(organization, folderId);
}
