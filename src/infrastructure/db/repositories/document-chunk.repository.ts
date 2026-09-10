import sequelize, { QueryTypes } from '@/infrastructure/db/client';
import { EmbeddedChunk } from '@/domain/entities/chunk';
import { QUARANTINED_STATUS } from '@/domain/value-objects/scan-status';
import { TransactionScope } from '@/app/ports/unit-of-work';
import {
  ChunkPage, ChunkPageQuery, DocumentChunkRepository, SearchHit, SearchQuery, StoredChunk
} from '@/app/ports/repositories/document-chunk.repository';

// Postgres admite 65535 parametros por sentencia y cada trozo gasta nueve.
const INSERT_BATCH = 200;

// Constante de RRF. Amortigua las primeras posiciones: sin ella, el primero de
// una mitad aplasta a todo lo que la otra haya encontrado. 60 es el valor del
// articulo original y el que usa casi todo el mundo.
const RRF_K = 60;

// pgvector acepta la representacion textual, asi que no hay que ensenarle el
// tipo a Sequelize.
const toVector = (embedding:number[]) => `[${embedding.join(',')}]`;

// Un array enlazado como replacement lo expande Sequelize a una lista separada
// por comas, que es lo que necesita un IN (...) y no un text[]: aqui viaja como
// literal de array y se castea en la sentencia.
const toTextArray = (values:string[]) =>
  `{${values.map((value) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}`;

const toStoredChunk = (row:any):StoredChunk => ({
  id: Number(row.id),
  position: row.position,
  content: row.content,
  page: row.page ?? undefined,
  section: row.section ?? undefined,
  headingPath: row.heading_path || [],
  contentType: row.content_type,
  length: Number(row.length)
});

export const documentChunkRepository:DocumentChunkRepository = {

  async deleteByDocument(document, scope?:TransactionScope) {

    await sequelize.query('DELETE FROM pergamo.document_chunk_v1 WHERE document = :document;', {
      replacements: { document },
      type: QueryTypes.DELETE,
      transaction: scope as any
    });
  },

  async countByDocument(document) {

    const rows:any = await sequelize.query(
      'SELECT count(*)::int AS total FROM pergamo.document_chunk_v1 WHERE document = :document;', {
      replacements: { document },
      type: QueryTypes.SELECT
    });

    return rows[0].total;
  },

  /**
   * Los trozos de un documento, en su orden. Filtra por documento Y por
   * organizacion aunque el caso de uso ya haya resuelto el documento: es la
   * unica consulta de trozos que se alcanza por HTTP pidiendo un documento
   * concreto, y una segunda cerradura no cuesta nada.
   *
   * Columnas enumeradas, y `embedding` no esta entre ellas.
   */
  async listByDocument(query:ChunkPageQuery):Promise<ChunkPage> {

    const replacements = { document: query.document, organization: query.organization };

    const counted:any = await sequelize.query(
      `SELECT count(*)::int AS total FROM pergamo.document_chunk_v1
      WHERE document = :document AND organization = :organization;`, {
      replacements,
      type: QueryTypes.SELECT
    });

    const total = counted[0].total;

    if(!total) return { total, chunks: [] };

    const rows:any = await sequelize.query(
      `SELECT id, position, content, page, section, heading_path, content_type,
        length(content) AS length
      FROM pergamo.document_chunk_v1
      WHERE document = :document AND organization = :organization
      ORDER BY position
      LIMIT :limit OFFSET :offset;`, {
      replacements: { ...replacements, limit: query.limit, offset: query.offset },
      type: QueryTypes.SELECT
    });

    return { total, chunks: rows.map(toStoredChunk) };
  },

  /**
   * Borra y reescribe: reindexar no fusiona: sustituye. Va dentro del ambito
   * que le pasen para que el borrado y la escritura no puedan quedar a medias.
   */
  async replace(document, organization, chunks, scope?:TransactionScope) {

    await this.deleteByDocument(document, scope);

    for(let start = 0; start < chunks.length; start += INSERT_BATCH) {

      const batch = chunks.slice(start, start + INSERT_BATCH);
      const replacements:any = { document, organization };
      const values:string[] = [];

      batch.forEach((chunk:EmbeddedChunk, index) => {
        values.push(`(:document, :organization, :position${index}, :content${index}, :page${index},
          :section${index}, :headingPath${index}::text[], :contentType${index}, :embedding${index}::vector)`);
        replacements[`position${index}`] = chunk.position;
        replacements[`content${index}`] = chunk.content;
        replacements[`page${index}`] = chunk.page ?? null;
        replacements[`section${index}`] = chunk.section ?? null;
        replacements[`headingPath${index}`] = toTextArray(chunk.headingPath);
        replacements[`contentType${index}`] = chunk.contentType;
        replacements[`embedding${index}`] = toVector(chunk.embedding);
      });

      await sequelize.query(
        `INSERT INTO pergamo.document_chunk_v1
          (document, organization, position, content, page, section, heading_path, content_type, embedding)
        VALUES ${values.join(', ')};`, {
        replacements,
        type: QueryTypes.INSERT,
        transaction: scope as any
      });
    }
  },

  /**
   * Denso y lexico fusionados con Reciprocal Rank Fusion, en una sola consulta.
   *
   * Las dos mitades hacen falta y ninguna sustituye a la otra: el vector
   * encuentra lo que se dice de otra manera, y el texto encuentra un numero de
   * factura o un nombre propio que el modelo no vio nunca. RRF las combina por
   * POSICION y no por puntuacion, que es lo que permite sumarlas sin normalizar
   * dos escalas que no tienen nada que ver.
   *
   * El indice es vector_cosine_ops, que OBLIGA a '<=>'. Con '<->' o '<#>' el
   * planificador deja de poder usarlo y recorre la tabla entera: sin error y
   * sin aviso. Por eso este operador vive en un solo sitio del proyecto.
   *
   * El WHERE de organizacion y el indice ANN compiten: HNSW no filtra, asi que
   * el planificador elige entre recorrerlo y descartar lo ajeno, o usar el
   * btree de organization y ordenar exacto. Con pocos documentos por inquilino
   * lo segundo es mejor y ademas no puede devolver de menos; cuando deje de
   * serlo, la salida es un indice parcial por organizacion.
   *
   * `embedding` no se selecciona nunca: un vector es parcialmente reversible y
   * hereda la confidencialidad del documento.
   *
   * Lo retenido se descarta al final y no dentro de las dos mitades: asi la
   * condicion vive en un sitio y no compite con el indice ANN. Lo que el filtro
   * quite sale del colchon de SEARCH_CANDIDATES_FACTOR, que ya pide de mas.
   */
  async search(query:SearchQuery):Promise<SearchHit[]> {

    const rows:any = await sequelize.query(
      `WITH dense AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> :embedding::vector) AS rank
        FROM pergamo.document_chunk_v1
        WHERE organization = :organization
        ORDER BY embedding <=> :embedding::vector
        LIMIT :candidates
      ), lexical AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY ts_rank_cd(content_tsv, query) DESC) AS rank
        FROM pergamo.document_chunk_v1, websearch_to_tsquery('spanish', :text) AS query
        WHERE organization = :organization AND content_tsv @@ query
        LIMIT :candidates
      ), fused AS (
        SELECT COALESCE(dense.id, lexical.id) AS id,
          COALESCE(1.0 / (:rrfK + dense.rank), 0) + COALESCE(1.0 / (:rrfK + lexical.rank), 0) AS score
        FROM dense FULL OUTER JOIN lexical ON dense.id = lexical.id
      )
      SELECT c.id, c.document, c.content, c.page, c.section, c.heading_path,
        1 - (c.embedding <=> :embedding::vector) AS similarity,
        fused.score
      FROM fused
      JOIN pergamo.document_chunk_v1 c ON c.id = fused.id
      JOIN pergamo.document d ON d.id = c.document
      WHERE d.scan_status NOT IN (:quarantined)
      ORDER BY fused.score DESC, similarity DESC
      LIMIT :limit;`, {
      replacements: {
        organization: query.organization,
        embedding: toVector(query.embedding),
        text: query.text,
        candidates: query.candidates,
        rrfK: RRF_K,
        quarantined: QUARANTINED_STATUS,
        limit: query.limit
      },
      type: QueryTypes.SELECT
    });

    return rows.map((row:any) => ({
      chunk: Number(row.id),
      document: row.document,
      content: row.content,
      page: row.page ?? undefined,
      section: row.section ?? undefined,
      headingPath: row.heading_path || [],
      similarity: Number(row.similarity),
      score: Number(row.score)
    }));
  }
};
