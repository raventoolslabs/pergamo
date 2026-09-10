import Config from '@/shared/config';
import log from '@/shared/logger';
import { ScannerUnavailableError } from '@/domain/exceptions/scanner-unavailable.exception';
import { DocumentListFilter } from '@/app/ports/repositories/document.repository';
import { SweepProgress } from '@/app/ports/services/rescan-queue.service';
import { DocumentDeps } from '../dependencies';
import { scanStoredFile } from '../scan-stored-file';
import { getDocument } from '../queries/get-document.handler';

export interface SweepPendingInput {
  organization: string;
  trace: string;
  /** Para publicar el avance mientras dura; el barrido no sabe de colas. */
  report?: (progress:SweepProgress) => Promise<void> | void;
}

// El listado se pide de cien en cien: el corpus entero en una consulta no cabe
// en memoria y tampoco hace falta.
const BATCH_SIZE = 100;

/**
 * Lo que un barrido puede resolver: sin veredicto y dentro de lo que el escaner
 * lee. Lo que no le cabe no cuenta como pendiente de analizar, porque ningun
 * analisis se lo va a dar.
 *
 * Se declara aqui y lo usa tambien el recuento que decide si hay algo que
 * barrer: dos definiciones distintas ofrecerian un barrido de cero documentos.
 */
export const scannablePending = (organization:string):DocumentListFilter => ({
  organization,
  scanStatus: ['pending'],
  maxSize: Config.max_file_size,
  limit: BATCH_SIZE,
  offset: 0,
  sort: 'creationDate',
  order: 'asc'
});

/** Cuantos quedan por analizar, con el mismo criterio con que se analizan. */
export const countScannablePending = async (organization:string, deps:DocumentDeps):Promise<number> =>
  (await deps.documents.list({ ...scannablePending(organization), limit: 1 })).total;

/**
 * Analiza todo lo que quedo sin veredicto.
 *
 * Se paginan siempre los primeros cien y no se avanza el desfase: al analizar
 * uno deja de ser 'pending', asi que la siguiente vuelta trae los siguientes.
 * Avanzar el offset se saltaria uno de cada dos.
 *
 * Un escaner que no contesta detiene el barrido entero: seguir solo produciria
 * el mismo fallo mil veces.
 */
export const sweepPendingDocuments = async (input:SweepPendingInput, deps:DocumentDeps):Promise<SweepProgress> => {

  const { organization, trace, report } = input;

  const progress:SweepProgress = {
    scanned: 0, clean: 0, quarantined: 0, missing: 0, failed: 0, total: 0
  };

  // Un documento que falla por lo suyo sigue siendo 'pending', asi que volveria
  // a salir en la siguiente pagina: se recuerda para no reintentarlo en bucle.
  const failed = new Set<string>();

  for(;;) {

    const page = await deps.documents.list(scannablePending(organization));

    // El total se fija en la primera vuelta: cada documento analizado deja de
    // ser 'pending', asi que releerlo lo veria encoger hasta cero.
    if(progress.total === 0) progress.total = page.total;

    const batch = page.documents.filter((summary) => !failed.has(summary.id));

    if(batch.length === 0) break;

    for(const summary of batch) {

      try {

        // El listado no trae `path` —es almacenamiento y no sale del
        // repositorio—, asi que el documento entero se pide aqui.
        const document = await getDocument(organization, summary.id, deps);
        const { outcome } = await scanStoredFile(document, deps, trace);

        progress.scanned++;
        if(outcome === 'clean') progress.clean++;
        if(outcome === 'infected') progress.quarantined++;
        if(outcome === 'missing') progress.missing++;

      } catch(error:any) {

        if(error instanceof ScannerUnavailableError) throw error;

        // Un fallo propio de este documento no se lleva por delante el barrido:
        // se anota y se sigue con el siguiente.
        failed.add(summary.id);
        progress.failed++;
        log.error(`${trace} | Document ${summary.id} could not be rescanned: ${error.message}`);
      }

      if(report) await report({ ...progress });
    }
  }

  log.info(`${trace} | Rescan sweep finished for ${organization}: ${progress.scanned} scanned (${progress.clean} clean, ${progress.quarantined} quarantined, ${progress.missing} missing, ${progress.failed} failed)`);

  return progress;
}
