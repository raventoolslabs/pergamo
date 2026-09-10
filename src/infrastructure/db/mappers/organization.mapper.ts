import { Organization } from '@/domain/entities/organization';
import { OrganizationRow } from '@/infrastructure/db/schema/organization.row';

export const toOrganization = (row:OrganizationRow):Organization => ({
  id: row.id,
  creationDate: row.creation_date,
  modificationDate: row.modification_date,
  dischargeDate: row.discharge_date === null ? undefined : row.discharge_date,
  name: row.name
});
