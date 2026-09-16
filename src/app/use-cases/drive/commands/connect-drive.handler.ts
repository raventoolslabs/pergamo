import { DriveDeps } from '../dependencies';
import { assertDriveEnabled } from '../drive-enabled';

// La URL a la que el navegador va a autorizar; la organizacion viaja sellada en el state.
export const connectDrive = async (organization:string, deps:DriveDeps):Promise<{ url:string }> => {

  assertDriveEnabled();

  return { url: await deps.drive.authUrl(organization) };
}
