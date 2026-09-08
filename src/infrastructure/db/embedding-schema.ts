import sequelize, { QueryTypes } from '@/infrastructure/db/client';
import log from '@/shared/logger';
import { SearchIndexDescriptor, VectorDistance } from '@/domain/entities/search-index';

const TABLE = 'document_chunk_v1';

// La clase de operadores del indice decide con que operador se puede consultar,
// y equivocarse no da error: el planificador deja de usar el indice y cae a seq
// scan en silencio.
const OPERATOR_CLASS:Record<VectorDistance, string> = {
  cosine: 'vector_cosine_ops',
  dot: 'vector_ip_ops',
  l2: 'vector_l2_ops'
};

/**
 * Lee la anchura declarada con format_type y no con atttypmod a pelo: el
 * encoding de atttypmod es interno de pgvector y no es contrato.
 */
const columnDimension = async () => {

  const rows:any = await sequelize.query(
    `SELECT format_type(a.atttypid, a.atttypmod) AS type
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'pergamo' AND c.relname = :table
      AND a.attname = 'embedding' AND NOT a.attisdropped;`, {
    replacements: { table: TABLE },
    type: QueryTypes.SELECT
  });

  if(!rows.length) return null;

  const declared = /^vector\((\d+)\)$/.exec(rows[0].type);

  if(!declared) throw new Error(
    `pergamo.${TABLE}.embedding is "${rows[0].type}" and not vector(n). ` +
    'Without a declared width pgvector cannot index it and every search is a sequential scan.');

  return Number.parseInt(declared[1]);
}

const indexOperatorClass = async () => {

  const rows:any = await sequelize.query(
    `SELECT am.amname, opc.opcname
    FROM pg_index i
    JOIN pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_class tc ON tc.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = tc.relnamespace
    JOIN pg_am am ON am.oid = ic.relam
    JOIN pg_opclass opc ON opc.oid = i.indclass[0]
    WHERE n.nspname = 'pergamo' AND tc.relname = :table AND am.amname IN ('hnsw', 'ivfflat');`, {
    replacements: { table: TABLE },
    type: QueryTypes.SELECT
  });

  return rows.length ? { method: rows[0].amname, opclass: rows[0].opcname } : null;
}

/**
 * Comprueba al arrancar que el esquema y el proveedor dicen lo mismo, y deja
 * registrado que indice esta activo.
 *
 * Es el mismo gesto que la validacion de MALICIOUS_ACTIVE_CONTENT_IGNORE:
 * fallar al arrancar, no en el primer trabajo ni, peor, en la primera busqueda
 * que devuelve resultados que no significan nada.
 */
export const assertEmbeddingSchema = async (descriptor:SearchIndexDescriptor) => {

  const dimension = await columnDimension();

  if(dimension === null) throw new Error(
    `pergamo.${TABLE} does not exist. Run "npm run init" to apply the pending migrations.`);

  if(dimension !== descriptor.dimension) throw new Error(
    `The index holds vectors of ${dimension} dimensions and EMBEDDING_DIMENSION says ${descriptor.dimension}. ` +
    `Set EMBEDDING_DIMENSION=${dimension}, or create the next index version and reindex: the two cannot disagree.`);

  const index = await indexOperatorClass();

  if(!index) throw new Error(
    `pergamo.${TABLE}.embedding has no ANN index: every search would be a sequential scan.`);

  const expected = OPERATOR_CLASS[descriptor.distance];

  if(index.opclass !== expected) throw new Error(
    `The ANN index uses ${index.opclass} and the provider measures ${descriptor.distance} (${expected}). ` +
    'Querying with the wrong operator does not fail: it silently stops using the index.');

  await register(descriptor);

  log.info(`Search index ${descriptor.name}: ${descriptor.model} (${descriptor.provider}), ` +
    `${dimension} dimensions, ${descriptor.distance}, chunker ${descriptor.chunkerVersion}`);
}

/**
 * Deja constancia de con que se construyo el indice activo. Lo escribe el
 * arranque y no la migracion porque el modelo, el proveedor y la version del
 * troceado los conoce el codigo, no el esquema.
 */
const register = async (descriptor:SearchIndexDescriptor) => {

  await sequelize.query(
    `INSERT INTO pergamo.search_index(name, provider, model, dimension, distance, chunker_version, version, active)
    VALUES (:name, :provider, :model, :dimension, :distance, :chunkerVersion, :version, true)
    ON CONFLICT (name) DO UPDATE SET
      provider = EXCLUDED.provider, model = EXCLUDED.model, dimension = EXCLUDED.dimension,
      distance = EXCLUDED.distance, chunker_version = EXCLUDED.chunker_version,
      version = EXCLUDED.version, active = true;`, {
    replacements: { ...descriptor },
    type: QueryTypes.INSERT
  });
}
