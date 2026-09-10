import Config from '@/shared/config';
import { timingSafeEqualStr } from '@/shared/hash';
import { NotFoundError, ValidationError } from '@/domain/exceptions/domain.exception';
import { TokenPayload } from '@/app/ports/services/token.service';
import { OrganizationDeps } from '../dependencies';

export interface LoginInput {
  name?: string;
  password?: string;
}

export const login = async (input:LoginInput, deps:OrganizationDeps):Promise<string> => {

  if(!input?.name || !input?.password) throw new ValidationError('INCORRECT_LOGIN', 'Incorrect Login');

  const { name, password } = input;

  const payload:TokenPayload = { name };

  // Comparacion en tiempo constante contra las credenciales del maestro, que no
  // viven en la base: es la unica cuenta que existe antes de crear nada.
  const isMaster = !!Config.user_master && !!Config.password_master &&
    timingSafeEqualStr(name, Config.user_master) &&
    timingSafeEqualStr(password, Config.password_master);

  if(isMaster) {

    payload.master = true;

  } else {

    const organization = await deps.organizations.findByCredentials(name, password);

    if(!organization) throw new NotFoundError('INCORRECT_LOGIN', 'Incorrect Login');

    payload.organization = organization.id;
  }

  return deps.tokens.generate(payload);
}
