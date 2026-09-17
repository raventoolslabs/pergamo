import sequelize, { QueryTypes } from '@/infrastructure/db/client';
import { DriveConnectionRepository } from '@/app/ports/repositories/drive-connection.repository';
import { DriveConnectionRow } from '@/infrastructure/db/schema/drive.row';
import { toDriveConnection } from '@/infrastructure/db/mappers/drive.mapper';

// Sin refresh_token: solo sale por sealedRefreshToken.
const COLUMNS = 'organization, creation_date, google_account, scope, revoked_date';

export const driveConnectionRepository:DriveConnectionRepository = {

  async find(organization) {

    const rows:DriveConnectionRow[] = await sequelize.query(
      `SELECT ${COLUMNS} FROM pergamo.drive_connection WHERE organization = :organization;`, {
      replacements: { organization },
      type: QueryTypes.SELECT
    });

    return rows.length === 1 ? toDriveConnection(rows[0]) : null;
  },

  async save(grant) {

    const result:any = await sequelize.query(
      `INSERT INTO pergamo.drive_connection(organization, google_account, refresh_token, scope)
      VALUES (:organization, :google_account, :refresh_token, :scope)
      ON CONFLICT (organization) DO UPDATE
      SET google_account = EXCLUDED.google_account, refresh_token = EXCLUDED.refresh_token,
          scope = EXCLUDED.scope, revoked_date = NULL, modification_date = CURRENT_TIMESTAMP
      RETURNING ${COLUMNS};`, {
      replacements: {
        organization: grant.organization,
        google_account: grant.googleAccount,
        refresh_token: grant.sealedRefreshToken,
        scope: grant.scope
      },
      type: QueryTypes.INSERT
    });

    return toDriveConnection(result[0][0] as DriveConnectionRow);
  },

  // Una conexion revocada no entrega token: igual que si no existiera.
  async sealedRefreshToken(organization) {

    const rows:any = await sequelize.query(
      `SELECT refresh_token FROM pergamo.drive_connection
      WHERE organization = :organization AND revoked_date IS NULL;`, {
      replacements: { organization },
      type: QueryTypes.SELECT
    });

    return rows.length === 1 ? rows[0].refresh_token : null;
  },

  async markRevoked(organization) {

    await sequelize.query(
      `UPDATE pergamo.drive_connection SET revoked_date = CURRENT_TIMESTAMP, modification_date = CURRENT_TIMESTAMP
      WHERE organization = :organization AND revoked_date IS NULL;`, {
      replacements: { organization },
      type: QueryTypes.UPDATE
    });
  },

  async remove(organization) {

    await sequelize.query('DELETE FROM pergamo.drive_connection WHERE organization = :organization;', {
      replacements: { organization },
      type: QueryTypes.DELETE
    });
  }
};
