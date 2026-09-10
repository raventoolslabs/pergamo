import { z } from "zod";

// Las claves editables son configurables, asi que aqui se valida la forma y el
// tamano del valor: sin esto un cliente autenticado puede almacenar estructuras
// arbitrariamente grandes en la columna JSONB.
export const metadataValueSchema = z.union([
  z.string().max(1024),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(256)).max(64)
]);

// Sin esto un '%' del cliente deja de ser un caracter a buscar y devuelve la
// tabla entera. La barra invertida va tambien: es el escape por defecto de LIKE.
export const escapeLike = (value:string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

/**
 * Tolerante con las formas habituales y estricto con lo demas: un valor no
 * reconocido detiene el arranque en vez de resolverse hacia el lado inseguro.
 * Con `env.X === 'true'`, un `TRUE` desactivaba ENABLE_ANTIVIRUS en silencio.
 */
const TRUE_VALUES = new Set(['true', '1', 'yes', 'y', 'on']);
const FALSE_VALUES = new Set(['false', '0', 'no', 'n', 'off']);

/**
 * Una clave presente y vacia en el .env llega como cadena vacia, no como
 * ausente, y entonces una validacion de opcional no se aplica: `EMBEDDING_BASE_URL=`
 * fallaba con «Invalid URL» en vez de leerse como «no hay».
 */
export const optionalValue = (value:string|undefined) => {

  const trimmed = value?.trim();

  return trimmed ? trimmed : undefined;
}

export const parseBoolean = (value:string|undefined, defaultValue:boolean, name:string) => {

  if(value === undefined || value.trim() === '') return defaultValue;

  const normalized = value.trim().toLowerCase();

  if(TRUE_VALUES.has(normalized)) return true;
  if(FALSE_VALUES.has(normalized)) return false;

  throw new Error(`Invalid environment configuration -> ${name}: "${value}" is not a boolean (accepted: ${[...TRUE_VALUES, ...FALSE_VALUES].join(', ')})`);
}

// Se validan al arrancar para fallar de inmediato, en vez de propagar valores
// como NaN hasta la primera consulta.
export const configSchema = z.object({
  port: z.union([z.string(), z.number()]),
  // Zod ignora las claves que no declara: omitirlas aqui equivale a no
  // validarlas.
  enable_antivirus: z.boolean(),
  debug: z.boolean(),
  remove_file_disk: z.boolean(),
  antivirus: z.object({
    host: z.string().min(1).optional(),
    port: z.number().int().positive(),
    socket: z.string().min(1).optional(),
    timeout: z.number().int().positive(),
    init_retries: z.number().int().min(0),
    init_retry_delay_ms: z.number().int().positive()
  }),
  max_version_file: z.number().int().positive(),
  max_file_size: z.number().int().positive(),
  jwt_expires_in: z.string().min(1),
  trust_proxy: z.number().int().min(0),
  rate_limit: z.object({
    window_ms: z.number().int().positive(),
    max: z.number().int().positive()
  }),
  valid_mimetype: z.array(z.string()).min(1),
  // Los nombres se contrastan con las reglas reales en app.ts: importar el
  // detector aqui crearia un ciclo.
  malicious_active_content_ignore: z.array(z.string()),
  queue: z.object({
    redis_url: z.string().min(1),
    prefix: z.string().min(1)
  }),
  indexing: z.object({
    enabled: z.boolean(),
    worker_embedded: z.boolean(),
    concurrency: z.number().int().positive(),
    stale_after_ms: z.number().int().positive(),
    max_chunks: z.number().int().positive(),
    search_candidates_factor: z.number().int().positive(),
    chunk_size: z.number().int().positive(),
    chunk_overlap: z.number().int().min(0),
    convert_timeout: z.number().int().positive(),
    embedding: z.object({
      provider: z.enum(['openai-compatible']),
      base_url: z.string().url().optional(),
      api_key: z.string().min(1).optional(),
      model: z.string().min(1),
      // Tope de pgvector para un indice HNSW sobre el tipo `vector`.
      dimension: z.number().int().min(1).max(2000),
      batch_size: z.number().int().positive(),
      timeout: z.number().int().positive()
    })
  }),
  db: z.object({
    username: z.string().min(1),
    // Hay despliegues legitimos sin contrasena (trust, peer o IAM).
    password: z.string().optional(),
    host: z.string().min(1),
    port: z.number().int().positive(),
    name: z.string().min(1),
    ssl: z.boolean()
  })
})
// El antivirus no necesita esta regla: sin host ni socket declarados,
// shared/config pone el socket del paquete, asi que destino hay siempre. Que ese
// destino responda no lo puede saber un esquema, y lo comprueba dev.js.
//
// Sin destino al que pedir vectores, en cambio, la indexacion solo puede fallar
// en el primer trabajo. Se detecta en el arranque.
.refine((config) => !config.indexing.enabled || !!config.indexing.embedding.base_url, {
  message: 'INDEXING_ENABLED requires EMBEDDING_BASE_URL',
  path: ['indexing', 'embedding', 'base_url']
})
// El solapamiento igual o mayor que el trozo no avanza: el troceado no
// terminaria nunca.
.refine((config) => config.indexing.chunk_overlap < config.indexing.chunk_size, {
  message: 'INDEX_CHUNK_OVERLAP must be smaller than INDEX_CHUNK_SIZE',
  path: ['indexing', 'chunk_overlap']
});

export const formatIssues = (error:any) =>
  error.issues.map((issue:any) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
