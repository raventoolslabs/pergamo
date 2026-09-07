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
 * Escapa los comodines de LIKE en un texto que viene del cliente.
 *
 * Sin esto, un '%' deja de ser un caracter a buscar y pasa a significar
 * "cualquier cosa": la busqueda devuelve la tabla entera. La barra invertida se
 * escapa tambien porque es el caracter de escape por defecto de LIKE en
 * PostgreSQL.
 */
export const escapeLike = (value:string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

/**
 * Parametros de los listados paginados.
 *
 * Los valores llegan de la query string, es decir siempre como cadena: se
 * convierten con coerce y se acotan aqui. El limite superior es lo que impide
 * que un cliente pida la tabla entera en una sola peticion.
 */
const paginationSchema = {
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0)
};

export const SCAN_STATUS = ['pending', 'clean', 'infected', 'error'] as const;

/**
 * Filtro por estado de analisis: uno o varios, separados por comas.
 *
 * Admite lista porque la interfaz agrupa estados que para quien consulta
 * significan lo mismo —'infected' y 'error' son ambos "esto no se descarga y
 * hay que mirarlo"—, y sin esto una de las dos mitades quedaria invisible.
 *
 * Cada valor se valida contra el enum por separado: lo que no este en la lista
 * sigue devolviendo 400 en lugar de ignorarse.
 */
const scanStatusFilter = z.string()
  .transform((value) => value.split(','))
  .pipe(z.array(z.enum(SCAN_STATUS)).min(1).max(SCAN_STATUS.length));

/**
 * Filtros y orden del listado de documentos.
 *
 * 'sort' y 'order' terminan interpolados en el SQL —no admiten parametro
 * enlazado—, asi que se declaran como enum: lo que no esta en la lista no llega
 * a la consulta. Cualquier otra forma de validarlos seria una inyeccion.
 *
 * 'from' y 'to' acotan la fecha de deposito. Se comparan contra creation_date,
 * que es TIMESTAMP WITHOUT TIME ZONE en UTC: el cliente manda instantes ISO con
 * zona y aqui se convierten a Date, de modo que la franja no dependa de donde
 * este el navegador.
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
