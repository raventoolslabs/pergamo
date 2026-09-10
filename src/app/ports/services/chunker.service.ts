import { Chunk, ConvertedDocument } from '@/domain/entities/chunk';

export interface Chunker {
  readonly name: string;
  // Cambiar la estrategia debe poder disparar una reindexacion, asi que se
  // graba con cada documento.
  readonly version: string;
  split(document:ConvertedDocument): Chunk[];
}
