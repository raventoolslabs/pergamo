import * as UUID from 'uuid';

import log from '@/infrastructure/logging/logger';
import Config from '@/shared/config';

export const globalHandler = (req, res, next) => {
  req.id = UUID.v4();

  // Pergamo sirve contenido subido por terceros: sin esto, un navegador puede
  // ignorar el Content-Type declarado, deducir el tipo del contenido y tratar
  // como HTML algo que se almaceno como otra cosa.
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const startTime = process.hrtime();
  log.debug(`${req.method} ${req.originalUrl} - ${req.id} | Start request`);

  res.on('finish', () => {
    const endTime = process.hrtime(startTime);
    const elapsedTimeInMs = (endTime[0] * 1e3 + endTime[1] / 1e6);
    log.info(`${req.method} ${req.originalUrl} - ${req.id} | Execution time: ${elapsedTimeInMs} ms | Status: ${res.statusCode}`);
  });

  next();
}