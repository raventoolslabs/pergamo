import log from '../utils/log';
import sequelize, { QueryTypes } from '../utils/db';

/**
 * Liberacion de un falso positivo.
 *
 * Uso: npm run scan:release -- <id-documento>
 *
 * Es un script y no un endpoint porque el modelo de autorizacion solo distingue
 * organizacion y maestra: exponerlo en la API obligaria a inventar un rol de
 * administrador, y esto lo ejecuta quien tiene acceso al despliegue.
 *
 * Es tambien la unica salida de la cuarentena por contenido activo, que no
 * levanta un reescaneo sino la decision de alguien que responde del documento.
 *
 * Pasa a 'clean' conservando scan_signature, para que siga siendo trazable y se
 * pueda decidir si la firma merece entrar en docker/clamav/local.ign2. El fichero no
 * se toca: alterarlo destruiria su hash y su firma electronica.
 */

const release = async () => {

  const id = process.argv[2];

  if(!id) throw new Error('Usage: npm run scan:release -- <document-id>');

  const rows:any = await sequelize.query(
    'SELECT id, organization, scan_status, scan_signature FROM pergamo.document WHERE id = :id;', {
    replacements: { id },
    type: QueryTypes.SELECT
  });

  if(rows.length !== 1) throw new Error(`Document ${id} does not exist`);

  const document = rows[0];

  if(document.scan_status === 'clean') {
    log.info(`Document ${id} is already clean; nothing to do`);
    return;
  }

  await sequelize.query(
    `UPDATE pergamo.document
    SET scan_status = 'clean', scan_date = CURRENT_TIMESTAMP
    WHERE id = :id;`, {
    replacements: { id },
    type: QueryTypes.UPDATE
  });

  log.warn(`Document ${id} (organization ${document.organization}) released from "${document.scan_status}" to "clean". Retained signature: ${document.scan_signature || 'none'}`);
  log.info('If this signature keeps flagging legitimate documents, add it to docker/clamav/local.ign2 and restart the clamav service.');
}

release()
  .then(async () => {
    await sequelize.close();
    process.exit(0);
  })
  .catch(async (error:any) => {
    log.error(`Release failed: ${error.message}`);
    await sequelize.close().catch(() => {});
    process.exit(1);
  });
