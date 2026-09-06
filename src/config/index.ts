import dotenv from 'dotenv';
import path from 'path';
import { Dialect } from 'sequelize';

import { configSchema, formatIssues, parseBoolean } from '../utils/validation';

dotenv.config();

const path_base = process.env.DIR_DATA ? process.env.DIR_DATA : path.join(__dirname, '..','..', 'data');
const valid_metadata_modify:string[] = process.env.VALID_METADATA_MODIFY ?
  process.env.VALID_METADATA_MODIFY.split(';').map((value) => value.trim()) : [];
const valid_mimetype:string[] = process.env.VALID_MIMETYPE ?
  process.env.VALID_MIMETYPE.split(';').map((value) => value.trim()) : [];

const config = {
  path_base,
  tmp_base: path.join(path_base, 'tmp'),
  enable_antivirus: parseBoolean(process.env.ENABLE_ANTIVIRUS, false, 'ENABLE_ANTIVIRUS'),
  debug: parseBoolean(process.env.DEBUG, false, 'DEBUG'),
  remove_file_disk: parseBoolean(process.env.REMOVE_FILE_DISK, true, 'REMOVE_FILE_DISK'),
  // Datos de conexion con clamd. Sin esto NodeClam usa sus defaults
  // (socket/host/port a false), que hacen que ejecute el binario clamdscan
  // local en lugar de abrir conexion: con clamd en su propio contenedor eso no
  // funciona en absoluto.
  antivirus: {
    host: process.env.CLAMAV_HOST,
    port: process.env.CLAMAV_PORT ? Number.parseInt(process.env.CLAMAV_PORT) : 3310,
    socket: process.env.CLAMAV_SOCKET,
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
  max_version_file: process.env.MAX_VERSION_FILES ? Number.parseInt(process.env.MAX_VERSION_FILES) : 1,
  max_file_size: process.env.MAX_FILE_SIZE ? Number.parseInt(process.env.MAX_FILE_SIZE) : 52428800,
  port: process.env.PORT || 3000,
  jwt_expires_in: process.env.JWT_EXPIRES_IN ? process.env.JWT_EXPIRES_IN : '8h',
  trust_proxy: process.env.TRUST_PROXY ? Number.parseInt(process.env.TRUST_PROXY) : 0,
  rate_limit: {
    window_ms: process.env.RATE_LIMIT_WINDOW_MS ? Number.parseInt(process.env.RATE_LIMIT_WINDOW_MS) : 900000,
    max: process.env.RATE_LIMIT_MAX ? Number.parseInt(process.env.RATE_LIMIT_MAX) : 10
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

// Se valida al cargar la configuracion para que un .env incompleto o mal
// escrito falle en el arranque, y no mas tarde con un NaN o un undefined
// viajando hasta la primera consulta.
const validation = configSchema.safeParse(config);

if(!validation.success) {
  throw new Error(`Invalid environment configuration -> ${formatIssues(validation.error)}`);
}

export default config;
