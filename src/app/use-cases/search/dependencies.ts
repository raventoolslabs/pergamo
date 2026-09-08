import { DocumentChunkRepository } from '@/app/ports/repositories/document-chunk.repository';
import { EmbeddingProvider } from '@/app/ports/services/embedding-provider.service';

export interface SearchDeps {
  chunks: DocumentChunkRepository;
  embedder: EmbeddingProvider;
}
