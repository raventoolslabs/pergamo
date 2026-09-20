import Config from '@/shared/config';
import { ValidationError } from '@/domain/exceptions/domain.exception';

export const assertGitHubEnabled = () => {
  if(!Config.github.enabled) throw new ValidationError('GITHUB_DISABLED', 'This deployment has no GitHub integration');
};
