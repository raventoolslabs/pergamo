import Config from '@/shared/config';
import { ValidationError } from '@/domain/exceptions/domain.exception';
import { SweepState } from '@/app/ports/services/rescan-queue.service';
import { DocumentDeps } from '../dependencies';

/**
 * Pide un barrido de los pendientes de la organizacion.
 *
 * Si ya hay uno vivo devuelve ese, sin encolar un segundo: quien pulsa dos veces
 * quiere un barrido, no dos.
 */
export const startRescanSweep = async (organization:string, deps:DocumentDeps):Promise<SweepState> => {

  if(!Config.enable_antivirus) throw new ValidationError(
    'ANTIVIRUS_DISABLED', 'This deployment has no scanner to rescan with');

  return deps.rescanQueue.enqueueSweep(organization);
}
