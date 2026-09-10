import multer from 'multer';
import Middleware from '@/api/http/middleware';
import Config from '@/shared/config';
import * as Controllers from '@/api/http/controllers/document.controller';

const upload = multer({
  dest: Config.tmp_base,
  limits: { fileSize: Config.max_file_size }
});
const router = require('express').Router();

router.post('/', Middleware.auth, upload.single('document'), Controllers.upload);
// El listado va antes que '/:id': de lo contrario Express resolveria GET
// /document contra la ruta parametrizada.
router.get('/', Middleware.auth, Controllers.list);
// Antes que '/:id' por lo mismo que el listado: si no, Express resolveria
// 'rescan' contra la ruta parametrizada y buscaria un documento con ese id.
router.post('/rescan', Middleware.auth, Controllers.startSweep);
router.get('/rescan', Middleware.auth, Controllers.sweepState);
router.get('/:id', Middleware.auth, Controllers.getMetadata);
router.put('/:id', Middleware.auth, Controllers.modifyMetadata);
router.get('/:id/file', Middleware.auth, Controllers.getFile);
router.put('/:id/file', Middleware.auth, upload.single('document'), Controllers.modifyFile);
router.get('/:id/scan', Middleware.auth, Controllers.scanInfo);
router.post('/:id/scan', Middleware.auth, Controllers.rescan);
router.post('/:id/release', Middleware.auth, Controllers.release);
router.get('/:id/index', Middleware.auth, Controllers.indexInfo);
router.get('/:id/chunks', Middleware.auth, Controllers.chunks);
router.get('/:id/versions', Middleware.auth, Controllers.versionsFile);
router.get('/:id/versions/:version/file', Middleware.auth, Controllers.getVersionFile);
router.delete('/:id', Middleware.auth, Controllers.remove);

export default router;