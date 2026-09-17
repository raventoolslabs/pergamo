import { DriveEntry, DriveFile } from '@/domain/entities/drive';

/**
 * Lo que devuelve Google al completar la conexion. El refresh_token llega ya
 * sellado: la capa app lo guarda sin poder leerlo.
 */
export interface DriveGrant {
  organization: string;
  googleAccount: string;
  sealedRefreshToken: string;
  scope: string;
}

/**
 * Los metodos reciben la organizacion y nunca el token: el adaptador lo
 * descifra para si mismo, y ningun secreto atraviesa la capa app.
 */
export interface DriveClient {
  // El state sellado lleva la organizacion y el verificador PKCE.
  authUrl(organization:string): Promise<string>;
  // La organizacion sale del state, no de quien llama.
  exchange(state:string, code:string): Promise<DriveGrant>;
  folder(organization:string, folderId:string): Promise<DriveEntry>;
  // Subcarpetas; sin carpeta, las de la raiz.
  children(organization:string, folderId?:string): Promise<DriveEntry[]>;
  // Perezoso: el arbol entero nunca cabe en memoria.
  walk(organization:string, folderId:string): AsyncIterable<DriveFile>;
  // false si el fichero ya no existe en Drive.
  download(organization:string, fileId:string, target:string): Promise<boolean>;
}
