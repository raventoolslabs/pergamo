import { z } from "zod";

import { SearchHit } from '@/app/ports/repositories/document-chunk.repository';

/**
 * .strict() como el resto: un campo mal escrito debe ser un 400 y no una
 * peticion que se atiende ignorando lo que se pidio.
 */
export const searchBodySchema = z.object({
  query: z.string().min(1).max(2048),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  // Coseno, entre -1 y 1. Sin el, un fondo sin nada relevante devuelve
  // igualmente los trozos menos malos y quien pregunte los tomara por buenos.
  min_similarity: z.coerce.number().min(-1).max(1).optional()
}).strict();

/**
 * El vector NO sale, ni aqui ni en ningun otro sitio: un embedding es
 * parcialmente reversible y hereda la confidencialidad del documento.
 */
export const toSearchHitResponse = (hit:SearchHit) => ({
  chunk_id: hit.chunk,
  document_id: hit.document,
  content: hit.content,
  page: hit.page ?? null,
  section: hit.section ?? null,
  heading_path: hit.headingPath,
  similarity: hit.similarity,
  score: hit.score
});
