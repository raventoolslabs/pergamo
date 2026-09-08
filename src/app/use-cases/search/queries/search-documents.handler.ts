import Config from '@/shared/config';
import { SearchHit } from '@/app/ports/repositories/document-chunk.repository';
import { ValidationError } from '@/domain/exceptions/domain.exception';
import { SearchDeps } from '../dependencies';

export interface SearchDocumentsInput {
  // Sin valor por defecto y sin opcional: quien llama tiene que decir sobre que
  // fondo busca, y el unico sitio de donde sale es el token.
  organization: string;
  query: string;
  limit: number;
  minSimilarity?: number;
}

export const searchDocuments = async (input:SearchDocumentsInput, deps:SearchDeps):Promise<SearchHit[]> => {

  const { organization, query, limit, minSimilarity } = input;

  // El token maestro no lleva organizacion: sin este corte la consulta filtra
  // por undefined y no devuelve nada, que se lee como «no hay resultados».
  if(!organization) throw new ValidationError('ORGANIZATION_REQUIRED',
    'A master token has no organization: log in as an organization to search');

  if(!Config.indexing.enabled) throw new ValidationError('INDEXING_DISABLED',
    'This deployment does not index documents, so there is nothing to search');

  const embedding = await deps.embedder.embedQuery(query);

  // Se pide de mas y se recorta despues. Es la sutura por la que entraria un
  // reranker sin tocar ni el almacen ni el endpoint.
  const hits = await deps.chunks.search({
    organization,
    embedding,
    text: query,
    candidates: Math.max(limit * Config.indexing.search_candidates_factor, limit),
    limit: limit * Config.indexing.search_candidates_factor
  });

  const relevant = minSimilarity === undefined ?
    hits : hits.filter((hit) => hit.similarity >= minSimilarity);

  return relevant.slice(0, limit);
}
