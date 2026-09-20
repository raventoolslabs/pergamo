import sequelize, { QueryTypes } from '@/infrastructure/db/client';
import log from '@/shared/logger';
import { GitHubCredentials, GitHubSettingsRepository } from '@/app/ports/repositories/github-settings.repository';
import { GitHubSettingsRow } from '@/infrastructure/db/schema/github.row';
import { toGitHubSettings } from '@/infrastructure/db/mappers/github.mapper';
import { open, seal } from '@/infrastructure/security/secret-box';

const COLUMNS = 'organization, creation_date, modification_date, api_url, token';

const DEFAULT_API_URL = 'https://api.github.com';

export const githubSettingsRepository:GitHubSettingsRepository = {

  async find(organization) {

    const rows:GitHubSettingsRow[] = await sequelize.query(
      `SELECT ${COLUMNS} FROM pergamo.github_settings WHERE organization = :organization;`, {
      replacements: { organization },
      type: QueryTypes.SELECT
    });

    return rows.length === 1 ? toGitHubSettings(rows[0]) : null;
  },

  /**
   * El token se sella aqui, nunca antes: la capa app lo pasa en claro y no tiene
   * con que abrirlo despues. El CASE distingue «mantener» de «quitar», que
   * llegan como undefined y null.
   */
  async save({ organization, apiUrl, token }) {

    const keep = token === undefined;

    const result:any = await sequelize.query(
      `INSERT INTO pergamo.github_settings(organization, api_url, token)
      VALUES (:organization, :api_url, :token)
      ON CONFLICT (organization) DO UPDATE
      SET api_url = EXCLUDED.api_url,
          token = CASE WHEN :keep THEN pergamo.github_settings.token ELSE EXCLUDED.token END,
          modification_date = CURRENT_TIMESTAMP
      RETURNING ${COLUMNS};`, {
      replacements: {
        organization,
        api_url: apiUrl || null,
        token: token ? seal(token) : null,
        keep
      },
      type: QueryTypes.INSERT
    });

    return toGitHubSettings(result[0][0] as GitHubSettingsRow);
  },

  async remove(organization) {

    await sequelize.query('DELETE FROM pergamo.github_settings WHERE organization = :organization;', {
      replacements: { organization },
      type: QueryTypes.DELETE
    });
  },

  async credentials(organization):Promise<GitHubCredentials | null> {

    const rows:{ api_url:string | null; token:string }[] = await sequelize.query(
      `SELECT api_url, token FROM pergamo.github_settings
      WHERE organization = :organization AND token IS NOT NULL;`, {
      replacements: { organization },
      type: QueryTypes.SELECT
    });

    if(rows.length !== 1) return null;

    try {
      return {
        // Sin barra final: las rutas de la API ya la traen delante.
        apiUrl: (rows[0].api_url || DEFAULT_API_URL).replace(/\/+$/, ''),
        token: open(rows[0].token)
      };
    } catch {
      // Sellado con otra SECRET_KEY: se comporta como si no hubiera token, que
      // es lo unico posible sin la clave con la que se guardo.
      log.warn(`GitHub token of organization ${organization} was sealed with another SECRET_KEY`);
      return null;
    }
  }
};
