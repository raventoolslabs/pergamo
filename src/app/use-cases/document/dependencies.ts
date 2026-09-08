import { DocumentRepository } from '@/app/ports/repositories/document.repository';
import { FileStorage } from '@/app/ports/services/file-storage.service';
import { ActiveContentDetector, DocumentScanner } from '@/app/ports/services/document-scanner.service';
import { FileTypeVerifier } from '@/app/ports/services/file-type.service';
import { UnitOfWork } from '@/app/ports/unit-of-work';

export interface DocumentDeps {
  documents: DocumentRepository;
  storage: FileStorage;
  scanner: DocumentScanner;
  activeContent: ActiveContentDetector;
  fileType: FileTypeVerifier;
  unitOfWork: UnitOfWork;
}
