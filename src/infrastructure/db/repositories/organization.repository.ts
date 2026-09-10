import sequelize, { QueryTypes } from '@/infrastructure/db/client';
import { Organization } from '@/domain/entities/organization';
import {
  OrganizationListFilter, OrganizationPage, OrganizationRepository
} from '@/app/ports/repositories/organization.repository';
import { OrganizationRow } from '@/infrastructure/db/schema/organization.row';
import { toOrganization } from '@/infrastructure/db/mappers/organization.mapper';
import { escapeLike } from '@/shared/validation';

export const organizationRepository:OrganizationRepository = {

  // El cotejo lo hace pgcrypto: la contrasena en claro no sale de la consulta.
  async findByCredentials(name, password):Promise<Organization | null> {

    const result:any = await sequelize.query(
      `SELECT id, name, creation_date, modification_date, discharge_date
      FROM pergamo.organization
      WHERE name = :name AND password = crypt(:password, password) AND discharge_date IS NULL;`, {
      replacements: { name, password },
      type: QueryTypes.SELECT
    });

    return result.length === 1 ? toOrganization(result[0] as OrganizationRow) : null;
  },

  async create(name, password, id?):Promise<Organization> {

    const columns = id ? '(id, name, password)' : '(name, password)';
    const values = id ?
      '(:id, :name, crypt(:password, gen_salt(\'bf\')))' :
      '(:name, crypt(:password, gen_salt(\'bf\')))';

    const result:any = await sequelize.query(
      `INSERT INTO pergamo.organization${columns}
      VALUES ${values}
      RETURNING id, name, creation_date, modification_date, discharge_date;`, {
      replacements: id ? { id, name, password } : { name, password },
      type: QueryTypes.UPDATE
    });

    return toOrganization(result[0][0] as OrganizationRow);
  },

  // El WHERE rechaza la contrasena repetida en la propia sentencia: sin fila
  // afectada, no habia cambio que hacer.
  async changePassword(organization, password):Promise<boolean> {

    const result:any = await sequelize.query(
      `UPDATE pergamo.organization
      SET password = crypt(:password, gen_salt('bf'))
      WHERE id = :organization AND password != crypt(:password, password) RETURNING id;`, {
      replacements: { organization, password },
      type: QueryTypes.UPDATE
    });

    return result[0].length > 0;
  },

  /**
   * La columna 'password' no aparece en el SELECT. Traerla y borrarla despues
   * deja el hash viajando por el proceso y a un descuido de la respuesta.
   */
  async list(filter:OrganizationListFilter):Promise<OrganizationPage> {

    const { limit, offset, name, includeDischarged } = filter;

    const replacements:any = { limit, offset };
    const conditions:string[] = [];

    if(!includeDischarged) conditions.push('discharge_date IS NULL');

    if(name) {
      conditions.push('clean_str(name) ILIKE clean_str(:name)');
      replacements.name = `%${escapeLike(name)}%`;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows:OrganizationRow[] = await sequelize.query(
      `SELECT id, name, creation_date, modification_date, discharge_date,
        COUNT(*) OVER() AS total
      FROM pergamo.organization
      ${where}
      ORDER BY name ASC
      LIMIT :limit OFFSET :offset;`, {
      replacements,
      type: QueryTypes.SELECT
    });

    return {
      total: rows.length ? Number.parseInt(rows[0].total) : 0,
      organizations: rows.map(toOrganization)
    };
  }
};
