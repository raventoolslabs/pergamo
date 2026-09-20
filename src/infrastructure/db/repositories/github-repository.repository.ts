import sequelize, { QueryTypes } from '@/infrastructure/db/client';
import { GitHubRepositoryRepository } from '@/app/ports/repositories/github-repository.repository';
import { GitHubRepositoryRow } from '@/infrastructure/db/schema/github.row';
import { toGitHubRepository } from '@/infrastructure/db/mappers/github.mapper';
import { toTextArray } from '@/infrastructure/db/text-array';

const COLUMNS = `id, organization, owner, repository, branch, index_documents, store_content,
  excludes, last_commit, creation_date, sync_date, sync_error`;

export const githubRepositoryRepository:GitHubRepositoryRepository = {

  async create(repository) {

    const result:any = await sequelize.query(
      `INSERT INTO pergamo.github_repository(organization, owner, repository, branch, index_documents, store_content, excludes)
      VALUES (:organization, :owner, :repository, :branch, :index_documents, :store_content, :excludes::text[])
      RETURNING ${COLUMNS};`, {
      replacements: {
        organization: repository.organization,
        owner: repository.owner,
        repository: repository.repository,
        branch: repository.branch,
        index_documents: repository.indexDocuments,
        store_content: repository.storeContent,
        excludes: toTextArray(repository.excludes)
      },
      type: QueryTypes.INSERT
    });

    return toGitHubRepository(result[0][0] as GitHubRepositoryRow);
  },

  async findById(organization, id) {

    const rows:GitHubRepositoryRow[] = await sequelize.query(
      `SELECT ${COLUMNS} FROM pergamo.github_repository WHERE organization = :organization AND id = :id;`, {
      replacements: { organization, id },
      type: QueryTypes.SELECT
    });

    return rows.length === 1 ? toGitHubRepository(rows[0]) : null;
  },

  async list(organization) {

    const rows:GitHubRepositoryRow[] = await sequelize.query(
      `SELECT ${COLUMNS} FROM pergamo.github_repository WHERE organization = :organization
      ORDER BY owner, repository, branch;`, {
      replacements: { organization },
      type: QueryTypes.SELECT
    });

    return rows.map(toGitHubRepository);
  },

  async listAll() {

    const rows:GitHubRepositoryRow[] = await sequelize.query(
      `SELECT ${COLUMNS} FROM pergamo.github_repository ORDER BY organization, id;`, {
      type: QueryTypes.SELECT
    });

    return rows.map(toGitHubRepository);
  },

  // last_commit a NULL: la siguiente pasada vuelve a recorrer el arbol y aplica
  // las exclusiones nuevas, aunque la rama no se haya movido.
  async updateExcludes(organization, id, excludes) {

    const rows:any = await sequelize.query(
      `UPDATE pergamo.github_repository
      SET excludes = :excludes::text[], last_commit = NULL
      WHERE organization = :organization AND id = :id
      RETURNING ${COLUMNS};`, {
      replacements: { organization, id, excludes: toTextArray(excludes) },
      type: QueryTypes.SELECT
    });

    return rows.length === 1 ? toGitHubRepository(rows[0] as GitHubRepositoryRow) : null;
  },

  async remove(organization, id) {

    // Sin clave ajena desde 010: la columna la comparten Drive y GitHub. El
    // documento se queda sin origen hasta que otra pasada lo adopte o lo de de baja.
    await sequelize.query(
      'UPDATE pergamo.document SET remote_folder = NULL WHERE organization = :organization AND remote_folder = :id;', {
      replacements: { organization, id },
      type: QueryTypes.UPDATE
    });

    const rows:any = await sequelize.query(
      'DELETE FROM pergamo.github_repository WHERE organization = :organization AND id = :id RETURNING id;', {
      replacements: { organization, id },
      type: QueryTypes.SELECT
    });

    return rows.length === 1;
  },

  // El commit solo avanza cuando la pasada llego al final: con un fallo a mitad
  // se conserva el anterior, y la siguiente vuelve a comparar el arbol entero.
  async recordSync(id, date, commit, error?) {

    await sequelize.query(
      `UPDATE pergamo.github_repository
      SET sync_date = :date, sync_error = :error, last_commit = COALESCE(:commit, last_commit)
      WHERE id = :id;`, {
      replacements: { id, date, commit, error: error ?? null },
      type: QueryTypes.UPDATE
    });
  }
};
