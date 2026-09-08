import fs from 'fs';
import path from 'path';

import Config from '@/shared/config';
import log from '@/infrastructure/logging/logger';
import sequelize, { QueryTypes } from '@/infrastructure/db/client';
import antivirus, { ScannerUnavailableError } from '@/infrastructure/antivirus/clamav.service';

/**
 * Reescaneo del corpus almacenado, tras cada actualizacion de firmas.
 *
 * Sin este barrido solo se escanearia en la subida, y un fichero limpio hoy
 * puede tener firma dentro de tres dias.
 *
 * Este proceso marca, nunca borra: utils/antivirus.ts fija removeInfected en
 * false, porque corromper en silencio un documento valido es peor defecto que
 * dejar pasar un virus.
 */

const BATCH_SIZE = 100;

interface Row {
  id: string;
  organization: string;
  path: string;
  scan_status: string;
}

const pending = async (engine:string, offsetId:string|null):Promise<Row[]> =>
  sequelize.query(
    `SELECT id, organization, path, scan_status
    FROM pergamo.document
    WHERE (scan_engine IS NULL OR scan_engine <> :engine)
      AND scan_status <> 'malicious'
      AND (:offsetId::varchar IS NULL OR id > :offsetId)
    ORDER BY id
    LIMIT :limit;`, {
    replacements: { engine, offsetId, limit: BATCH_SIZE },
    type: QueryTypes.SELECT
  }) as any;

/**
 * 'malicious' queda fuera de la cola, y eso sostiene la politica entera: esa
 * cuarentena es por lo que el documento lleva dentro, no por una firma, asi que
 * el barrido lo encontraria limpio y liberaria en lote lo que se decidio
 * retener. Se sale por `npm run scan:release -- <id>` y por nada mas.
 */
const record = async (id:string, status:string, signature:string|null, engine:string|null) =>
  sequelize.query(
    `UPDATE pergamo.document
    SET scan_status = :status, scan_signature = :signature,
        scan_engine = :engine, scan_date = CURRENT_TIMESTAMP
    WHERE id = :id;`, {
    replacements: { id, status, signature, engine },
    type: QueryTypes.UPDATE
  });

const rescan = async () => {

  if(!Config.enable_antivirus) {
    throw new Error('ENABLE_ANTIVIRUS is not enabled: there is no scanner to rescan with');
  }

  await antivirus.init();

  const engine = antivirus.engine;

  log.info(`Rescan started with engine: ${engine}`);

  const totals = { scanned: 0, clean: 0, infected: 0, missing: 0, retry: 0 };
  let offsetId:string|null = null;

  for(;;) {

    const batch = await pending(engine, offsetId);

    if(batch.length === 0) break;

    for(const row of batch) {

      offsetId = row.id;
      totals.scanned++;

      const filePath = path.join(Config.path_base, row.organization, row.path);

      // El fichero puede faltar (borrado manual, volumen no montado): se marca
      // 'error' y no 'clean', porque la ausencia de veredicto no es un veredicto
      // favorable. Se graba con el motor actual —reintentarlo no arregla nada—,
      // sale de la cola y exige que alguien mire por que falta.
      if(!fs.existsSync(filePath)) {
        await record(row.id, 'error', 'FILE_MISSING', engine);
        totals.missing++;
        log.warn(`Document ${row.id}: file not found at ${filePath}`);
        continue;
      }

      try {

        const result = await antivirus.check(filePath);

        if(result.infected) {
          await record(row.id, 'infected', result.signature, engine);
          totals.infected++;
          log.warn(`Document ${row.id} QUARANTINED: ${result.signature}`);
        } else {
          await record(row.id, 'clean', null, engine);
          totals.clean++;
        }

      } catch(error:any) {

        // Un escaner caido detiene el barrido entero. Se reanuda solo en la
        // siguiente ejecucion: la seleccion es por scan_engine, no por una
        // marca de progreso.
        if(error instanceof ScannerUnavailableError) throw error;

        // El fichero esta pero no hay veredicto: eso es 'pending'. Con
        // scan_engine nulo a proposito, para que el proximo barrido vuelva a
        // intentarlo en vez de sacarlo de la cola sin analizar.
        await record(row.id, 'pending', null, null);
        totals.retry++;
        log.error(`Document ${row.id}: ${error.message}`);
      }
    }

    log.info(`Progress: ${totals.scanned} scanned (${totals.clean} clean, ${totals.infected} infected, ${totals.missing} missing, ${totals.retry} to retry)`);
  }

  log.info(`Rescan finished: ${totals.scanned} scanned, ${totals.clean} clean, ${totals.infected} infected, ${totals.missing} missing, ${totals.retry} to retry`);

  if(totals.infected > 0) {
    log.warn(`${totals.infected} document(s) are quarantined and no longer downloadable (423). Review them before releasing: npm run scan:release -- <id>`);
  }

  // La cuarentena por contenido activo no se cuenta arriba porque el barrido ni
  // la mira: solo sale por revision, y sin este aviso no aparece en ningun sitio.
  const withheld:any = await sequelize.query(
    "SELECT COUNT(*)::int AS total FROM pergamo.document WHERE scan_status = 'malicious';", {
    type: QueryTypes.SELECT
  });

  if(withheld[0]?.total > 0) {
    log.warn(`${withheld[0].total} document(s) are quarantined for active content and were NOT rescanned: that state is not cleared by a scan. Review and release with: npm run scan:release -- <id>`);
  }

  // Un fichero que falta no se arregla con otro barrido: no se vuelve a mirar
  // hasta que cambie la version del motor.
  if(totals.missing > 0) {
    log.warn(`${totals.missing} document(s) have no file on disk (scan_status "error", signature FILE_MISSING). Check the storage volume: they cannot be downloaded and a rescan will not fix them.`);
  }
}

rescan()
  .then(async () => {
    await sequelize.close();
    process.exit(0);
  })
  .catch(async (error:any) => {
    log.error(`Rescan failed: ${error.message}`);
    await sequelize.close().catch(() => {});
    process.exit(1);
  });
