/**
 * Error de negocio. Lleva la CLASE del fallo, no un codigo HTTP: quien traduce
 * a estado de respuesta es el middleware de la capa api, que es el unico que
 * sabe que esto se sirve por HTTP.
 */
export type DomainErrorKind = 'validation' | 'unauthorized' | 'not_found' | 'locked';

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
