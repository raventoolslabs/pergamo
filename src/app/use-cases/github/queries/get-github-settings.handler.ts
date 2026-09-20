import { GitHubSettings } from '@/domain/entities/github';
import { GitHubDeps } from '../dependencies';
import { assertGitHubEnabled } from '../github-enabled';

export const getGitHubSettings = async (organization:string, deps:GitHubDeps):Promise<GitHubSettings | null> => {

  assertGitHubEnabled();

  return deps.settings.find(organization);
}
