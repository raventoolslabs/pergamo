import { SweepState } from '@/app/ports/services/rescan-queue.service';
import { DocumentDeps } from '../dependencies';

export const getRescanSweep = async (organization:string, deps:DocumentDeps):Promise<SweepState> =>
  deps.rescanQueue.sweepState(organization);
