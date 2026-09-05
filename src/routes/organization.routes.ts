import rateLimit from 'express-rate-limit';

import * as Controllers from '../controllers/organization.controllers';
import { StatusCodes } from '../middleware/error.middleware';
import Middleware from '../middleware';
import Config from '../config';

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

router.post('/login', authLimiter, Controllers.login);
router.post('/changePassword', authLimiter, Middleware.auth, Controllers.changePasswordUser);
router.post('/master/create', authLimiter, Middleware.authMaster,Controllers.create);
router.post('/master/changePassword', authLimiter, Middleware.authMaster, Controllers.changePasswordMaster);

export default router;
