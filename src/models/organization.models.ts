export default interface Organization {
  id: string;
  creation_date: Date;
  modification_date: Date;
  discharge_date?: Date;
  name: string;
  password?: string;
}
