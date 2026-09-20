import { ServiceUnavailableError, UnauthorizedError, ValidationError } from '@/domain/exceptions/domain.exception';

// GitHub no contesta o agoto la cuota: se reintenta mas tarde.
export class GitHubUnavailableError extends ServiceUnavailableError {
  constructor(message:string) { super('GITHUB_UNAVAILABLE', message); }
}

// El token no vale o ya no tiene permiso: hay que escribir otro.
export class GitHubNotConnectedError extends UnauthorizedError {
  constructor(message:string) { super('GITHUB_NOT_CONNECTED', message); }
}

// El despliegue tiene GitHub, pero esta organizacion no ha guardado su token.
export class GitHubNotConfiguredError extends ValidationError {
  constructor(message:string) { super('GITHUB_NOT_CONFIGURED', message); }
}
