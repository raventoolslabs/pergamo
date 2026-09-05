import Middleware from './middleware';
import Routes from './routes';
import Config from './config';
import log from './utils/log';
import antivirus from './utils/antivirus';
import express from 'express';

const packageJson = require('../package.json')
const bodyParser = require('body-parser')

// El puerto es un parametro para que las pruebas puedan pedir uno libre (0) en
// lugar de competir todas por el mismo puerto fijo.
export const app = async (port:any = Config.port) => {

  if(Config.enable_antivirus) await antivirus.init();
  
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

  return server;
}
