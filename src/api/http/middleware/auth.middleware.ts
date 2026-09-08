import log from '@/shared/logger';
import { UnauthorizedError } from '@/domain/exceptions/domain.exception';
import { organizationDeps } from '@/container';

const authenticate = async (req) => {

  const token = req.headers['authorization'];

  if(!token) throw new UnauthorizedError('TOKEN_REQUIRED', 'Token not provided');

  req.user = await organizationDeps.tokens.verify(token);

  log.debug(`${req.method} ${req.originalUrl} - ${req.id} | Organization: ${req.user.name}`);
}

export const authHandler = async (req, res, next) => {
  try {
    await authenticate(req);
    next();
  } catch(err) {
    next(err);
  }
};

export const authMasterHandler = async (req, res, next) => {
  try {
    await authenticate(req);
    if(!req.user.master) throw new UnauthorizedError('NOT_MASTER', 'User not master');
    next();
  } catch(err) {
    next(err);
  }
};
