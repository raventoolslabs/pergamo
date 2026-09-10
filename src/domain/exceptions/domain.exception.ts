/**
 * Error de negocio. Lleva la CLASE del fallo, no un codigo HTTP: quien traduce
 * a estado de respuesta es el middleware de la capa api, que es el unico que
 * sabe que esto se sirve por HTTP.
 */
export type DomainErrorKind = 'validation' | 'unauthorized' | 'not_found' | 'locked' | 'unavailable';

export class DomainError extends Error {

  readonly kind:DomainErrorKind;
  readonly code:string;

  constructor(kind:DomainErrorKind, code:string, message:string) {
    super(message);
    this.name = new.target.name;
    this.kind = kind;
    this.code = code;
  }
}

export class ValidationError extends DomainError {
  constructor(code:string, message:string) { super('validation', code, message); }
}

export class UnauthorizedError extends DomainError {
  constructor(code:string, message:string) { super('unauthorized', code, message); }
}

export class NotFoundError extends DomainError {
  constructor(code:string, message:string) { super('not_found', code, message); }
}

// Existe y esta identificado, pero no se entrega: cuarentena.
export class LockedError extends DomainError {
  constructor(code:string, message:string) { super('locked', code, message); }
}

/**
 * El servicio externo del que dependia la operacion no contesta. No es culpa de
 * quien llama ni un fallo del servidor: se reintenta.
 */
export class ServiceUnavailableError extends DomainError {
  constructor(code:string, message:string) { super('unavailable', code, message); }
}
