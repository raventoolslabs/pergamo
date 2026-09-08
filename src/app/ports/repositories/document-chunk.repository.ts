import { EmbeddedChunk } from '@/domain/entities/chunk';
import { TransactionScope } from '@/app/ports/unit-of-work';

export interface SearchQuery {
  // Obligatorio en el tipo: una busqueda sin ambito no compila. Es la unica
  // defensa que no depende de que nadie olvide un WHERE.
  organization: string;
  embedding: number[];
  // El texto original, para la mitad lexica: un vector no encuentra un numero
  // de factura ni un nombre propio que el modelo no vio nunca.
  text: string;
  // Cuantos trae cada mitad antes de fusionar. Recortar a lo que se devuelve es
  // cosa del caso de uso: es la sutura por donde entraria un reranker.
  candidates: number;
  limit: number;
}

export interface SearchHit {
  chunk: number;
  document: string;
  content: string;
  page?: number;
  section?: string;
  headingPath: string[];
  // Coseno con la consulta. Siempre presente, tambien cuando el trozo entro
  // solo por la mitad lexica: es lo que permite poner un umbral.
  similarity: number;
  // Puntuacion de la fusion. No es una similitud y no se debe leer como tal.
  score: number;
}

export interface DocumentChunkRepository {
  replace(document:string, organization:string, chunks:EmbeddedChunk[], scope?:TransactionScope): Promise<void>;
  deleteByDocument(document:string, scope?:TransactionScope): Promise<void>;
  countByDocument(document:string): Promise<number>;
  // El vector no sale nunca: un embedding es parcialmente reversible y hereda
  // la confidencialidad del documento.
  search(query:SearchQuery): Promise<SearchHit[]>;
}
