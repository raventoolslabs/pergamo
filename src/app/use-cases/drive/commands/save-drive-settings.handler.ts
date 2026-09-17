import { DriveSettings } from '@/domain/entities/drive';
import { SaveDriveSettings } from '@/app/ports/repositories/drive-settings.repository';
import { DriveDeps } from '../dependencies';
import { assertDriveEnabled } from '../drive-enabled';

/**
 * El secreto entra en claro y sigue hacia el repositorio, que lo sella. No se
 * comprueba contra Google: solo la primera autorizacion dice si es correcto.
 */
export const saveDriveSettings = async (input:SaveDriveSettings, deps:DriveDeps):Promise<DriveSettings> => {

  assertDriveEnabled();

  return deps.settings.save(input);
}
