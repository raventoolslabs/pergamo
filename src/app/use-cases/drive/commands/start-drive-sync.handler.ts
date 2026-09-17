import { DriveSyncState } from '@/app/ports/services/drive-sync-queue.service';
import { DriveDeps } from '../dependencies';
import { getDriveFolder } from '../queries/get-drive-sync.handler';

// Si ya hay una en marcha para la carpeta se devuelve esa.
export const startDriveSync = async (organization:string, id:string, deps:DriveDeps):Promise<DriveSyncState> => {

  await getDriveFolder(organization, id, deps);

  return deps.syncQueue.enqueueSync(organization, id);
}
