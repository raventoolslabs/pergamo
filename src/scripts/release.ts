import log from '../utils/log';
import sequelize, { QueryTypes } from '../utils/db';

/**
 * Liberacion de un falso positivo.
 *
 * Uso: npm run scan:release -- <id-documento>
 *
 * Por que un script y no un endpoint: el modelo de autorizacion actual solo
 * distingue organizacion y organizacion maestra. Anadir una via de liberacion a
 * la API obligaria a inventar un rol de administrador y a exponerlo en red;
 * esta operacion la ejecuta un operador con acceso al despliegue, que es
 * exactamente el nivel de privilegio que corresponde.
 *
 * El documento pasa a 'clean' CONSERVANDO scan_signature: un falso positivo
 * liberado sigue siendo trazable, y esa es la informacion que permite decidir
 * si la firma merece entrar en clamav/local.ign2.
 *
 * El fichero no se modifica en ningun momento. Los falsos positivos se liberan
 * mediante revision; no se "arreglan" alterando el documento, que destruiria su
 * hash de registro y cualquier firma electronica que contenga.
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
  log.info('If this signature keeps flagging legitimate documents, add it to clamav/local.ign2 and restart the clamav service.');
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
