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
 * Variables de entorno de las que depende el arranque. Se validan al iniciar
 * para fallar de inmediato y con un mensaje claro, en vez de propagar valores
 * como NaN hasta la primera consulta.
 */
export const configSchema = z.object({
  port: z.union([z.string(), z.number()]),
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
    name: z.string().min(1)
  })
});

export const formatIssues = (error:any) =>
  error.issues.map((issue:any) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
