import { DocumentRepository } from '@/app/ports/repositories/document.repository';
import { DocumentChunkRepository } from '@/app/ports/repositories/document-chunk.repository';
import { GitHubRepositoryRepository } from '@/app/ports/repositories/github-repository.repository';
import { GitHubSettingsRepository } from '@/app/ports/repositories/github-settings.repository';
import { GitHubClient } from '@/app/ports/services/github.service';
import { FileStorage } from '@/app/ports/services/file-storage.service';
import { SyncQueue } from '@/app/ports/services/sync-queue.service';
import { IndexQueue } from '@/app/ports/services/index-queue.service';
import { RescanQueue } from '@/app/ports/services/rescan-queue.service';
import { UnitOfWork } from '@/app/ports/unit-of-work';

export interface GitHubDeps {
  github: GitHubClient;
  // Token de la organizacion; el cliente de GitHub lo abre.
  settings: GitHubSettingsRepository;
  repositories: GitHubRepositoryRepository;
  documents: DocumentRepository;
  // Una baja se lleva los vectores en la misma transaccion.
  chunks: DocumentChunkRepository;
  // Solo cuando el repositorio pide copia en Pergamo.
  storage: FileStorage;
  syncQueue: SyncQueue;
  indexQueue: IndexQueue;
  // Lo importado entra sin veredicto: lo analiza el barrido de pendientes.
  rescanQueue: RescanQueue;
  unitOfWork: UnitOfWork;
}
