import { ServiceUnavailableError, UnauthorizedError } from '@/domain/exceptions/domain.exception';

// Google no contesta o limita la cuota: se reintenta mas tarde.
export class DriveUnavailableError extends ServiceUnavailableError {
  constructor(message:string) { super('DRIVE_UNAVAILABLE', message); }
}

// Sin conexion, o con un token que Google ya no acepta: hay que conectar de nuevo.
export class DriveNotConnectedError extends UnauthorizedError {
  constructor(message:string) { super('DRIVE_NOT_CONNECTED', message); }
}
