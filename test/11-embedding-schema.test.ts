import Config from '@/shared/config';
import sequelize, { QueryTypes } from '@/infrastructure/db/client';
import { assertEmbeddingSchema } from '@/infrastructure/db/embedding-schema';
import { SearchIndexDescriptor } from '@/domain/entities/search-index';

const ORGANIZATION = 'schema-probe';
const DIMENSION = Config.indexing.embedding.dimension;

const descriptor = (overrides:Partial<SearchIndexDescriptor> = {}):SearchIndexDescriptor => ({
  name: 'document_chunk_v1',
  provider: 'test',
  model: 'test-model',
  dimension: DIMENSION,
  distance: 'cosine',
  chunkerVersion: 'v1',
  version: 1,
  ...overrides
});

const vector = (seed:number) => {
  const values = new Array(DIMENSION).fill(0);
  values[seed % DIMENSION] = 1;
  return `[${values.join(',')}]`;
};

/**
 * Plan de la consulta ANN pura, que es donde se aisla la pregunta que importa:
 * ¿puede este indice servir este operador? Con la clase de operadores
 * equivocada la respuesta es no, y Postgres no lo dice: recorre la tabla y
 * devuelve resultados que parecen correctos.
 *
 * Sin el filtro de organizacion a proposito. Con el, el planificador puede
 * preferir el btree de organization y ordenar despues, que es exacto pero no
 * usa el indice ANN; que elija una cosa u otra depende de la selectividad y del
 * tamano, no de la correccion, y no se puede fijar en una prueba.
 */
const planWith = async (operator:string) =>
  sequelize.transaction(async (transaction) => {

    await sequelize.query('SET LOCAL enable_seqscan = off;', { transaction });

    const rows:any = await sequelize.query(
      `EXPLAIN (FORMAT JSON)
      SELECT id FROM pergamo.document_chunk_v1
      ORDER BY embedding ${operator} :embedding::vector
      LIMIT 5;`, {
      replacements: { embedding: vector(1) },
      type: QueryTypes.SELECT,
      transaction
    });

    return JSON.stringify(rows);
  });

describe('Embedding schema', () => {

  let documentId:string;

  beforeAll(async () => {

    await sequelize.query(
      `INSERT INTO pergamo.organization(id, name, password)
       VALUES (:id, :id, crypt('Pergamo0123#', gen_salt('bf'))) ON CONFLICT (id) DO NOTHING;`, {
      replacements: { id: ORGANIZATION }, type: QueryTypes.INSERT });

    const rows:any = await sequelize.query(
      `INSERT INTO pergamo.document(metadata, organization, scan_status)
       VALUES (:metadata::jsonb, :organization, 'clean') RETURNING id;`, {
      replacements: {
        organization: ORGANIZATION,
        metadata: JSON.stringify({ name: 'p', extension: 'pdf', mimetype: 'application/pdf', hash: 'h', tags: [] })
      },
      type: QueryTypes.SELECT });

    documentId = rows[0].id;

    // Suficientes filas para que el plan sea representativo.
    for(let position = 0; position < 100; position++) {
      await sequelize.query(
        `INSERT INTO pergamo.document_chunk_v1(document, organization, position, content, embedding)
         VALUES (:document, :organization, :position, :content, :embedding::vector);`, {
        replacements: {
          document: documentId, organization: ORGANIZATION, position,
          content: `Contenido de prueba numero ${position}`, embedding: vector(position)
        },
        type: QueryTypes.INSERT });
    }

    await sequelize.query('ANALYZE pergamo.document_chunk_v1;');
  });

  afterAll(async () => {
    await sequelize.query('DELETE FROM pergamo.document WHERE organization = :id;', {
      replacements: { id: ORGANIZATION }, type: QueryTypes.DELETE });
    await sequelize.query('DELETE FROM pergamo.organization WHERE id = :id;', {
      replacements: { id: ORGANIZATION }, type: QueryTypes.DELETE });
    await sequelize.close();
  });

  it('Should accept the schema the deployment actually has', async () => {

    await expect(assertEmbeddingSchema(descriptor())).resolves.toBeUndefined();
  });

  it('Should record the active index', async () => {

    await assertEmbeddingSchema(descriptor());

    const rows:any = await sequelize.query(
      'SELECT model, dimension, distance, chunker_version, active FROM pergamo.search_index WHERE name = :name;', {
      replacements: { name: 'document_chunk_v1' }, type: QueryTypes.SELECT });

    expect(rows[0]).toMatchObject({
      model: 'test-model', dimension: DIMENSION, distance: 'cosine', chunker_version: 'v1', active: true });
  });

  it('Should refuse a dimension the column does not have', async () => {

    await expect(assertEmbeddingSchema(descriptor({ dimension: DIMENSION + 1 })))
      .rejects.toThrow(/EMBEDDING_DIMENSION/);
  });

  /**
   * El indice se crea con vector_cosine_ops. Arrancar con un proveedor que mide
   * otra cosa no rompe nada visible: deja de usarse el indice y ya.
   */
  it('Should refuse a distance the index does not measure', async () => {

    await expect(assertEmbeddingSchema(descriptor({ distance: 'l2' })))
      .rejects.toThrow(/silently stops using the index/);
  });

  it('Should serve the ANN query from the index with the cosine operator', async () => {

    expect(await planWith('<=>')).toContain('idx_document_chunk_v1_embedding');
  });

  it('Should not be able to use the index with the wrong operator', async () => {

    // La trampa entera: la misma consulta con '<->' sobre un indice coseno no
    // puede usarlo, y Postgres no avisa. De ahi que el operador viva en un solo
    // sitio y que assertEmbeddingSchema lo compruebe al arrancar.
    expect(await planWith('<->')).not.toContain('idx_document_chunk_v1_embedding');
  });
});
