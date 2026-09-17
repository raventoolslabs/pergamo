import { DriveConnection } from '@/domain/entities/drive';
import { DriveDeps } from '../dependencies';
import { assertDriveEnabled } from '../drive-enabled';

export interface CompleteDriveConnectionInput {
  state: string;
  code: string;
}

/**
 * Vuelta de Google. Sin sesion: la organizacion sale del state sellado, nunca de
 * la peticion, asi que nadie conecta su Drive a una organizacion ajena.
 */
export const completeDriveConnection = async (input:CompleteDriveConnectionInput, deps:DriveDeps):Promise<DriveConnection> => {

  assertDriveEnabled();

  const grant = await deps.drive.exchange(input.state, input.code);

  return deps.connections.save(grant);
}
