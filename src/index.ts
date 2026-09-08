import { app } from '@/server';
import log from '@/infrastructure/logging/logger';

process.on('unhandledRejection', (reason:any) => {
  log.error(`Unhandled rejection: ${reason?.stack || reason}`);
});

process.on('uncaughtException', (error:any) => {
  log.error(`Uncaught exception: ${error?.stack || error}`);
  process.exit(1);
});

// Un arranque fallido debe terminar con codigo distinto de cero para que el
// supervisor reinicie: sin este catch el proceso seguia vivo sin escuchar.
app().catch((error:any) => {
  log.error(`Startup failed: ${error?.message || error}`);
  process.exit(1);
});
