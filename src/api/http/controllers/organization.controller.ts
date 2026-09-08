
import sequelize, { QueryTypes } from "@/infrastructure/db/client";
import JWTUtils from '@/infrastructure/security/jwt';
import { timingSafeEqualStr } from '@/infrastructure/security/hash';
import Config from '@/shared/config';
import { ValidationError, StatusCodes } from "@/api/http/middleware/error.middleware";
import owasp from 'owasp-password-strength-test';
import { organizationListQuerySchema, escapeLike, formatIssues } from '@/shared/validation';

owasp.config({
  allowPassphrases: true,
  maxLength: 128,
  minLength: 10,
  minPhraseLength: 20,
  minOptionalTestsToPass : 4,
});

const validatePasswordStrength = (password:string, req:any) => {

  const testPassword = owasp.test(password);

  if(testPassword.errors && testPassword.errors.length > 0) throw new ValidationError(StatusCodes.BAD_REQUEST,
    'INVALID_PASSWORD', testPassword.errors[0], req);
}

const login = async (req, res, next) => {
  
  try {

    const { body } = req;

    if(!body?.name || !body?.password) throw new ValidationError(StatusCodes.BAD_REQUEST,
      'INCORRECT_LOGIN', 'Incorrect Login', req);

    const { name, password } = req.body;

    let payload:any = { name };

    const isMaster = !!Config.user_master && !!Config.password_master &&
      timingSafeEqualStr(name, Config.user_master) &&
      timingSafeEqualStr(password, Config.password_master);

    if(isMaster) {

      payload.master = true;

    } else {

      const result = await sequelize.query(
        `SELECT id 
        FROM pergamo.organization 
        WHERE name = :name AND password = crypt(:password, password) AND discharge_date IS NULL;`, {
        replacements: { name, password },
        type: QueryTypes.SELECT
      });

      if(result.length !== 1) throw new ValidationError(StatusCodes.NOT_FOUND, 
        'INCORRECT_LOGIN', 'Incorrect Login', req);
  
      const { id }:any = result[0];

      payload.organization = id;
    }
    
    res.status(StatusCodes.OK)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({
        token: await JWTUtils.generateToken(payload)
      }));

  } catch (error) {
    next(error);
  }
};

const create = async (req, res, next) => {

  try {

    if(!req.body?.name) throw new ValidationError(StatusCodes.BAD_REQUEST, 
      'REQUIRED_NAME', 'Required name', req);
    if(!req.body?.password) throw new ValidationError(StatusCodes.BAD_REQUEST, 
      'REQUIRED_PASSWORD', 'Required password', req);

    const { name, password } = req.body;
    const id = req.body.id;

    validatePasswordStrength(password, req);

    let result:any;

    if(id) {
      result = (await sequelize.query(
        `INSERT INTO pergamo.organization(id, name, password) 
        VALUES (:id, :name, crypt(:password, gen_salt('bf')))
        RETURNING *;`, {
        replacements: { id, name, password },
        type: QueryTypes.UPDATE
      }));
    } else {
      result = (await sequelize.query(
        `INSERT INTO pergamo.organization(name, password) 
        VALUES (:name, crypt(:password, gen_salt('bf')))
        RETURNING *;`, {
        replacements: { name, password },
        type: QueryTypes.UPDATE
      }));
    }

    const organization = result[0][0];
    delete organization.password;

    res.status(StatusCodes.OK)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(organization));
      
    } catch (error) {
      next(error);
    }
}


const changePassword = async (organization:string, req:any) => {

  const { body } = req;

  if(!body?.password) throw new ValidationError(StatusCodes.BAD_REQUEST, 
    'REQUIRED_PASSWORD', 'Required password', req);

  const { password } = body;

  validatePasswordStrength(password, req);

  const result:any = (await sequelize.query(
    `UPDATE pergamo.organization 
    SET password = crypt(:password, gen_salt('bf'))
    WHERE id = :organization AND password != crypt(:password, password) RETURNING *;`, {
    replacements: { organization, password },
    type: QueryTypes.UPDATE
  }));

  if(result[0].length === 0) throw new ValidationError(StatusCodes.BAD_REQUEST, 
    'SAME_PASSWORD', 'Password is the same', req);
}

const changePasswordUser = async (req, res, next) => {

  try {

    const { organization } = req.user;

    await changePassword(organization, req);

    res.status(StatusCodes.OK)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ message: 'Password change successfully'}));
      
    } catch (error) {
      next(error);
    }
}

const changePasswordMaster = async (req, res, next) => {

  try {

    if(!req.body?.organization) throw new ValidationError(StatusCodes.BAD_REQUEST, 
      'REQUIRED_ORGANIZATION', 'Required organization', req);

    const { organization } = req.body;

    await changePassword(organization, req);

    res.status(StatusCodes.OK)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ message: 'Password change successfully'}));
      
    } catch (error) {
      next(error);
    }
}


/**
 * Listado de organizaciones. Solo para el master: es el que necesita elegir
 * sobre cual actuar al cambiar una contrasena.
 *
 * La columna 'password' no aparece en el SELECT. Traerla y borrarla despues
 * —como hace create— deja el hash viajando por el proceso y a un descuido de
 * distancia de la respuesta.
 */
const list = async (req, res, next) => {

  try {

    const query = organizationListQuerySchema.safeParse(req.query);

    if(!query.success) throw new ValidationError(StatusCodes.BAD_REQUEST,
      'INVALID_QUERY', formatIssues(query.error), req);

    const { limit, offset, name, include_discharged } = query.data;

    const replacements:any = { limit, offset };
    const conditions:string[] = [];

    if(!include_discharged) conditions.push('discharge_date IS NULL');

    if(name) {
      conditions.push('clean_str(name) ILIKE clean_str(:name)');
      replacements.name = `%${escapeLike(name)}%`;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result:any = await sequelize.query(
      `SELECT id, name, creation_date, modification_date, discharge_date,
        COUNT(*) OVER() AS total
      FROM pergamo.organization
      ${where}
      ORDER BY name ASC
      LIMIT :limit OFFSET :offset;`, {
      replacements,
      type: QueryTypes.SELECT
    });

    const organizations = result.map(({ total, ...organization }:any) => organization);

    res.status(StatusCodes.OK)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({
        total: result.length ? Number.parseInt(result[0].total) : 0,
        limit,
        offset,
        organizations
      }));

  } catch (error) {
    next(error);
  }
}

export {
  login,
  create,
  list,
  changePasswordUser,
  changePasswordMaster
}