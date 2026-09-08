import { EmbeddedChunk } from '@/domain/entities/chunk';
import { TransactionScope } from '@/app/ports/unit-of-work';

export interface SearchQuery {
  // Obligatorio en el tipo: una busqueda sin ambito no compila. Es la unica
  // defensa que no depende de que nadie olvide un WHERE.
  organization: string;
  embedding: number[];
  limit: number;
}

export interface SearchHit {
  chunk: number;
  document: string;
  content: string;
  page?: number;
  section?: string;
  headingPath: string[];
  similarity: number;
}

export interface DocumentChunkRepository {
  replace(document:string, organization:string, chunks:EmbeddedChunk[], scope?:TransactionScope): Promise<void>;
  deleteByDocument(document:string, scope?:TransactionScope): Promise<void>;
  countByDocument(document:string): Promise<number>;
  // El vector no sale nunca: un embedding es parcialmente reversible y hereda
  // la confidencialidad del documento.
  search(query:SearchQuery): Promise<SearchHit[]>;
}
