import Config from '@/shared/config';
import log from '@/shared/logger';
import { Document } from '@/domain/entities/document';
import { DocumentDeps } from './dependencies';

/** Que se hizo con el fichero, para quien cuenta un barrido. */
export type ScanOutcome = 'clean' | 'infected' | 'missing';

export interface ScanResult {
  document: Document;
  outcome: ScanOutcome;
}

/**
 * Lo que el escaner no va a llegar a leer.
 *
 * Se mira el tamano antes de abrir el flujo porque clamd analiza por INSTREAM y
 * corta la conexion al pasarse de StreamMaxLength: intentarlo devuelve el mismo
 * fallo que un escaner caido, y los dos casos se resuelven de forma distinta.
 * MAX_FILE_SIZE es la medida que el despliegue declara para eso.
 *
 * Sin tamano guardado no se afirma nada: los depositos anteriores a que la
 * subida lo registrara no lo tienen, y ahi decide el escaner.
 */
export const exceedsScanLimit = (document:Document) =>
  typeof document.metadata.size === 'number' && document.metadata.size > Config.max_file_size;

/**
 * Analiza un documento ya almacenado y graba el veredicto. Una sola politica
 * para el reanalisis de uno y para el barrido de todos los pendientes.
 *
 * `ScannerUnavailableError` sube sin tocar: quien llama decide si eso corta una
 * peticion o un barrido entero. No se graba nada en ese caso, porque un analisis
 * que no llego a correr no puede degradar el veredicto anterior.
 */
export const scanStoredFile = async (document:Document, deps:DocumentDeps, trace:string):Promise<ScanResult> => {

  const { organization, id } = document;
  const content = await deps.content.fetch(document);

  // Que el fichero falte no es un veredicto favorable: se marca 'error' y sale
  // de la cola del barrido, porque otro escaneo no lo devuelve a su sitio.
  if(!content) {

    log.warn(`${trace} | Document ${id}: file not found in ${document.source}`);

    return {
      outcome: 'missing',
      document: await deps.documents.recordScan(organization, id, {
        scanStatus: 'error',
        scanSignature: 'FILE_MISSING',
        scanEngine: null,
        scanDate: new Date()
      })
    };
  }

  let result;
  try {
    result = await deps.scanner.check(content.filePath);
  } finally {
    await content.release();
  }

  if(result.infected) log.warn(`${trace} | Document ${id} QUARANTINED: ${result.signature}`);

  return {
    outcome: result.infected ? 'infected' : 'clean',
    document: await deps.documents.recordScan(organization, id, {
      scanStatus: result.infected ? 'infected' : 'clean',
      scanSignature: result.infected ? result.signature ?? null : null,
      scanEngine: result.engine,
      scanDate: new Date()
    })
  };
}
