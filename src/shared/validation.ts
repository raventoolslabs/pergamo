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

// Llegan de la query string, siempre como cadena. El limite superior impide
// pedir la tabla entera en una sola peticion.
const paginationSchema = {
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0)
};

// 'malicious' es cuarentena decidida por Pergamo y no por el escaner: no sale
// de ahi por reanalizarlo, sino por `npm run scan:release`.
export const SCAN_STATUS = ['pending', 'clean', 'infected', 'error', 'malicious'] as const;

/**
 * Uno o varios estados separados por comas: la interfaz agrupa 'infected' y
 * 'malicious', que para quien consulta significan lo mismo. Cada valor se
 * valida por separado, asi que lo que no este en el enum devuelve 400.
 */
const scanStatusFilter = z.string()
  .transform((value) => value.split(','))
  .pipe(z.array(z.enum(SCAN_STATUS)).min(1).max(SCAN_STATUS.length));

/**
 * 'sort' y 'order' terminan interpolados en el SQL —no admiten parametro
 * enlazado—, asi que van como enum: cualquier otra validacion seria inyeccion.
 *
 * 'from' y 'to' se comparan contra creation_date, que es UTC: el cliente manda
 * instantes ISO con zona y aqui pasan a Date.
 */
export const documentListQuerySchema = z.object({
  ...paginationSchema,
  name: z.string().max(256).optional(),
  tag: z.string().max(256).optional(),
  scan_status: scanStatusFilter.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  sort: z.enum(['creation_date', 'modification_date']).default('creation_date'),
  order: z.enum(['asc', 'desc']).default('desc')
}).strict();

export const organizationListQuerySchema = z.object({
  ...paginationSchema,
  name: z.string().max(64).optional(),
  include_discharged: z.enum(['true', 'false']).default('false')
    .transform((value) => value === 'true')
}).strict();

/**
 * Tolerante con las formas habituales y estricto con lo demas: un valor no
 * reconocido detiene el arranque en vez de resolverse hacia el lado inseguro.
 * Con `env.X === 'true'`, un `TRUE` desactivaba ENABLE_ANTIVIRUS en silencio.
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
// El antivirus activado sin destino al que conectarse es una configuracion que
// solo puede fallar en la primera subida. Se detecta en el arranque.
.refine((config) => !config.enable_antivirus || !!(config.antivirus.host || config.antivirus.socket), {
  message: 'ENABLE_ANTIVIRUS requires CLAMAV_HOST or CLAMAV_SOCKET',
  path: ['antivirus', 'host']
});

export const formatIssues = (error:any) =>
  error.issues.map((issue:any) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
