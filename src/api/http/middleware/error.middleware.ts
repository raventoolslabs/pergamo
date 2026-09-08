import {
	StatusCodes,
  getReasonPhrase,
} from 'http-status-codes';
import log from '@/infrastructure/logging/logger';

class ValidationError extends Error {

  statusCode:number;
  error:string;

  constructor(statusCode:number, error:string, message:string, req?:any) {
    super();
    this.statusCode = statusCode;
    this.error = error;
    this.message = message;
    if(req) log.warn(`${req.method} ${req.originalUrl} - ${req.id} | Error(${error}): ${message}`);
  }
}

const errorHandler = (err, req, res, next) => {

  if(err) {
    if(err instanceof  ValidationError) {

      res.status(err.statusCode)
      .set('Content-Type', 'application/json')
      .send({
        statusCode: err.statusCode,
        error: err.message
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

export {
  errorHandler,
  StatusCodes,
  ValidationError
}