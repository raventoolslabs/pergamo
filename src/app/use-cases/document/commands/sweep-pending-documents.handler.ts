import Config from '@/shared/config';
import log from '@/shared/logger';
import { ScannerUnavailableError } from '@/domain/exceptions/scanner-unavailable.exception';
import { SweepProgress } from '@/app/ports/services/rescan-queue.service';
import { DocumentDeps } from '../dependencies';
import { exceedsScanLimit, scanStoredFile } from '../scan-stored-file';
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
 * Analiza todo lo que quedo sin veredicto.
 *
 * Se paginan siempre los primeros cien pendientes y no se avanza el desfase: al
 * analizar uno deja de ser 'pending', asi que la siguiente vuelta trae los
 * siguientes. Avanzar el offset se saltaria uno de cada dos.
 *
 * Un escaner que no contesta detiene el barrido entero —seguir solo produciria
 * el mismo fallo mil veces—, pero un fichero mayor de lo que ese escaner lee no:
 * ese se salta y se sigue, porque el problema es del fichero y no del motor.
 */
export const sweepPendingDocuments = async (input:SweepPendingInput, deps:DocumentDeps):Promise<SweepProgress> => {

  const { organization, trace, report } = input;

  const progress:SweepProgress = {
    scanned: 0, clean: 0, quarantined: 0, missing: 0, skipped: 0, total: 0
  };

  // Los saltados siguen siendo 'pending', asi que volverian a salir en la
  // siguiente pagina: se recuerdan para no contarlos ni mirarlos dos veces.
  const skipped = new Set<string>();

  for(;;) {

    const page = await deps.documents.list({
      organization,
      scanStatus: ['pending'],
      limit: BATCH_SIZE,
      offset: 0,
      sort: 'creationDate',
      order: 'asc'
    });

    // El total se fija en la primera vuelta: cada documento analizado deja de
    // ser 'pending', asi que releerlo lo veria encoger hasta cero.
    if(progress.total === 0) progress.total = page.total;

    const batch = page.documents.filter((summary) => !skipped.has(summary.id));

    if(batch.length === 0) break;

    for(const summary of batch) {

      // El listado no trae `path` —es almacenamiento y no sale del repositorio—,
      // asi que el documento entero se pide aqui.
      const document = await getDocument(organization, summary.id, deps);

      if(exceedsScanLimit(document)) {
        skipped.add(summary.id);
        progress.skipped++;
        log.warn(`${trace} | Document ${summary.id} skipped: larger than the ${Config.max_file_size} bytes the scanner reads`);
        if(report) await report({ ...progress });
        continue;
      }

      try {

        const { outcome } = await scanStoredFile(document, deps, trace);

        progress.scanned++;
        if(outcome === 'clean') progress.clean++;
        if(outcome === 'infected') progress.quarantined++;
        if(outcome === 'missing') progress.missing++;

      } catch(error:any) {

        if(error instanceof ScannerUnavailableError) throw error;

        // Un fallo propio de este documento no se lleva por delante el barrido:
        // se anota y se sigue con el siguiente.
        skipped.add(summary.id);
        progress.skipped++;
        log.error(`${trace} | Document ${summary.id} could not be rescanned: ${error.message}`);
      }

      if(report) await report({ ...progress });
    }
  }

  log.info(`${trace} | Rescan sweep finished for ${organization}: ${progress.scanned} scanned (${progress.clean} clean, ${progress.quarantined} quarantined, ${progress.missing} missing, ${progress.skipped} skipped)`);

  return progress;
}
