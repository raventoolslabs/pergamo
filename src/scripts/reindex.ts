import Config from '@/shared/config';
import log from '@/shared/logger';
import sequelize, { QueryTypes } from '@/infrastructure/db/client';
import { indexQueue } from '@/infrastructure/queue/index.queue';
import { searchIndex } from '@/container';
import { assertEmbeddingSchema } from '@/infrastructure/db/embedding-schema';

/**
 * Barrido de reserva: devuelve a la cola lo que se quedo por el camino.
 *
 * Este proceso ENCOLA, no indexa. Quien convierte y embebe es el worker, asi
 * que un barrido no depende de que la maquina de inferencia este disponible en
 * este preciso momento.
 *
 * Con --all entra tambien el corpus historico, que la migracion dejo en 'none'
 * a proposito: ponerlo todo en 'pending' al migrar lanzaria una instalacion
 * entera contra la maquina de inferencia sin que nadie lo haya pedido.
 */
const BATCH_SIZE = 100;

interface Row {
  id: string;
  organization: string;
  index_status: string;
}

const all = process.argv.includes('--all');

/**
 * Paginacion por keyset y no por OFFSET: la cola cambia mientras se recorre, y
 * un OFFSET se saltaria filas al reordenarse.
 */
const pending = async (model:string, stale:Date, offsetId:string|null):Promise<Row[]> =>
  sequelize.query(
    `SELECT id, organization, index_status
    FROM pergamo.document
    WHERE scan_status = 'clean'
      AND (
        index_status = 'pending'
        OR (index_status = 'indexed' AND index_model IS DISTINCT FROM :model)
        OR (index_status = 'indexing' AND index_date < :stale)
        OR (:all AND index_status = 'none')
      )
      AND (:offsetId::varchar IS NULL OR id > :offsetId)
    ORDER BY id
    LIMIT :limit;`, {
    replacements: { model, stale, all, offsetId, limit: BATCH_SIZE },
    type: QueryTypes.SELECT
  }) as any;

const markPending = async (id:string) =>
  sequelize.query(
    `UPDATE pergamo.document SET index_status = 'pending', index_error = NULL WHERE id = :id;`, {
    replacements: { id },
    type: QueryTypes.UPDATE
  });

const reindex = async () => {

  if(!Config.indexing.enabled) {
    throw new Error('INDEXING_ENABLED is not enabled: there is no index to rebuild');
  }

  // Antes de mover una sola fila: encolar contra un esquema que no cuadra con
  // el proveedor solo produce trabajo que va a fallar.
  await assertEmbeddingSchema(searchIndex());

  const model = Config.indexing.embedding.model;
  const stale = new Date(Date.now() - Config.indexing.stale_after_ms);

  log.info(`Reindex started for model ${model}${all ? ' (including the existing corpus)' : ''}`);

  const totals = { queued: 0, failed: 0 };
  let offsetId:string|null = null;

  for(;;) {

    const batch = await pending(model, stale, offsetId);

    if(batch.length === 0) break;

    for(const row of batch) {

      offsetId = row.id;

      try {

        if(row.index_status !== 'pending') await markPending(row.id);

        await indexQueue.enqueue(row.id, row.organization);

        totals.queued++;

      } catch(error:any) {
        // Se deja en la cola de la base: el siguiente barrido lo vuelve a coger.
        totals.failed++;
        log.warn(`Document ${row.id} could not be queued: ${error.message}`);
      }
    }

    log.info(`Queued ${totals.queued} document(s) so far`);
  }

  log.info(`Reindex finished: ${totals.queued} queued, ${totals.failed} failed`);

  if(totals.failed) log.warn('Some documents were not queued: run it again once the queue answers');
};

reindex()
  .then(async () => {
    await indexQueue.close();
    await sequelize.close();
    process.exit(0);
  })
  .catch(async (error:any) => {
    log.error(`Reindex failed: ${error.message}`);
    await indexQueue.close().catch(() => {});
    await sequelize.close().catch(() => {});
    process.exit(1);
  });
