import { ChunkPage } from '@/app/ports/repositories/document-chunk.repository';
import { DocumentDeps } from '../dependencies';
import { assertNotQuarantined } from '../quarantine';
import { getDocument } from './get-document.handler';

interface ListDocumentChunksInput {
  organization: string;
  document: string;
  limit: number;
  offset: number;
}

/**
 * Los trozos de un documento, para poder mirar dentro del indice: que texto se
 * extrajo, por donde se corto y a que seccion se atribuyo cada trozo.
 *
 * Resuelve primero el documento, como listDocumentVersions, para que el 404 y
 * el aislamiento salgan del mismo sitio que en el resto de la ficha en vez de
 * un filtro propio.
 *
 * Y se retiene por lo mismo que la descarga: estos trozos son el texto del
 * fichero, asi que entregarlos con el fichero bloqueado no bloquea nada.
 */
export const listDocumentChunks = async (
  input:ListDocumentChunksInput, deps:DocumentDeps):Promise<ChunkPage> => {

  const document = await getDocument(input.organization, input.document, deps);

  assertNotQuarantined(document);

  return deps.chunks.listByDocument({
    document: document.id,
    organization: input.organization,
    limit: input.limit,
    offset: input.offset
  });
}
