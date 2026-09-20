import { GitHubRepository } from '@/domain/entities/github';
import { GitHubDeps } from '../dependencies';
import { assertGitHubEnabled } from '../github-enabled';

export const listGitHubRepositories = async (organization:string, deps:GitHubDeps):Promise<GitHubRepository[]> => {

  assertGitHubEnabled();

  return deps.repositories.list(organization);
}
