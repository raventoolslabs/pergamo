import sequelize, { QueryTypes } from '@/infrastructure/db/client';
import { DriveFolderRepository } from '@/app/ports/repositories/drive-folder.repository';
import { DriveFolderRow } from '@/infrastructure/db/schema/drive.row';
import { toDriveFolder } from '@/infrastructure/db/mappers/drive.mapper';

const COLUMNS = 'id, organization, folder_id, name, index_documents, creation_date, sync_date, sync_error';

export const driveFolderRepository:DriveFolderRepository = {

  async create(folder) {

    const result:any = await sequelize.query(
      `INSERT INTO pergamo.drive_folder(organization, folder_id, name, index_documents)
      VALUES (:organization, :folder_id, :name, :index_documents)
      RETURNING ${COLUMNS};`, {
      replacements: {
        organization: folder.organization,
        folder_id: folder.folderId,
        name: folder.name,
        index_documents: folder.indexDocuments
      },
      type: QueryTypes.INSERT
    });

    return toDriveFolder(result[0][0] as DriveFolderRow);
  },

  async findById(organization, id) {

    const rows:DriveFolderRow[] = await sequelize.query(
      `SELECT ${COLUMNS} FROM pergamo.drive_folder WHERE organization = :organization AND id = :id;`, {
      replacements: { organization, id },
      type: QueryTypes.SELECT
    });

    return rows.length === 1 ? toDriveFolder(rows[0]) : null;
  },

  async list(organization) {

    const rows:DriveFolderRow[] = await sequelize.query(
      `SELECT ${COLUMNS} FROM pergamo.drive_folder WHERE organization = :organization ORDER BY name, id;`, {
      replacements: { organization },
      type: QueryTypes.SELECT
    });

    return rows.map(toDriveFolder);
  },

  async listAll() {

    const rows:DriveFolderRow[] = await sequelize.query(
      `SELECT ${COLUMNS} FROM pergamo.drive_folder ORDER BY organization, id;`, {
      type: QueryTypes.SELECT
    });

    return rows.map(toDriveFolder);
  },

  async remove(organization, id) {

    // A mano desde 010: la clave ajena que lo hacia se cayo al compartir la
    // columna con GitHub. Sin carpeta, el documento sigue hasta que la
    // sincronizacion de otra que lo contenga lo adopte, o lo de de baja.
    await sequelize.query(
      'UPDATE pergamo.document SET remote_folder = NULL WHERE organization = :organization AND remote_folder = :id;', {
      replacements: { organization, id },
      type: QueryTypes.UPDATE
    });

    const rows:any = await sequelize.query(
      'DELETE FROM pergamo.drive_folder WHERE organization = :organization AND id = :id RETURNING id;', {
      replacements: { organization, id },
      type: QueryTypes.SELECT
    });

    return rows.length === 1;
  },

  async recordSync(id, date, error?) {

    await sequelize.query(
      'UPDATE pergamo.drive_folder SET sync_date = :date, sync_error = :error WHERE id = :id;', {
      replacements: { id, date, error: error ?? null },
      type: QueryTypes.UPDATE
    });
  }
};
