import { GitHubDeps } from '../dependencies';
import { getGitHubRepository } from '../queries/get-github-sync.handler';

/**
 * Deja de sincronizar el repositorio. Sus documentos se quedan, sin origen: el
 * Markdown sigue en GitHub, y si se vuelve a dar de alta la misma rama los adopta.
 */
export const removeGitHubRepository = async (organization:string, id:string, deps:GitHubDeps):Promise<void> => {

  await getGitHubRepository(organization, id, deps);

  await deps.syncQueue.unschedule(organization, id);
  await deps.repositories.remove(organization, id);
}
