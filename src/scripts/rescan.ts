import fs from 'fs';
import path from 'path';

import Config from '../config';
import log from '../utils/log';
import sequelize, { QueryTypes } from '../utils/db';
import antivirus, { ScannerUnavailableError } from '../utils/antivirus';

/**
 * Reescaneo del corpus almacenado.
 *
 * Es la pieza que cierra la mayor brecha estructural del diseno anterior: se
 * escaneaba una sola vez, en la subida. Un fichero limpio hoy puede tener firma
 * dentro de tres dias, y sin este barrido Pergamo seguiria sirviendolo
 * indefinidamente. Ningun motor antivirico resuelve esto por si solo.
 *
 * Uso: npm run rescan            (tras cada actualizacion de firmas, freshclam)
 *
 * IMPORTANTE: este proceso MARCA, nunca borra. La garantia es estructural:
 * utils/antivirus.ts fija removeInfected en false, de modo que ClamAV no puede
 * eliminar un documento del archivo por un falso positivo. En un archivo,
 * corromper en silencio un documento valido es peor defecto que dejar pasar un
 * virus.
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
      AND (:offsetId::varchar IS NULL OR id > :offsetId)
    ORDER BY id
    LIMIT :limit;`, {
    replacements: { engine, offsetId, limit: BATCH_SIZE },
    type: QueryTypes.SELECT
  }) as any;

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

      // El fichero puede faltar (borrado manual, volumen no montado). Se marca
      // 'error' en vez de 'clean': la ausencia de veredicto nunca debe leerse
      // como veredicto favorable.
      //
      // 'error' es el UNICO caso que lo produce, y es deliberado: significa que
      // el documento esta roto, no que el analisis no haya podido hacerse. Se
      // graba con el motor actual porque reintentarlo no arregla nada; sale de
      // la cola y exige que alguien mire por que falta el fichero.
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

        // Un escaner caido detiene el barrido entero: seguir dejaria el corpus
        // en un estado que no refleja nada. Se reanuda desde donde quedo en la
        // siguiente ejecucion, porque la seleccion es por scan_engine y no por
        // una marca de progreso.
        if(error instanceof ScannerUnavailableError) throw error;

        // El fichero esta, pero este analisis concreto no ha llegado a un
        // veredicto: eso es exactamente 'pending'. Va con scan_engine NULO a
        // proposito —la cola de reescaneo selecciona por scan_engine—, de modo
        // que el proximo barrido vuelva a intentarlo. Grabarlo con el motor
        // actual, como se hacia antes, lo sacaba de la cola y lo dejaba sin
        // analizar y sin descarga para siempre.
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

  // Un fichero que falta no se arregla con otro barrido: no se vuelve a mirar
  // hasta que cambie la version del motor, asi que si no se avisa aqui nadie se
  // entera de que el archivo tiene un hueco.
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
