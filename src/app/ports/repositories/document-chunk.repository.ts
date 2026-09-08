import { Chunk, EmbeddedChunk } from '@/domain/entities/chunk';
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

/**
 * Un trozo tal y como se lee del almacen. Extiende Chunk con lo que solo existe
 * una vez guardado, y NO tiene `embedding`: que el vector no pueda salir es una
 * propiedad del tipo y no un WHERE que alguien deba acordarse de escribir.
 */
export interface StoredChunk extends Chunk {
  id: number;
  /** En caracteres, que es la unidad en que esta configurado el troceado. */
  length: number;
}

export interface ChunkPage {
  total: number;
  chunks: StoredChunk[];
}

export interface ChunkPageQuery {
  document: string;
  // Obligatorio por el mismo motivo que en SearchQuery: sin ambito no compila.
  organization: string;
  limit: number;
  offset: number;
}

export interface DocumentChunkRepository {
  replace(document:string, organization:string, chunks:EmbeddedChunk[], scope?:TransactionScope): Promise<void>;
  deleteByDocument(document:string, scope?:TransactionScope): Promise<void>;
  countByDocument(document:string): Promise<number>;
  // Con ambito obligatorio, a diferencia de countByDocument: este si se alcanza
  // por HTTP, y el aislamiento no puede depender de quien lo llame.
  listByDocument(query:ChunkPageQuery): Promise<ChunkPage>;
  // El vector no sale nunca: un embedding es parcialmente reversible y hereda
  // la confidencialidad del documento.
  search(query:SearchQuery): Promise<SearchHit[]>;
}
