import sequelize, { QueryTypes } from '@/infrastructure/db/client';
import { EmbeddedChunk } from '@/domain/entities/chunk';
import { TransactionScope } from '@/app/ports/unit-of-work';
import {
  DocumentChunkRepository, SearchHit, SearchQuery
} from '@/app/ports/repositories/document-chunk.repository';

// Postgres admite 65535 parametros por sentencia y cada trozo gasta nueve.
const INSERT_BATCH = 200;

// pgvector acepta la representacion textual, asi que no hay que ensenarle el
// tipo a Sequelize.
const toVector = (embedding:number[]) => `[${embedding.join(',')}]`;

// Un array enlazado como replacement lo expande Sequelize a una lista separada
// por comas, que es lo que necesita un IN (...) y no un text[]: aqui viaja como
// literal de array y se castea en la sentencia.
const toTextArray = (values:string[]) =>
  `{${values.map((value) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}`;

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
   * La unica consulta ANN del proyecto, y vive aqui a proposito.
   *
   * El indice es vector_cosine_ops, que OBLIGA a '<=>'. Con '<->' o '<#>' el
   * planificador deja de usarlo y cae a seq scan sin error y sin aviso, asi que
   * el operador no puede estar suelto en un controlador.
   *
   * `embedding` no se selecciona: un vector es parcialmente reversible y
   * hereda la confidencialidad del documento.
   *
   * El WHERE de organizacion y el indice ANN compiten: HNSW no filtra, asi que
   * el planificador elige entre recorrerlo y descartar lo ajeno, o usar el
   * btree de organization y ordenar exacto. Con pocos documentos por inquilino
   * lo segundo es mejor y ademas no puede devolver de menos; cuando deje de
   * serlo, la salida es un indice parcial por organizacion.
   */
  async search(query:SearchQuery):Promise<SearchHit[]> {

    const rows:any = await sequelize.query(
      `SELECT id, document, content, page, section, heading_path,
        1 - (embedding <=> :embedding::vector) AS similarity
      FROM pergamo.document_chunk_v1
      WHERE organization = :organization
      ORDER BY embedding <=> :embedding::vector
      LIMIT :limit;`, {
      replacements: {
        organization: query.organization,
        embedding: toVector(query.embedding),
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
      similarity: Number(row.similarity)
    }));
  }
};
