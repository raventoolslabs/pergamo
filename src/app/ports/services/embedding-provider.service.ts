import { VectorDistance } from '@/domain/entities/search-index';

/**
 * Separar documentos de consulta es lo correcto porque la asimetria existe y
 * varia: BGE-M3 no distingue y no necesita prefijo, e5 exige 'query:' y
 * 'passage:' en el texto, Voyage usa input_type y OpenAI no distingue. Cada
 * proveedor resuelve lo suyo sin que el pipeline se entere.
 *
 * Lo que NO se abstrae es la comparabilidad: dos proveedores nunca comparten
 * espacio vectorial, y de ahi el versionado de indices.
 */
export interface EmbeddingProvider {
  readonly provider: string;
  readonly model: string;
  readonly dimension: number;
  readonly distance: VectorDistance;
  init(): Promise<void>;
  embedDocuments(texts:string[]): Promise<number[][]>;
  embedQuery(text:string): Promise<number[]>;
}
