import log from '@/shared/logger';
import { EmbeddedChunk } from '@/domain/entities/chunk';
import { ConversionUnsupportedError } from '@/domain/exceptions/indexing.exception';
import { IndexingDeps } from '../dependencies';

// Interna: solo existe para deshacer la transaccion cuando el hash ya no cuadra.
class StaleDocumentError extends Error {}

export interface IndexDocumentInput {
  document: string;
  organization: string;
}

export type IndexOutcome = 'indexed' | 'unsupported' | 'error' | 'skipped' | 'stale';

/**
 * Convierte, trocea, embebe y escribe el indice de un documento.
 *
 * Las dependencias llegan por parametro: una prueba lo ejerce entero con dobles,
 * sin Redis y sin maquina de inferencia.
 */
export const indexDocument = async (input:IndexDocumentInput, deps:IndexingDeps):Promise<IndexOutcome> => {

  const { document: id, organization } = input;

  const document = await deps.documents.findById(organization, id);

  // Se borro entre el encolado y la ejecucion. No es un fallo.
  if(!document) return 'skipped';

  // Paso a cuarentena mientras esperaba: lo retenido no se abre.
  if(document.scanStatus !== 'clean') {
    await deps.documents.setIndexStatus(id, 'none');
    return 'skipped';
  }

  if(!deps.converter.supports(document.metadata.mimetype)) {
    await deps.documents.setIndexStatus(id, 'unsupported',
      `No converter for mimetype "${document.metadata.mimetype}"`);
    return 'unsupported';
  }

  // El hash de AHORA: si cambia mientras se convierte, lo indexado ya no
  // describe el fichero que hay en disco.
  const hash = document.metadata.hash;
  const filePath = deps.storage.resolve(organization, document.path);

  if(!await deps.storage.exists(filePath)) {
    await deps.documents.setIndexStatus(id, 'error', 'FILE_MISSING');
    return 'error';
  }

  await deps.documents.setIndexStatus(id, 'indexing');

  let embedded:EmbeddedChunk[];

  try {

    const converted = await deps.converter.convert(filePath, document.metadata.mimetype);
    const chunks = deps.chunker.split(converted);

    // Un PDF escaneado sin capa de texto llega hasta aqui sin nada. Marcarlo
    // indexado con cero trozos lo escondería: es accionable y se dice.
    if(!chunks.length) {
      await deps.documents.setIndexStatus(id, 'error', 'EMPTY_CONTENT');
      return 'error';
    }

    const vectors = await deps.embedder.embedDocuments(chunks.map((chunk) => chunk.content));

    embedded = chunks.map((chunk, index) => ({ ...chunk, embedding: vectors[index] }));

  } catch(error:any) {

    if(error instanceof ConversionUnsupportedError) {
      await deps.documents.setIndexStatus(id, 'unsupported', error.message.slice(0, 256));
      return 'unsupported';
    }

    // Todo lo demas —incluida la maquina de inferencia caida— vuelve a
    // 'pending': se reintenta, y nunca se marca indexado sin vector.
    await deps.documents.setIndexStatus(id, 'pending', error.message?.slice(0, 256));
    throw error;
  }

  const written = await deps.unitOfWork.run(async (scope) => {

    await deps.chunks.replace(id, organization, embedded, scope);

    const closed = await deps.documents.finishIndexing(id, hash, {
      model: deps.embedder.model,
      converter: deps.converter.name,
      chunkerVersion: deps.chunker.version,
      chunks: embedded.length
    }, scope);

    // Cero filas afectadas: el fichero se reemplazo mientras convertiamos, asi
    // que se deshace todo. La reindexacion la dispara ese propio reemplazo.
    if(!closed) throw new StaleDocumentError();

    return true;
  }).catch((error) => {
    if(error instanceof StaleDocumentError) return false;
    throw error;
  });

  if(!written) {
    log.warn(`Document ${id} changed while indexing: the chunks were discarded`);
    return 'stale';
  }

  return 'indexed';
}
