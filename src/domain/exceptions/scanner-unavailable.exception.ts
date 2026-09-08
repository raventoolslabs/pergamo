/**
 * No hay veredicto del escaner. No es un hallazgo: la infeccion se rechaza al
 * cliente, y esto no es culpa suya, asi que lo decide quien llama.
 */
export class ScannerUnavailableError extends Error {
  constructor(message:string) {
    super(message);
    this.name = 'ScannerUnavailableError';
  }
}
