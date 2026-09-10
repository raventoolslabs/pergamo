import { SweepState } from '@/app/ports/services/rescan-queue.service';
import { DocumentDeps } from '../dependencies';
import { countScannablePending } from '../commands/sweep-pending-documents.handler';

/**
 * En que anda el barrido y cuanto le queda por delante.
 *
 * El recuento sale del mismo criterio que el barrido, y no de «cuantos hay en
 * 'pending'»: los que el escaner no puede leer no son trabajo pendiente, y
 * contarlos ofreceria un barrido que no iba a analizar nada.
 */
export const getRescanSweep = async (organization:string, deps:DocumentDeps):Promise<SweepState> => {

  const [state, pending] = await Promise.all([
    deps.rescanQueue.sweepState(organization),
    countScannablePending(organization, deps)
  ]);

  return { ...state, pending };
}
