import { Organization } from '@/domain/entities/organization';
import { ValidationError } from '@/domain/exceptions/domain.exception';
import { assertPasswordStrength } from '@/domain/value-objects/password';
import { OrganizationDeps } from '../dependencies';

export interface CreateOrganizationInput {
  id?: string;
  name?: string;
  password?: string;
}

export const createOrganization = async (input:CreateOrganizationInput, deps:OrganizationDeps):Promise<Organization> => {

  if(!input?.name) throw new ValidationError('REQUIRED_NAME', 'Required name');
  if(!input?.password) throw new ValidationError('REQUIRED_PASSWORD', 'Required password');

  assertPasswordStrength(input.password);

  return deps.organizations.create(input.name, input.password, input.id);
}
