import { DocumentRepository } from '@/app/ports/repositories/document.repository';
import { DocumentChunkRepository } from '@/app/ports/repositories/document-chunk.repository';
import { DocumentConverter } from '@/app/ports/services/document-converter.service';
import { Chunker } from '@/app/ports/services/chunker.service';
import { EmbeddingProvider } from '@/app/ports/services/embedding-provider.service';
import { DocumentContent } from '@/app/ports/services/document-content.service';
import { UnitOfWork } from '@/app/ports/unit-of-work';

export interface IndexingDeps {
  documents: DocumentRepository;
  chunks: DocumentChunkRepository;
  converter: DocumentConverter;
  chunker: Chunker;
  embedder: EmbeddingProvider;
  content: DocumentContent;
  unitOfWork: UnitOfWork;
}
