import dotenv from 'dotenv';
import path from 'path';
import { Dialect } from 'sequelize';

import { configSchema, formatIssues, optionalValue, parseBoolean } from '@/shared/validation';

dotenv.config();

const path_base = process.env.DIR_DATA ? process.env.DIR_DATA : path.join(__dirname, '..', '..', '..', 'data');
const valid_metadata_modify:string[] = process.env.VALID_METADATA_MODIFY ?
  process.env.VALID_METADATA_MODIFY.split(';').map((value) => value.trim()) : [];
const valid_mimetype:string[] = process.env.VALID_MIMETYPE ?
  process.env.VALID_MIMETYPE.split(';').map((value) => value.trim()) : [];
const malicious_active_content_ignore:string[] = process.env.MALICIOUS_ACTIVE_CONTENT_IGNORE ?
  process.env.MALICIOUS_ACTIVE_CONTENT_IGNORE.split(';').map((value) => value.trim()).filter(Boolean) : [];

const config = {
  path_base,
  tmp_base: path.join(path_base, 'tmp'),
  enable_antivirus: parseBoolean(process.env.ENABLE_ANTIVIRUS, false, 'ENABLE_ANTIVIRUS'),
  debug: parseBoolean(process.env.DEBUG, false, 'DEBUG'),
  remove_file_disk: parseBoolean(process.env.REMOVE_FILE_DISK, true, 'REMOVE_FILE_DISK'),
  // Sin esto NodeClam ejecuta el binario clamdscan local en vez de abrir
  // conexion, y con clamd en su propio contenedor eso no funciona.
  antivirus: {
    host: optionalValue(process.env.CLAMAV_HOST),
    port: process.env.CLAMAV_PORT ? Number.parseInt(process.env.CLAMAV_PORT) : 3310,
    socket: optionalValue(process.env.CLAMAV_SOCKET),
    timeout: process.env.CLAMAV_TIMEOUT ? Number.parseInt(process.env.CLAMAV_TIMEOUT) : 60000,
    init_retries: process.env.CLAMAV_INIT_RETRIES ? Number.parseInt(process.env.CLAMAV_INIT_RETRIES) : 10,
    init_retry_delay_ms: process.env.CLAMAV_INIT_RETRY_DELAY_MS ? Number.parseInt(process.env.CLAMAV_INIT_RETRY_DELAY_MS) : 3000
  },
  // Antiguedad a partir de la cual un temporal de subida en data/tmp se
  // considera huerfano (proceso caido a mitad de peticion) y se borra.
  tmp_max_age_ms: process.env.TMP_MAX_AGE_MS ? Number.parseInt(process.env.TMP_MAX_AGE_MS) : 3600000,
  tmp_cleanup_interval_ms: process.env.TMP_CLEANUP_INTERVAL_MS ? Number.parseInt(process.env.TMP_CLEANUP_INTERVAL_MS) : 900000,
  valid_metadata_modify,
  valid_mimetype,
  // Reglas de contenido activo que este despliegue no aplica: el equivalente de
  // docker/clamav/local.ign2 para el detector propio. Un archivo de facturas firmadas
  // lleva ficheros embebidos por norma y sin esta valvula queda en cuarentena
  // entero. Se anota siempre por que se ignora.
  malicious_active_content_ignore,
  max_version_file: process.env.MAX_VERSION_FILES ? Number.parseInt(process.env.MAX_VERSION_FILES) : 1,
  max_file_size: process.env.MAX_FILE_SIZE ? Number.parseInt(process.env.MAX_FILE_SIZE) : 52428800,
  port: process.env.PORT || 3000,
  jwt_expires_in: process.env.JWT_EXPIRES_IN ? process.env.JWT_EXPIRES_IN : '8h',
  trust_proxy: process.env.TRUST_PROXY ? Number.parseInt(process.env.TRUST_PROXY) : 0,
  rate_limit: {
    window_ms: process.env.RATE_LIMIT_WINDOW_MS ? Number.parseInt(process.env.RATE_LIMIT_WINDOW_MS) : 900000,
    max: process.env.RATE_LIMIT_MAX ? Number.parseInt(process.env.RATE_LIMIT_MAX) : 10
  },
  // Indexacion semantica. Desactivada por defecto: sin ella Pergamo se comporta
  // exactamente como antes de que existiera.
  indexing: {
    enabled: parseBoolean(process.env.INDEXING_ENABLED, false, 'INDEXING_ENABLED'),
    // Superarlo es ConversionUnsupportedError: un documento que produce miles de
    // trozos casi siempre es una extraccion que salio mal.
    max_chunks: process.env.INDEX_MAX_CHUNKS ? Number.parseInt(process.env.INDEX_MAX_CHUNKS) : 2000,
    chunk_size: process.env.INDEX_CHUNK_SIZE ? Number.parseInt(process.env.INDEX_CHUNK_SIZE) : 1500,
    chunk_overlap: process.env.INDEX_CHUNK_OVERLAP ? Number.parseInt(process.env.INDEX_CHUNK_OVERLAP) : 200,
    // Tope de tiempo por documento. El conversor abre ficheros no confiables:
    // un PDF construido para no terminar nunca no puede bloquear al worker.
    convert_timeout: process.env.INDEX_CONVERT_TIMEOUT ? Number.parseInt(process.env.INDEX_CONVERT_TIMEOUT) : 300000,
    embedding: {
      provider: process.env.EMBEDDING_PROVIDER || 'openai-compatible',
      base_url: optionalValue(process.env.EMBEDDING_BASE_URL),
      api_key: optionalValue(process.env.EMBEDDING_API_KEY),
      model: process.env.EMBEDDING_MODEL || 'bge-m3',
      // Parte del esquema: la columna se crea con esta anchura y cambiarla
      // despues exige reindexar. assertEmbeddingSchema lo comprueba al arrancar.
      dimension: process.env.EMBEDDING_DIMENSION ? Number.parseInt(process.env.EMBEDDING_DIMENSION) : 1024,
      batch_size: process.env.EMBEDDING_BATCH_SIZE ? Number.parseInt(process.env.EMBEDDING_BATCH_SIZE) : 16,
      timeout: process.env.EMBEDDING_TIMEOUT ? Number.parseInt(process.env.EMBEDDING_TIMEOUT) : 120000
    }
  },
  user_master: process.env.USER_MASTER,
  password_master: process.env.PASSWORD_MASTER,
  db: {
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,
    port: Number.parseInt(process.env.DB_PORT),
    name: process.env.DB_NAME,
    ssl: parseBoolean(process.env.DB_SSL, false, 'DB_SSL'),
    dialect: process.env.DB_DIALECT as Dialect || 'postgres' as Dialect
  }
}

// Se valida al cargar para que un .env mal escrito falle en el arranque, y no
// con un NaN viajando hasta la primera consulta.
const validation = configSchema.safeParse(config);

if(!validation.success) {
  throw new Error(`Invalid environment configuration -> ${formatIssues(validation.error)}`);
}

export default config;
