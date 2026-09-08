import Middleware from '@/api/http/middleware';
import Routes from '@/api/http/routes';
import Config from '@/shared/config';
import log from '@/shared/logger';
import antivirus from '@/infrastructure/antivirus/clamav.service';
import { activeContentRules } from '@/infrastructure/antivirus/active-content';
import { startWorker, stopWorker } from '@/api/queue/index.worker';
import { indexQueue } from '@/infrastructure/queue/index.queue';
import { assertIndexReady } from '@/container';
import FilesUtils from '@/infrastructure/files/storage';
import express from 'express';
import path from 'path';
import fs from 'fs';

const packageJson = require('../package.json')
const bodyParser = require('body-parser')

// Prefijos de la API. El fallback de la interfaz no puede tragarselos: un GET
// desconocido bajo uno de ellos debe seguir devolviendo el 404 JSON de la API y
// no el index.html de la SPA.
const API_PREFIXES = ['/organization', '/document', '/search', '/version', '/config'];

/**
 * Sirve la interfaz compilada, si existe. Vite deja el resultado en dist/web,
 * junto al JavaScript de la API, de modo que una sola imagen sirve ambas cosas.
 *
 * Con ts-node y en las pruebas no hay build de frontend: sin comprobarlo, el
 * fallback responderia a cualquier ruta con un sendFile a un fichero que falta.
 */
const serveWeb = (app:express.Express) => {

  const webRoot = path.join(__dirname, 'web');
  const indexFile = path.join(webRoot, 'index.html');

  if(!fs.existsSync(indexFile)) {
    log.warn('Web interface not found in dist/web: serving API only (run "npm run build:web" to include it)');
    return;
  }

  // Solo /assets lleva hash en el nombre, asi que solo ahi la cache agresiva es
  // segura: el logo conserva el suyo entre despliegues.
  app.use('/assets', express.static(path.join(webRoot, 'assets'), {
    index: false,
    immutable: true,
    maxAge: '1y'
  }));

  app.use(express.static(webRoot, { index: false, maxAge: '1h' }));

  // Express 5 exige nombrar el comodin, y las llaves hacen falta: '/*splat' no
  // casa la raiz '/', y '/{*splat}' casa las dos cosas.
  app.get('/{*splat}', (req, res, next) => {
    if(API_PREFIXES.some((prefix) => req.path === prefix || req.path.startsWith(`${prefix}/`))) return next();
    res.setHeader('Cache-Control', 'no-cache');
    return res.sendFile(indexFile);
  });
}

// El puerto es un parametro para que las pruebas puedan pedir uno libre (0) en
// lugar de competir todas por el mismo puerto fijo.
export const app = async (port:any = Config.port) => {

  // Una regla inexistente en MALICIOUS_ACTIVE_CONTENT_IGNORE no ignora nada, que
  // es lo contrario de lo que cree quien la escribio: se para el arranque en vez
  // de cuarentenar lo que su operador daba por exceptuado.
  const rules = activeContentRules().map((rule) => rule.name);
  const unknown = Config.malicious_active_content_ignore.filter((name) => !rules.includes(name));

  if(unknown.length) throw new Error(
    `MALICIOUS_ACTIVE_CONTENT_IGNORE contains unknown rule(s): ${unknown.join(', ')}. Valid rules: ${rules.join(', ')}`);

  // Se conecta con clamd antes de escuchar: sin este readiness gate, cada subida
  // hecha mientras clamd carga firmas devolvia un 500 opaco.

  if(Config.enable_antivirus) {
    await antivirus.init();
  } else {
    log.warn('Antivirus DISABLED (ENABLE_ANTIVIRUS is not enabled): uploads are stored without being scanned');
  }

  // El esquema y el proveedor tienen que decir lo mismo ANTES de aceptar nada:
  // una dimension que no cuadra o un operador equivocado no fallan solos, dan
  // resultados que no significan nada.
  //
  // Solo el esquema, que es local. Al proveedor no se le llama aqui: /search lo
  // necesita, pero un tercero que no responde no puede impedir que arranque el
  // archivo entero. Quien si espera a que responda es el worker, porque aceptar
  // trabajos contra una maquina muerta no sirve de nada.
  if(Config.indexing.enabled) {
    await assertIndexReady();
    if(Config.indexing.worker_embedded) await startWorker();
  } else {
    log.warn('Indexing DISABLED (INDEXING_ENABLED is not enabled): documents are stored without being indexed');
  }

  const app = express();

  app.set('trust proxy', Config.trust_proxy);

  app.use(bodyParser.json({ type: 'application/json' }));

  app.use(Middleware.global);

  app.get('/version', (req, res) => {
    res.status(200).json({ version: packageJson.version })
  });

  // Limites del despliegue que la interfaz necesita para validar antes de
  // enviar. Viven en variables de entorno: la alternativa era duplicarlos en el
  // frontend y verlos divergir. Va autenticado porque describe la instalacion.
  app.get('/config', Middleware.auth, (req, res) => {
    res.status(200).json({
      // La interfaz lo necesita para no prometer un analisis que no va a
      // ocurrir; no revela nada que scan_engine no diga ya.
      enable_antivirus: Config.enable_antivirus,
      valid_mimetype: Config.valid_mimetype,
      valid_metadata_modify: Config.valid_metadata_modify,
      max_file_size: Config.max_file_size,
      max_version_file: Config.max_version_file,
      // La interfaz lo necesita para no ofrecer una casilla que solo da un 400.
      indexing_enabled: Config.indexing.enabled
    })
  });

  app.use('/organization', Routes.organization);
  app.use('/document', Routes.document);
  app.use('/search', Routes.search);

  serveWeb(app);

  app.use(Middleware.error);

  const server = app.listen(port);

  // Sin esperar a 'listening', un fallo al abrir el puerto pasaba inadvertido y
  // la aplicacion continuaba como si hubiera arrancado.
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
  // vivo el proceso: cada suite de pruebas cierra su servidor y debe terminar.
  const cleanup = setInterval(() => {
    FilesUtils.cleanTmp(Config.tmp_base, Config.tmp_max_age_ms)
      .then((removed) => { if(removed) log.info(`Removed ${removed} orphaned upload temp file(s)`); })
      .catch((error:any) => log.warn(`Temp cleanup failed: ${error.message}`));
  }, Config.tmp_cleanup_interval_ms);

  cleanup.unref();

  server.on('close', () => {
    clearInterval(cleanup);
    // Sin esto, una suite que cierra su servidor deja abiertos los sockets de
    // Redis y Jest se queda esperando.
    stopWorker().catch((error:any) => log.warn(`Worker shutdown failed: ${error.message}`));
    indexQueue.close().catch((error:any) => log.warn(`Queue shutdown failed: ${error.message}`));
  });

  return server;
}
