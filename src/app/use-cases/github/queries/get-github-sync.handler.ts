import { GitHubRepository } from '@/domain/entities/github';
import { NotFoundError } from '@/domain/exceptions/domain.exception';
import { SyncState } from '@/app/ports/services/sync-queue.service';
import { GitHubDeps } from '../dependencies';
import { assertGitHubEnabled } from '../github-enabled';

export const getGitHubRepository = async (organization:string, id:string, deps:GitHubDeps):Promise<GitHubRepository> => {

  assertGitHubEnabled();

  const repository = await deps.repositories.findById(organization, id);

  if(!repository) throw new NotFoundError('GITHUB_REPOSITORY_NOT_FOUND',
    `GitHub repository ${id} not exists in organization ${organization}`);

  return repository;
}

export const getGitHubSync = async (organization:string, id:string, deps:GitHubDeps):Promise<SyncState> => {

  await getGitHubRepository(organization, id, deps);

  return deps.syncQueue.syncState(organization, id);
}
