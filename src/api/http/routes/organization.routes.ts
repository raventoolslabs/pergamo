import rateLimit from 'express-rate-limit';

import * as Controllers from '@/api/http/controllers/organization.controller';
import { StatusCodes } from '@/api/http/middleware/error.middleware';
import Middleware from '@/api/http/middleware';
import Config from '@/shared/config';

const router = require('express').Router();

/**
 * Limita los intentos contra los endpoints de credenciales. La IP la resuelve
 * Express segun el valor de 'trust proxy' (ver Config.trust_proxy): si hay un
 * proxy inverso delante y no se configura, todas las peticiones comparten IP.
 */
const authLimiter = rateLimit({
  windowMs: Config.rate_limit.window_ms,
  limit: Config.rate_limit.max,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    statusCode: StatusCodes.TOO_MANY_REQUESTS,
    error: 'Too many requests'
  }
});

// Sin authLimiter: no es un endpoint de credenciales, y compartir el contador
// con /login haria que consultar el listado agotase los intentos de acceso.
router.get('/', Middleware.authMaster, Controllers.list);

router.post('/login', authLimiter, Controllers.login);
router.post('/changePassword', authLimiter, Middleware.auth, Controllers.changePasswordUser);
router.post('/master/create', authLimiter, Middleware.authMaster,Controllers.create);
router.post('/master/changePassword', authLimiter, Middleware.authMaster, Controllers.changePasswordMaster);

export default router;
