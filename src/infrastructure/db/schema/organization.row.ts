export interface OrganizationRow {
  id: string;
  creation_date: Date;
  modification_date: Date;
  discharge_date: Date | null;
  name: string;
  total?: string;
}
