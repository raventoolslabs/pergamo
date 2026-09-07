import Middleware from './middleware';
import Routes from './routes';
import Config from './config';
import log from './utils/log';
import antivirus from './utils/antivirus';
import FilesUtils from './utils/files';
import express from 'express';
import path from 'path';
import fs from 'fs';

const packageJson = require('../package.json')
const bodyParser = require('body-parser')

// Prefijos de la API. El fallback de la interfaz no puede tragarselos: un GET
// desconocido bajo uno de ellos debe seguir devolviendo el 404 JSON de la API y
// no el index.html de la SPA.
const API_PREFIXES = ['/organization', '/document', '/version', '/config'];

/**
 * Sirve la interfaz web compilada, si existe.
 *
 * El build de Vite deja el resultado en dist/web, junto al JavaScript de la
 * API, de modo que una sola imagen sirve ambas cosas en el mismo puerto.
 *
 * La comprobacion de existencia no es cosmetica: con ts-node (npm run dev) y en
 * las pruebas no hay ningun build de frontend, y sin ella el fallback
 * responderia a cualquier ruta con un sendFile a un fichero inexistente.
 */
const serveWeb = (app:express.Express) => {

  const webRoot = path.join(__dirname, 'web');
  const indexFile = path.join(webRoot, 'index.html');

  if(!fs.existsSync(indexFile)) {
    log.warn('Web interface not found in dist/web: serving API only (run "npm run build:web" to include it)');
    return;
  }

  // Solo /assets lleva hash en el nombre: ahi la cache agresiva es segura
  // porque un contenido nuevo estrena URL. El logo y los favicons conservan su
  // nombre entre despliegues, asi que una cache de un ano dejaria a los
  // navegadores con la imagen vieja hasta 2027.
  app.use('/assets', express.static(path.join(webRoot, 'assets'), {
    index: false,
    immutable: true,
    maxAge: '1y'
  }));

  app.use(express.static(webRoot, { index: false, maxAge: '1h' }));

  // Express 5 (path-to-regexp v8) ya no admite el comodin '*' sin nombrar: hay
  // que darle un nombre al parametro, aunque no se use. Las llaves son
  // necesarias ademas: '/*splat' no casa la raiz '/', solo lo que cuelga de
  // ella; '/{*splat}' (comodin dentro de un grupo opcional) casa las dos cosas.
  app.get('/{*splat}', (req, res, next) => {
    if(API_PREFIXES.some((prefix) => req.path === prefix || req.path.startsWith(`${prefix}/`))) return next();
    res.setHeader('Cache-Control', 'no-cache');
    return res.sendFile(indexFile);
  });
}

// El puerto es un parametro para que las pruebas puedan pedir uno libre (0) en
// lugar de competir todas por el mismo puerto fijo.
export const app = async (port:any = Config.port) => {

  // Se conecta con clamd ANTES de escuchar. Es el readiness gate: sin esto la
  // aplicacion aceptaba trafico mientras clamd seguia cargando firmas, y cada
  // subida en esa ventana devolvia un 500 opaco.
  //
  // El arranque sin antivirus se registra de forma explicita: antes un
  // despliegue podia estar corriendo sin escaneo alguno y nada lo indicaba.
  if(Config.enable_antivirus) {
    await antivirus.init();
  } else {
    log.warn('Antivirus DISABLED (ENABLE_ANTIVIRUS is not enabled): uploads are stored without being scanned');
  }

  const app = express();

  app.set('trust proxy', Config.trust_proxy);

  app.use(bodyParser.json({ type: 'application/json' }));

  app.use(Middleware.global);

  app.get('/version', (req, res) => {
    res.status(200).json({ version: packageJson.version })
  });

  // Limites del despliegue que la interfaz necesita para validar antes de
  // enviar: que mimetypes se admiten, cuanto puede pesar un fichero y que
  // campos de metadatos son editables. Viven en variables de entorno, asi que
  // la alternativa era duplicarlos en el frontend y verlos divergir.
  //
  // Va autenticado: describe la configuracion de la instalacion y no hay
  // motivo para ofrecerlo a quien no ha entrado.
  app.get('/config', Middleware.auth, (req, res) => {
    res.status(200).json({
      valid_mimetype: Config.valid_mimetype,
      valid_metadata_modify: Config.valid_metadata_modify,
      max_file_size: Config.max_file_size,
      max_version_file: Config.max_version_file
    })
  });

  app.use('/organization', Routes.organization);
  app.use('/document', Routes.document);

  serveWeb(app);

  app.use(Middleware.error);

  const server = app.listen(port);

  // Se espera al evento 'listening'. Sin esto, un fallo al abrir el puerto
  // (ocupado, sin permisos) pasaba inadvertido: la funcion devolvia el servidor
  // y la aplicacion continuaba como si hubiera arrancado.
  await new Promise<void>((resolve, reject) => {

    const onError = (error:any) => {
      server.removeListener('listening', onListening);
      reject(error);
    };

    const onListening = () => {
      server.removeListener('error', onError);
      resolve();
    };

    server.once('listening', onListening);
    server.once('error', onError);
  });

  log.info(`Server running on port ${(server.address() as any).port}`);

  // Barrido de temporales huerfanos. unref() para que el intervalo no mantenga
  // vivo el proceso: en las pruebas, cada suite cierra su servidor y debe poder
  // terminar.
  const cleanup = setInterval(() => {
    FilesUtils.cleanTmp(Config.tmp_base, Config.tmp_max_age_ms)
      .then((removed) => { if(removed) log.info(`Removed ${removed} orphaned upload temp file(s)`); })
      .catch((error:any) => log.warn(`Temp cleanup failed: ${error.message}`));
  }, Config.tmp_cleanup_interval_ms);

  cleanup.unref();

  server.on('close', () => clearInterval(cleanup));

  return server;
}
