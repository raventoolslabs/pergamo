import Config from '@/shared/config';
import log from '@/shared/logger';
import { ScanRecord } from '@/app/ports/repositories/document.repository';
import { ScannerUnavailableError } from '@/domain/exceptions/scanner-unavailable.exception';
import { ValidationError } from '@/domain/exceptions/domain.exception';
import { DocumentDeps } from './dependencies';

/**
 * Traduce el analisis de una subida a las columnas de estado.
 *
 * Con el escaner habilitado pero sin responder se acepta y se marca 'pending':
 * el documento entra, se entrega y queda en la cola del proximo reescaneo.
 * Retenerlo convertia una caida de clamd en un archivo que deja de servir.
 *
 * Con el antivirus desactivado no hay intencion de verificar, asi que queda
 * 'clean' con scan_engine nulo: 'pending' dejaria el despliegue sin descargas y
 * sin salida, porque el reescaneo tampoco puede correr sin escaner.
 */
const scanUpload = async (filePath:string, deps:DocumentDeps, trace:string):Promise<ScanRecord> => {

  if(!Config.enable_antivirus) {
    return { scanStatus: 'clean', scanSignature: null, scanEngine: null, scanDate: null };
  }

  try {

    const result = await deps.scanner.check(filePath);

    // Una infeccion corta la peticion: no se deposita.
    if(result.infected) throw new ValidationError(
      'FILE_CORRUPT', `File is infected with ${result.signature}`);

    return { scanStatus: 'clean', scanSignature: null, scanEngine: result.engine, scanDate: new Date() };

  } catch(error:any) {

    if(!(error instanceof ScannerUnavailableError)) throw error;

    log.error(`${trace} | Antivirus unavailable, document stored as pending: ${error.message}`);

    return { scanStatus: 'pending', scanSignature: null, scanEngine: null, scanDate: null };
  }
}

/**
 * Veredicto completo del deposito: antivirus y contenido activo.
 *
 * Un infectado corta la peticion; el contenido activo no rechaza la subida, se
 * guarda y queda en cuarentena. Para un fondo documental esa es la correcta: el
 * deposito no se pierde.
 *
 * 'malicious' se impone a 'pending' y a 'clean': no lo resuelve el siguiente
 * reescaneo, solo `npm run scan:release -- <id>`.
 */
export const inspectUpload = async (filePath:string, mimetype:string, deps:DocumentDeps, trace:string):Promise<ScanRecord> => {

  const scan = await scanUpload(filePath, deps, trace);

  const active = await deps.activeContent.detect(filePath, mimetype);

  if(!active.active) return scan;

  log.warn(`${trace} | Active content quarantined: ${active.markers.join(', ')}`);

  return { ...scan, scanStatus: 'malicious', scanSignature: deps.activeContent.signature(active.markers) };
}

/**
 * Fail-closed: sin firma conocida para ese mimetype no se puede afirmar nada
 * sobre el contenido, asi que ampliar VALID_MIMETYPE exige anadir la firma en
 * infrastructure/files/filetype.ts.
 */
export const verifyContent = async (filePath:string, mimetype:string, deps:DocumentDeps) => {

  const check = await deps.fileType.verify(filePath, mimetype);

  if(!check.verifiable) throw new ValidationError(
    'INVALID_MIMETYPE', `No content signature available for mimetype "${mimetype}"`);

  if(!check.matches) throw new ValidationError(
    'INVALID_MIMETYPE', `File content does not match the declared mimetype "${mimetype}"`);
}
