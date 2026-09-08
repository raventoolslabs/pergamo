import { z } from "zod";

import { SCAN_STATUS } from "@/domain/value-objects/scan-status";

// Llegan de la query string, siempre como cadena. El limite superior impide
// pedir la tabla entera en una sola peticion.
const paginationSchema = {
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0)
};

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
 * La indexacion se pide por query string y NO como campo del multipart: multer
 * solo puebla req.body con los campos que llegan ANTES del fichero, asi que un
 * cliente que lo mandara detras pediria indexar y no lo obtendria, sin error.
 *
 * .strict() para que '?indexx=true' sea un 400 y no una peticion que se ignora.
 */
export const documentUploadQuerySchema = z.object({
  index: z.enum(['true', 'false']).default('false').transform((value) => value === 'true')
}).strict();
