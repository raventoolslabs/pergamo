import { DriveFolder } from '@/domain/entities/drive';

export interface NewDriveFolder {
  organization: string;
  folderId: string;
  name: string;
  indexDocuments: boolean;
}

export interface DriveFolderRepository {
  create(folder:NewDriveFolder): Promise<DriveFolder>;
  findById(organization:string, id:string): Promise<DriveFolder | null>;
  list(organization:string): Promise<DriveFolder[]>;
  // Todas las organizaciones: el arranque reprograma las sincronizaciones periodicas.
  listAll(): Promise<DriveFolder[]>;
  remove(organization:string, id:string): Promise<boolean>;
  recordSync(id:string, date:Date, error?:string): Promise<void>;
}
