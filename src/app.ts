import Middleware from './middleware';
import Routes from './routes';
import Config from './config';
import log from './utils/log';
import antivirus from './utils/antivirus';
import FilesUtils from './utils/files';
import express from 'express';

const packageJson = require('../package.json')
const bodyParser = require('body-parser')

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

  app.use('/organization', Routes.organization);
  app.use('/document', Routes.document);

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
