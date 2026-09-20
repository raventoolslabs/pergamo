import Middleware from '@/api/http/middleware';
import * as Controllers from '@/api/http/controllers/github.controller';

const router = require('express').Router();

// Token de la organizacion. Lo escribe su administracion; no hay vuelta de un
// tercero que autorizar, a diferencia de Drive.
router.get('/settings', Middleware.auth, Controllers.settings);
router.put('/settings', Middleware.auth, Controllers.saveSettings);
router.delete('/settings', Middleware.auth, Controllers.removeSettings);

router.get('/browse', Middleware.auth, Controllers.browse);
router.get('/branches', Middleware.auth, Controllers.branches);
router.get('/repositories', Middleware.auth, Controllers.repositories);
router.post('/repositories', Middleware.auth, Controllers.addRepository);
// Solo las exclusiones: el repositorio y la rama son la identidad de lo archivado.
router.patch('/repositories/:id', Middleware.auth, Controllers.updateRepository);
router.delete('/repositories/:id', Middleware.auth, Controllers.removeRepository);
router.post('/repositories/:id/sync', Middleware.auth, Controllers.startSync);
router.get('/repositories/:id/sync', Middleware.auth, Controllers.syncState);

export default router;
