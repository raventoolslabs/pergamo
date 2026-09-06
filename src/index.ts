import { app } from './app';
import log from './utils/log';

process.on('unhandledRejection', (reason:any) => {
  log.error(`Unhandled rejection: ${reason?.stack || reason}`);
});

process.on('uncaughtException', (error:any) => {
  log.error(`Uncaught exception: ${error?.stack || error}`);
  process.exit(1);
});

// Un arranque fallido (por ejemplo, el antivirus habilitado y clamd
// inalcanzable) debe terminar el proceso con codigo distinto de cero para que
// el supervisor lo reinicie. Sin este catch la promesa quedaba sin manejar: se
// registraba el error y el proceso seguia vivo sin escuchar en ningun puerto.
app().catch((error:any) => {
  log.error(`Startup failed: ${error?.message || error}`);
  process.exit(1);
});
