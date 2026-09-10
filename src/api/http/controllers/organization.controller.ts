import { StatusCodes } from 'http-status-codes';

import { organizationDeps as deps } from '@/container';
import { ValidationError } from '@/domain/exceptions/domain.exception';
import { formatIssues } from '@/shared/validation';
import { organizationListQuerySchema } from '@/api/http/dto/list-query.dto';
import { toOrganizationResponse } from '@/api/http/dto/organization.dto';

import { login as loginUseCase } from '@/app/use-cases/organization/commands/login.handler';
import { createOrganization } from '@/app/use-cases/organization/commands/create-organization.handler';
import { changePassword } from '@/app/use-cases/organization/commands/change-password.handler';
import { listOrganizations } from '@/app/use-cases/organization/queries/list-organizations.handler';

const login = async (req, res, next) => {

  try {

    const token = await loginUseCase(req.body, deps);

    res.status(StatusCodes.OK)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ token }));

  } catch (error) {
    next(error);
  }
};

const create = async (req, res, next) => {

  try {

    const organization = await createOrganization(req.body, deps);

    res.status(StatusCodes.OK)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(toOrganizationResponse(organization)));

  } catch (error) {
    next(error);
  }
}

const changePasswordUser = async (req, res, next) => {

  try {

    await changePassword({ organization: req.user.organization, password: req.body?.password }, deps);

    res.status(StatusCodes.OK)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ message: 'Password change successfully'}));

  } catch (error) {
    next(error);
  }
}

const changePasswordMaster = async (req, res, next) => {

  try {

    if(!req.body?.organization) throw new ValidationError(
      'REQUIRED_ORGANIZATION', 'Required organization');

    await changePassword({ organization: req.body.organization, password: req.body?.password }, deps);

    res.status(StatusCodes.OK)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ message: 'Password change successfully'}));

  } catch (error) {
    next(error);
  }
}

const list = async (req, res, next) => {

  try {

    const query = organizationListQuerySchema.safeParse(req.query);

    if(!query.success) throw new ValidationError('INVALID_QUERY', formatIssues(query.error));

    const { limit, offset, name, include_discharged } = query.data;

    const page = await listOrganizations({
      limit, offset, name, includeDischarged: include_discharged
    }, deps);

    res.status(StatusCodes.OK)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({
        total: page.total,
        limit,
        offset,
        organizations: page.organizations.map(toOrganizationResponse)
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
