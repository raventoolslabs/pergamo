import { DriveDeps } from '../dependencies';
import { assertDriveEnabled } from '../drive-enabled';

/**
 * Olvida el token. Las carpetas y sus documentos se quedan: al reconectar se
 * sincronizan como estaban, y mientras tanto cada pasada anota el error.
 */
export const disconnectDrive = async (organization:string, deps:DriveDeps):Promise<void> => {

  assertDriveEnabled();

  await deps.connections.remove(organization);
}
