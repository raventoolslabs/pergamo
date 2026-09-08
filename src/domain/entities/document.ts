export type ScanStatus = 'pending' | 'clean' | 'infected' | 'error';

export default interface Document {
  id: string;
  creation_date: Date;
  modification_date: Date;
  path: string,
  metadata:any,
  // Estado del analisis antivirico. Vive en columnas propias y no en metadata
  // porque metadata es modificable por el cliente: ver 003_document_scan_status.sql.
  scan_status: ScanStatus,
  scan_signature?: string,
  scan_engine?: string,
  scan_date?: Date
}
