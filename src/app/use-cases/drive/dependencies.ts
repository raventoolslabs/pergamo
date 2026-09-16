import { DocumentRepository } from '@/app/ports/repositories/document.repository';
import { DocumentChunkRepository } from '@/app/ports/repositories/document-chunk.repository';
import { DriveConnectionRepository } from '@/app/ports/repositories/drive-connection.repository';
import { DriveFolderRepository } from '@/app/ports/repositories/drive-folder.repository';
import { DriveClient } from '@/app/ports/services/drive.service';
import { DriveSyncQueue } from '@/app/ports/services/drive-sync-queue.service';
import { IndexQueue } from '@/app/ports/services/index-queue.service';
import { UnitOfWork } from '@/app/ports/unit-of-work';

export interface DriveDeps {
  drive: DriveClient;
  connections: DriveConnectionRepository;
  folders: DriveFolderRepository;
  documents: DocumentRepository;
  // Una baja se lleva los vectores en la misma transaccion.
  chunks: DocumentChunkRepository;
  syncQueue: DriveSyncQueue;
  indexQueue: IndexQueue;
  unitOfWork: UnitOfWork;
}
