import log from '@/shared/logger';
import { GitHubRepository } from '@/domain/entities/github';
import { NotFoundError } from '@/domain/exceptions/domain.exception';
import { GitHubDeps } from '../dependencies';
import { getGitHubRepository } from '../queries/get-github-sync.handler';

export interface UpdateGitHubExcludesInput {
  organization: string;
  repository: string;
  excludes: string[];
  trace: string;
}

/**
 * Cambia lo que se deja fuera de un repositorio ya dado de alta y encola la
 * pasada que lo aplica: lo que pasa a estar excluido se da de baja —deja de
 * verse y sale del indice— y lo que deja de estarlo revive con su mismo id.
 */
export const updateGitHubExcludes = async (input:UpdateGitHubExcludesInput, deps:GitHubDeps):Promise<GitHubRepository> => {

  const { organization, trace } = input;

  await getGitHubRepository(organization, input.repository, deps);

  const updated = await deps.repositories.updateExcludes(organization, input.repository, input.excludes);

  if(!updated) throw new NotFoundError('GITHUB_REPOSITORY_NOT_FOUND',
    `GitHub repository ${input.repository} not exists in organization ${organization}`);

  // Ya esta guardado: si Redis falla, «sincronizar ahora» lo aplica luego.
  try {
    await deps.syncQueue.enqueueSync(organization, updated.id);
  } catch(error:any) {
    log.error(`${trace} | GitHub repository ${updated.id} updated but not queued: ${error.message}`);
  }

  return updated;
}
