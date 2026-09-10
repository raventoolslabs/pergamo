import { StatusCodes, getReasonPhrase } from 'http-status-codes';

import log from '@/shared/logger';
import { DomainError, DomainErrorKind } from '@/domain/exceptions/domain.exception';

/**
 * Unico sitio donde un fallo de negocio se convierte en codigo HTTP. El dominio
 * declara la clase del fallo y desconoce que esto se sirve por HTTP.
 */
const STATUS:Record<DomainErrorKind, number> = {
  validation: StatusCodes.BAD_REQUEST,
  unauthorized: StatusCodes.UNAUTHORIZED,
  not_found: StatusCodes.NOT_FOUND,
  locked: StatusCodes.LOCKED,
  unavailable: StatusCodes.SERVICE_UNAVAILABLE
};

const errorHandler = (err, req, res, next) => {

  if(err) {
    if(err instanceof DomainError) {

      const statusCode = STATUS[err.kind];

      log.warn(`${req.method} ${req.originalUrl} - ${req.id} | Error(${err.code}): ${err.message}`);

      // El codigo viaja junto al mensaje: es lo que permite a un cliente
      // traducir el fallo en vez de ensenar la frase interna en ingles.
      res.status(statusCode)
      .set('Content-Type', 'application/json')
      .send({
        statusCode,
        error: err.message,
        code: err.code
      });

    } else if(err.name === 'MulterError') {

      // Errores de subida (tamano excedido, campo inesperado...): son fallos de
      // peticion, no del servidor, y no deben acabar en el 500 generico.
      const statusCode = err.code === 'LIMIT_FILE_SIZE' ?
        StatusCodes.REQUEST_TOO_LONG : StatusCodes.BAD_REQUEST;

      log.warn(`${req.method} ${req.originalUrl} - ${req.id} | Error(${err.code}): ${err.message}`);

      res.status(statusCode)
      .set('Content-Type', 'application/json')
      .send({
        statusCode,
        error: err.code === 'LIMIT_FILE_SIZE' ? 'File too large' : err.message
      });

    } else {
      log.error(`${req.method} ${req.originalUrl} - ${req.id} | ${err}`);
      res.status(StatusCodes.INTERNAL_SERVER_ERROR)
      .set('Content-Type', 'application/json')
      .send({
        statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
        error: getReasonPhrase(StatusCodes.INTERNAL_SERVER_ERROR)
      });
    }
  }
  next();
}

export { errorHandler };
