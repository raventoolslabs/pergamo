import { ValidationError } from '@/domain/exceptions/domain.exception';
import { assertPasswordStrength } from '@/domain/value-objects/password';
import { OrganizationDeps } from '../dependencies';

export interface ChangePasswordInput {
  organization?: string;
  password?: string;
}

export const changePassword = async (input:ChangePasswordInput, deps:OrganizationDeps):Promise<void> => {

  if(!input?.password) throw new ValidationError('REQUIRED_PASSWORD', 'Required password');

  assertPasswordStrength(input.password);

  const changed = await deps.organizations.changePassword(input.organization, input.password);

  if(!changed) throw new ValidationError('SAME_PASSWORD', 'Password is the same');
}
