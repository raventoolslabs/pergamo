import { GitHubDeps } from '../dependencies';
import { assertGitHubEnabled } from '../github-enabled';

/**
 * Deja a la organizacion sin GitHub. Los repositorios dados de alta y lo ya
 * archivado se quedan, pero sin token no se puede volver a sincronizar ni bajar
 * de la API lo que no tenga copia en Pergamo.
 */
export const removeGitHubSettings = async (organization:string, deps:GitHubDeps):Promise<void> => {

  assertGitHubEnabled();

  await deps.settings.remove(organization);
}
