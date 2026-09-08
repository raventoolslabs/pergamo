import Config from '@/shared/config';
import log from '@/shared/logger';
import { ProviderUnavailableError } from '@/domain/exceptions/indexing.exception';
import { EmbeddingProvider } from '@/app/ports/services/embedding-provider.service';

/**
 * Un solo cliente cubre Ollama, vLLM y OpenAI: los tres exponen
 * POST /embeddings con { model, input } y devuelven data[].embedding.
 *
 * BGE-M3 no distingue consulta de documento y no necesita prefijo, asi que las
 * dos operaciones comparten camino; otro modelo que si lo necesite se resuelve
 * en su propio adaptador, sin que el pipeline se entere.
 */
const endpoint = () => `${(Config.indexing.embedding.base_url || '').replace(/\/+$/, '')}/embeddings`;

const headers = () => {

  const value:Record<string, string> = { 'Content-Type': 'application/json' };
  const key = Config.indexing.embedding.api_key;

  if(key) value['Authorization'] = `Bearer ${key}`;

  return value;
}

const request = async (input:string[]):Promise<number[][]> => {

  const { model, timeout, dimension } = Config.indexing.embedding;

  let response:Response;

  try {

    response = await fetch(endpoint(), {
      method: 'POST',
      headers: headers(),
      // `dimensions` viaja siempre: es lo que permite que un modelo de otra
      // anchura nativa —los text-embedding-3 de OpenAI son 1536— entregue
      // vectores del tamano que tiene la columna, en vez de obligar a una
      // version nueva del indice por cambiar de proveedor. Ollama, vLLM y
      // OpenAI lo aceptan; uno que no, falla en init() y no en el primer
      // trabajo.
      body: JSON.stringify({ model, input, dimensions: dimension }),
      signal: AbortSignal.timeout(timeout)
    });

  } catch(error:any) {
    // No responde: se reintenta, y hasta entonces el documento se queda
    // pendiente. Nunca se marca indexado sin vector.
    throw new ProviderUnavailableError(
      `Embedding provider at ${endpoint()} did not answer: ${error.message || error.name}`);
  }

  if(!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 200);
    throw new ProviderUnavailableError(
      `Embedding provider at ${endpoint()} answered ${response.status}: ${detail}`);
  }

  const body:any = await response.json().catch(() => null);
  const data = body?.data;

  if(!Array.isArray(data) || data.length !== input.length) throw new ProviderUnavailableError(
    `Embedding provider returned ${data?.length ?? 'no'} vectors for ${input.length} inputs`);

  // El orden no esta garantizado por el contrato: cada elemento trae su indice.
  const vectors:number[][] = new Array(input.length);

  for(const item of data) {
    const index = typeof item?.index === 'number' ? item.index : data.indexOf(item);
    vectors[index] = item?.embedding;
  }

  vectors.forEach((vector, index) => {
    if(!Array.isArray(vector) || vector.length !== dimension) throw new Error(
      `Embedding provider returned ${vector?.length} dimensions for input ${index}, and the index is ${dimension}. ` +
      'Either the model does not honour the requested "dimensions" or EMBEDDING_DIMENSION is wrong: ' +
      'the width is part of the schema and the two cannot disagree.');
  });

  return vectors;
}

export const openAiCompatibleEmbedder:EmbeddingProvider = {

  provider: 'openai-compatible',

  get model() { return Config.indexing.embedding.model; },
  get dimension() { return Config.indexing.embedding.dimension; },

  // El indice se crea con vector_cosine_ops, que obliga a consultar con '<=>'.
  // Cambiar esto sin cambiar el indice deja toda busqueda en seq scan callado.
  distance: 'cosine',

  /**
   * Se prueba el proveedor ANTES de aceptar trabajos: un modelo que no esta
   * descargado o una dimension que no cuadra deben parar el arranque, no
   * aparecer a mitad de una reindexacion.
   */
  async init() {

    const [probe] = await request(['pergamo']);

    log.info(`Embeddings: ${this.model} (${probe.length} dimensions) at ${endpoint()}`);
  },

  /**
   * Por lotes, no de uno en uno: es, con diferencia, lo que mas afecta al
   * tiempo total de una reindexacion.
   */
  async embedDocuments(texts) {

    const size = Config.indexing.embedding.batch_size;
    const vectors:number[][] = [];

    for(let start = 0; start < texts.length; start += size) {
      vectors.push(...await request(texts.slice(start, start + size)));
    }

    return vectors;
  },

  async embedQuery(text) {
    const [vector] = await request([text]);
    return vector;
  }
};
