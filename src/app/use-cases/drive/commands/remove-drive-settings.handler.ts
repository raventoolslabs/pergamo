import { DriveDeps } from '../dependencies';
import { assertDriveEnabled } from '../drive-enabled';

/**
 * Deja a la organizacion sin Drive. La conexion se va con ella: su refresh_token
 * lo emitio este cliente OAuth y sin el no se puede renovar nunca mas. Las
 * carpetas y los documentos ya archivados se quedan.
 */
export const removeDriveSettings = async (organization:string, deps:DriveDeps):Promise<void> => {

  assertDriveEnabled();

  await deps.connections.remove(organization);
  await deps.settings.remove(organization);
}
