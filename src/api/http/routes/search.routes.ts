import Middleware from '@/api/http/middleware';
import * as Controllers from '@/api/http/controllers/search.controller';

const router = require('express').Router();

// La misma autenticacion que el resto: se entra con /organization/login y el
// token que devuelve sirve para esto igual que para depositar un documento.
router.post('/', Middleware.auth, Controllers.search);

export default router;
