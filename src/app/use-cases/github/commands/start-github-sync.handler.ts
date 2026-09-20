import { SyncState } from '@/app/ports/services/sync-queue.service';
import { GitHubDeps } from '../dependencies';
import { getGitHubRepository } from '../queries/get-github-sync.handler';

// Si ya hay una en marcha para el repositorio se devuelve esa.
export const startGitHubSync = async (organization:string, id:string, deps:GitHubDeps):Promise<SyncState> => {

  await getGitHubRepository(organization, id, deps);

  return deps.syncQueue.enqueueSync(organization, id);
}
