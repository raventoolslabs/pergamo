import { Organization } from '@/domain/entities/organization';

export interface OrganizationListFilter {
  limit: number;
  offset: number;
  name?: string;
  includeDischarged: boolean;
}

export interface OrganizationPage {
  total: number;
  organizations: Organization[];
}

export interface OrganizationRepository {
  findByCredentials(name:string, password:string): Promise<Organization | null>;
  create(name:string, password:string, id?:string): Promise<Organization>;
  // false si la contrasena nueva es la que ya tenia.
  changePassword(organization:string, password:string): Promise<boolean>;
  list(filter:OrganizationListFilter): Promise<OrganizationPage>;
}
