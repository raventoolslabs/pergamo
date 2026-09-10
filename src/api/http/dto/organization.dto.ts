import { Organization } from '@/domain/entities/organization';

export const toOrganizationResponse = (organization:Organization) => ({
  id: organization.id,
  name: organization.name,
  creation_date: organization.creationDate,
  modification_date: organization.modificationDate,
  discharge_date: organization.dischargeDate ?? null
});
