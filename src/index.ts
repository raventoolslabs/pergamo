import { app } from './app';
import log from './utils/log';

process.on('unhandledRejection', (reason:any) => {
  log.error(`Unhandled rejection: ${reason?.stack || reason}`);
});

process.on('uncaughtException', (error:any) => {
  log.error(`Uncaught exception: ${error?.stack || error}`);
  process.exit(1);
});

app();
