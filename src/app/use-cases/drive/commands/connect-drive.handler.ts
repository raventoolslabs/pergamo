import { DriveDeps } from '../dependencies';
import { assertDriveEnabled } from '../drive-enabled';

// La URL a la que el navegador va a autorizar; la organizacion y, si la pide otra
// interfaz, su destino de vuelta viajan sellados en el state.
export const connectDrive = async (organization:string, returnTo:string | undefined, deps:DriveDeps):Promise<{ url:string }> => {

  assertDriveEnabled();

  return { url: await deps.drive.authUrl(organization, returnTo) };
}
