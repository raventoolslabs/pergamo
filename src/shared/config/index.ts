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

// La ruta del paquete de Debian, que es donde clamd escucha si nadie dice otra
// cosa. Otras distribuciones la cambian, y para eso esta CLAMAV_SOCKET.
const DEFAULT_CLAMAV_SOCKET = '/run/clamav/clamd.ctl';

const config = {
  path_base,
  tmp_base: path.join(path_base, 'tmp'),
  enable_antivirus: parseBoolean(process.env.ENABLE_ANTIVIRUS, false, 'ENABLE_ANTIVIRUS'),
  debug: parseBoolean(process.env.DEBUG, false, 'DEBUG'),
  remove_file_disk: parseBoolean(process.env.REMOVE_FILE_DISK, true, 'REMOVE_FILE_DISK'),
  // Sin esto NodeClam ejecuta el binario clamdscan local en vez de abrir
  // conexion, y dentro de un contenedor ese binario no existe.
  antivirus: {
    // Solo lo declarado: el defecto vive en `socket`, y un host ademas obligaria
    // a NodeClam a elegir entre dos destinos.
    host: optionalValue(process.env.CLAMAV_HOST),
    port: process.env.CLAMAV_PORT ? Number.parseInt(process.env.CLAMAV_PORT) : 3310,
    // Sin destino declarado se asume el socket local y no 127.0.0.1:3310, porque
    // un clamav-daemon instalado del paquete NO escucha en ningun puerto: el de
    // Debian declara LocalSocket y ningun TCPSocket, de modo que el TCP se
    // rechaza con el demonio vivo y las firmas al dia.
    //
    // Es tambien lo que usa Docker: el compose monta /run/clamav del host.
    // Declarar un host lo desactiva.
    socket: optionalValue(process.env.CLAMAV_SOCKET) ||
      (optionalValue(process.env.CLAMAV_HOST) ? undefined : DEFAULT_CLAMAV_SOCKET),
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
  // Reglas de contenido activo que este despliegue no aplica: el equivalente del
  // local.ign2 de clamd para el detector propio. Un archivo de facturas firmadas
  // lleva ficheros embebidos por norma y sin esta valvula queda en cuarentena
  // entero. Se anota siempre por que se ignora.
  malicious_active_content_ignore,
  max_version_file: process.env.MAX_VERSION_FILES ? Number.parseInt(process.env.MAX_VERSION_FILES) : 1,
  // 25 MiB, que es el tope que clamd analiza con su configuracion de serie
  // (StreamMaxLength y MaxFileSize valen 25M en el paquete de las
  // distribuciones). Aceptar mas de lo que el escaner mira deja entrar
  // documentos sin analizar y sin decirlo: se guardan 'pending' porque el
  // escaner corta la conexion, y ese estado no se distingue de una caida.
  // La configuracion de referencia de clamd (seccion ClamAV del README) sube
  // esos limites a 64M, de modo que ahi si se puede subir este valor.
  max_file_size: process.env.MAX_FILE_SIZE ? Number.parseInt(process.env.MAX_FILE_SIZE) : 26214400,
  port: process.env.PORT || 6230,
  jwt_expires_in: process.env.JWT_EXPIRES_IN ? process.env.JWT_EXPIRES_IN : '8h',
  trust_proxy: process.env.TRUST_PROXY ? Number.parseInt(process.env.TRUST_PROXY) : 0,
  rate_limit: {
    window_ms: process.env.RATE_LIMIT_WINDOW_MS ? Number.parseInt(process.env.RATE_LIMIT_WINDOW_MS) : 900000,
    max: process.env.RATE_LIMIT_MAX ? Number.parseInt(process.env.RATE_LIMIT_MAX) : 10
  },
  // Fuera de `indexing`: la cola tambien mueve el barrido del antivirus, que no
  // tiene nada que ver con indexar.
  queue: {
    redis_url: optionalValue(process.env.REDIS_URL) || 'redis://127.0.0.1:6379',
    // Redis puede estar compartido: el prefijo mantiene las claves de Pergamo
    // separadas de las de cualquier otra cosa que viva ahi.
    //
    // Se sigue leyendo el nombre viejo: cambiarlo a secas en un despliegue en
    // marcha moveria el prefijo y dejaria huerfanos los trabajos ya encolados.
    prefix: optionalValue(process.env.QUEUE_PREFIX)
      || optionalValue(process.env.INDEXING_QUEUE_PREFIX) || 'pergamo'
  },

  // Indexacion semantica. Desactivada por defecto: sin ella Pergamo se comporta
  // exactamente como antes de que existiera.
  indexing: {
    enabled: parseBoolean(process.env.INDEXING_ENABLED, false, 'INDEXING_ENABLED'),
    // Dos claves y no un enum de tres valores: asi no existe el estado
    // imposible «worker embebido con la indexacion desactivada».
    worker_embedded: parseBoolean(process.env.INDEXING_WORKER_EMBEDDED, true, 'INDEXING_WORKER_EMBEDDED'),
    concurrency: process.env.INDEXING_CONCURRENCY ? Number.parseInt(process.env.INDEXING_CONCURRENCY) : 1,
    // Un trabajo que se queda en 'indexing' mas de esto es un worker que murio
    // a media faena, y lo recupera el barrido.
    stale_after_ms: process.env.INDEXING_STALE_AFTER_MS ? Number.parseInt(process.env.INDEXING_STALE_AFTER_MS) : 3600000,
    // Superarlo es ConversionUnsupportedError: un documento que produce miles de
    // trozos casi siempre es una extraccion que salio mal.
    max_chunks: process.env.INDEX_MAX_CHUNKS ? Number.parseInt(process.env.INDEX_MAX_CHUNKS) : 2000,
    // Cuanto se pide de mas antes de recortar. Es lo que deja sitio a un
    // reranker sin cambiar el endpoint ni el almacen.
    search_candidates_factor: process.env.SEARCH_CANDIDATES_FACTOR ?
      Number.parseInt(process.env.SEARCH_CANDIDATES_FACTOR) : 4,
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
