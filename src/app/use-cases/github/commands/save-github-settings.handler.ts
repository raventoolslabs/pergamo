import { GitHubSettings } from '@/domain/entities/github';
import { SaveGitHubSettings } from '@/app/ports/repositories/github-settings.repository';
import { GitHubDeps } from '../dependencies';
import { assertGitHubEnabled } from '../github-enabled';

/**
 * El token entra en claro y sigue hacia el repositorio, que lo sella. No se
 * comprueba contra GitHub: lo dira la primera lectura que se haga con el.
 */
export const saveGitHubSettings = async (input:SaveGitHubSettings, deps:GitHubDeps):Promise<GitHubSettings> => {

  assertGitHubEnabled();

  return deps.settings.save(input);
}
