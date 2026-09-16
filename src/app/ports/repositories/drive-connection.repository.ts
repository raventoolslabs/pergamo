import { DriveConnection } from '@/domain/entities/drive';
import { DriveGrant } from '@/app/ports/services/drive.service';

export interface DriveConnectionRepository {
  find(organization:string): Promise<DriveConnection | null>;
  // Reconectar sustituye la conexion anterior y levanta la revocacion.
  save(grant:DriveGrant): Promise<DriveConnection>;
  // Sellado; solo lo usa el adaptador de Drive.
  sealedRefreshToken(organization:string): Promise<string | null>;
  markRevoked(organization:string): Promise<void>;
  remove(organization:string): Promise<void>;
}
