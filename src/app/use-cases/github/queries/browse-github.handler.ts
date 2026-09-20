import { GitHubEntry } from '@/domain/entities/github';
import { GitHubDeps } from '../dependencies';
import { assertGitHubEnabled } from '../github-enabled';

// Repositorios a los que alcanza el token, para el selector.
export const browseGitHub = async (organization:string, deps:GitHubDeps):Promise<GitHubEntry[]> => {

  assertGitHubEnabled();

  return deps.github.repositories(organization);
}

export const listGitHubBranches = async (organization:string, owner:string, repository:string, deps:GitHubDeps):Promise<string[]> => {

  assertGitHubEnabled();

  return deps.github.branches(organization, owner, repository);
}
