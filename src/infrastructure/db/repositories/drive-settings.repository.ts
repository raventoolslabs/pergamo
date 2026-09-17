import sequelize, { QueryTypes } from '@/infrastructure/db/client';
import log from '@/shared/logger';
import { DriveCredentials, DriveSettingsRepository } from '@/app/ports/repositories/drive-settings.repository';
import { DriveSettingsRow } from '@/infrastructure/db/schema/drive.row';
import { toDriveSettings } from '@/infrastructure/db/mappers/drive.mapper';
import { open, seal } from '@/infrastructure/security/secret-box';

const COLUMNS = 'organization, creation_date, modification_date, client_id, client_secret';

export const driveSettingsRepository:DriveSettingsRepository = {

  async find(organization) {

    const rows:DriveSettingsRow[] = await sequelize.query(
      `SELECT ${COLUMNS} FROM pergamo.drive_settings WHERE organization = :organization;`, {
      replacements: { organization },
      type: QueryTypes.SELECT
    });

    return rows.length === 1 ? toDriveSettings(rows[0]) : null;
  },

  /**
   * El secreto se sella aqui, nunca antes: la capa app lo pasa en claro y no
   * tiene con que abrirlo despues.
   *
   * El CASE distingue «mantener» de «quitar», que llegan como undefined y null.
   * Decidirlo con un SELECT previo abriria una carrera entre las dos consultas.
   */
  async save({ organization, clientId, clientSecret }) {

    const keep = clientSecret === undefined;

    const result:any = await sequelize.query(
      `INSERT INTO pergamo.drive_settings(organization, client_id, client_secret)
      VALUES (:organization, :client_id, :client_secret)
      ON CONFLICT (organization) DO UPDATE
      SET client_id = EXCLUDED.client_id,
          client_secret = CASE WHEN :keep THEN pergamo.drive_settings.client_secret
                               ELSE EXCLUDED.client_secret END,
          modification_date = CURRENT_TIMESTAMP
      RETURNING ${COLUMNS};`, {
      replacements: {
        organization,
        client_id: clientId,
        client_secret: clientSecret ? seal(clientSecret) : null,
        keep
      },
      type: QueryTypes.INSERT
    });

    return toDriveSettings(result[0][0] as DriveSettingsRow);
  },

  async remove(organization) {

    await sequelize.query('DELETE FROM pergamo.drive_settings WHERE organization = :organization;', {
      replacements: { organization },
      type: QueryTypes.DELETE
    });
  },

  async credentials(organization):Promise<DriveCredentials | null> {

    const rows:{ client_id:string; client_secret:string; modification_date:Date }[] = await sequelize.query(
      `SELECT client_id, client_secret, modification_date FROM pergamo.drive_settings
      WHERE organization = :organization AND client_secret IS NOT NULL;`, {
      replacements: { organization },
      type: QueryTypes.SELECT
    });

    if(rows.length !== 1) return null;

    try {
      return {
        clientId: rows[0].client_id,
        clientSecret: open(rows[0].client_secret),
        modificationDate: rows[0].modification_date
      };
    } catch {
      // Sellado con otra SECRET_KEY: se comporta como si no hubiera credenciales,
      // que es lo unico posible sin la clave con la que se guardaron.
      log.warn(`Drive client secret of organization ${organization} was sealed with another SECRET_KEY`);
      return null;
    }
  }
};
