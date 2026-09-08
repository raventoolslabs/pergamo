import { DocumentRepository } from '@/app/ports/repositories/document.repository';
import { DocumentChunkRepository } from '@/app/ports/repositories/document-chunk.repository';
import { IndexQueue } from '@/app/ports/services/index-queue.service';
import { FileStorage } from '@/app/ports/services/file-storage.service';
import { ActiveContentDetector, DocumentScanner } from '@/app/ports/services/document-scanner.service';
import { FileTypeVerifier } from '@/app/ports/services/file-type.service';
import { UnitOfWork } from '@/app/ports/unit-of-work';

export interface DocumentDeps {
  documents: DocumentRepository;
  // Reemplazar el fichero invalida sus vectores, y borrar el documento se los
  // lleva por la clave foranea.
  chunks: DocumentChunkRepository;
  queue: IndexQueue;
  storage: FileStorage;
  scanner: DocumentScanner;
  activeContent: ActiveContentDetector;
  fileType: FileTypeVerifier;
  unitOfWork: UnitOfWork;
}
