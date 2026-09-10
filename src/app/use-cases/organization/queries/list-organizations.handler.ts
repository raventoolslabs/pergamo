import { OrganizationListFilter, OrganizationPage } from '@/app/ports/repositories/organization.repository';
import { OrganizationDeps } from '../dependencies';

/**
 * Solo para el maestro: es el que necesita elegir sobre cual actuar al cambiar
 * una contrasena. Quien lo comprueba es el middleware de la ruta.
 */
export const listOrganizations = async (filter:OrganizationListFilter, deps:OrganizationDeps):Promise<OrganizationPage> =>
  deps.organizations.list(filter);
