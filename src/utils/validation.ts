import { z } from "zod";

/**
 * Valores admitidos para un campo de metadatos editable. La lista de claves
 * editables es configurable (VALID_METADATA_MODIFY), asi que aqui no se validan
 * claves concretas sino la forma y el tamano del valor: sin esto, un cliente
 * autenticado puede almacenar estructuras arbitrariamente grandes en la columna
 * JSONB.
 */
export const metadataValueSchema = z.union([
  z.string().max(1024),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(256)).max(64)
]);

/**
 * Interruptores booleanos por variable de entorno.
 *
 * El patron anterior (`process.env.X === 'true'`) exigia el literal exacto: un
 * `True`, `TRUE`, `1` o `yes` desactivaba en silencio la funcionalidad. Para un
 * interruptor como ENABLE_ANTIVIRUS eso significa un despliegue corriendo sin
 * escaneo alguno sin que nada lo indique.
 *
 * Aqui el parseo es tolerante con las formas habituales y **estricto con lo
 * demas**: un valor no reconocido detiene el arranque en vez de resolverse
 * hacia el lado inseguro.
 */
const TRUE_VALUES = new Set(['true', '1', 'yes', 'y', 'on']);
const FALSE_VALUES = new Set(['false', '0', 'no', 'n', 'off']);

export const parseBoolean = (value:string|undefined, defaultValue:boolean, name:string) => {

  if(value === undefined || value.trim() === '') return defaultValue;

  const normalized = value.trim().toLowerCase();

  if(TRUE_VALUES.has(normalized)) return true;
  if(FALSE_VALUES.has(normalized)) return false;

  throw new Error(`Invalid environment configuration -> ${name}: "${value}" is not a boolean (accepted: ${[...TRUE_VALUES, ...FALSE_VALUES].join(', ')})`);
}

/**
 * Variables de entorno de las que depende el arranque. Se validan al iniciar
 * para fallar de inmediato y con un mensaje claro, en vez de propagar valores
 * como NaN hasta la primera consulta.
 */
export const configSchema = z.object({
  port: z.union([z.string(), z.number()]),
  // Presentes en el esquema para que un despliegue no pueda arrancar con el
  // antivirus mal configurado: Zod ignora las claves que no declara, asi que
  // omitirlas aqui equivale a no validarlas.
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
  db: z.object({
    username: z.string().min(1),
    // Opcional: hay despliegues legitimos sin contrasena (autenticacion trust,
    // peer o basada en IAM).
    password: z.string().optional(),
    host: z.string().min(1),
    port: z.number().int().positive(),
    name: z.string().min(1),
    ssl: z.boolean()
  })
})
// El antivirus activado sin destino al que conectarse es una configuracion que
// solo puede fallar en la primera subida. Se detecta en el arranque.
.refine((config) => !config.enable_antivirus || !!(config.antivirus.host || config.antivirus.socket), {
  message: 'ENABLE_ANTIVIRUS requires CLAMAV_HOST or CLAMAV_SOCKET',
  path: ['antivirus', 'host']
});

export const formatIssues = (error:any) =>
  error.issues.map((issue:any) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
