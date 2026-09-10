/**
 * El documento no se puede indexar con lo que hay instalado. No se reintenta:
 * el mimetype no va a cambiar solo.
 */
export class ConversionUnsupportedError extends Error {
  constructor(message:string) {
    super(message);
    this.name = 'ConversionUnsupportedError';
  }
}

/**
 * La maquina de inferencia no responde. Si se reintenta, y hasta que responda
 * el documento se queda pendiente: nunca se marca indexado sin vector.
 */
export class ProviderUnavailableError extends Error {
  constructor(message:string) {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}
