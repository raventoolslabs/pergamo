import Config from '@/shared/config';
import log from '@/shared/logger';
import { GitHubRepository } from '@/domain/entities/github';
import { ValidationError } from '@/domain/exceptions/domain.exception';
import { GitHubDeps } from '../dependencies';
import { assertGitHubEnabled } from '../github-enabled';

export interface AddGitHubRepositoryInput {
  organization: string;
  owner: string;
  repository: string;
  branch: string;
  index: boolean;
  storeContent: boolean;
  // Patrones glob que no se archivan; se pueden cambiar despues.
  excludes: string[];
  trace: string;
}

/**
 * Importar es la primera sincronizacion: un diff contra un lado vacio. Por eso
 * aqui solo se da de alta el repositorio y se encola.
 */
export const addGitHubRepository = async (input:AddGitHubRepositoryInput, deps:GitHubDeps):Promise<GitHubRepository> => {

  const { organization, owner, repository, branch, index, storeContent, excludes, trace } = input;

  assertGitHubEnabled();

  if(index && !Config.indexing.enabled) throw new ValidationError(
    'INDEXING_DISABLED', 'This deployment does not index documents');

  // Comprueba de paso que el token alcanza al repositorio y que la rama existe.
  if(!(await deps.github.branches(organization, owner, repository)).includes(branch)) throw new ValidationError(
    'GITHUB_BRANCH_NOT_FOUND', `Branch ${branch} does not exist in ${owner}/${repository}`);

  if((await deps.repositories.list(organization)).some((existing) =>
    existing.owner === owner && existing.repository === repository && existing.branch === branch)) {
    throw new ValidationError('GITHUB_REPOSITORY_EXISTS', `Branch ${branch} of ${owner}/${repository} is already synced`);
  }

  const created = await deps.repositories.create({
    organization, owner, repository, branch, indexDocuments: index, storeContent, excludes
  });

  // El repositorio ya existe: si Redis falla, «sincronizar ahora» lo importa luego.
  try {
    await deps.syncQueue.schedule(organization, created.id);
    await deps.syncQueue.enqueueSync(organization, created.id);
  } catch(error:any) {
    log.error(`${trace} | GitHub repository ${created.id} added but not queued: ${error.message}`);
  }

  return created;
}
