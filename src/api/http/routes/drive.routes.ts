import Middleware from '@/api/http/middleware';
import * as Controllers from '@/api/http/controllers/drive.controller';

const router = require('express').Router();

// Publica: vuelve de Google sin token. La organizacion va en el state sellado.
router.get('/callback', Controllers.callback);

router.get('/', Middleware.auth, Controllers.connection);
router.post('/connect', Middleware.auth, Controllers.connect);
router.delete('/', Middleware.auth, Controllers.disconnect);
router.get('/browse', Middleware.auth, Controllers.browse);
router.get('/folders', Middleware.auth, Controllers.folders);
router.post('/folders', Middleware.auth, Controllers.addFolder);
router.delete('/folders/:id', Middleware.auth, Controllers.removeFolder);
router.post('/folders/:id/sync', Middleware.auth, Controllers.startSync);
router.get('/folders/:id/sync', Middleware.auth, Controllers.syncState);

export default router;
