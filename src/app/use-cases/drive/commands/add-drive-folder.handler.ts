import Config from '@/shared/config';
import log from '@/shared/logger';
import { DriveFolder } from '@/domain/entities/drive';
import { ValidationError } from '@/domain/exceptions/domain.exception';
import { DriveDeps } from '../dependencies';
import { assertDriveEnabled } from '../drive-enabled';

export interface AddDriveFolderInput {
  organization: string;
  folderId: string;
  index: boolean;
  trace: string;
}

/**
 * Importar es la primera sincronizacion: un diff contra un lado vacio. Por eso
 * aqui solo se da de alta la carpeta y se encola.
 */
export const addDriveFolder = async (input:AddDriveFolderInput, deps:DriveDeps):Promise<DriveFolder> => {

  const { organization, folderId, index, trace } = input;

  assertDriveEnabled();

  if(index && !Config.indexing.enabled) throw new ValidationError(
    'INDEXING_DISABLED', 'This deployment does not index documents');

  if((await deps.folders.list(organization)).some((folder) => folder.folderId === folderId)) {
    throw new ValidationError('DRIVE_FOLDER_EXISTS', `Drive folder ${folderId} is already synced`);
  }

  // Comprueba de paso que la conexion vale y que es una carpeta.
  const entry = await deps.drive.folder(organization, folderId);

  const folder = await deps.folders.create({ organization, folderId, name: entry.name, indexDocuments: index });

  // La carpeta ya existe: si Redis falla, «sincronizar ahora» la importa luego.
  try {
    await deps.syncQueue.schedule(organization, folder.id);
    await deps.syncQueue.enqueueSync(organization, folder.id);
  } catch(error:any) {
    log.error(`${trace} | Drive folder ${folder.id} added but not queued: ${error.message}`);
  }

  return folder;
}
