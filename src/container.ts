/**
 * Punto de composicion: el unico sitio donde las implementaciones concretas se
 * enchufan a los puertos.
 *
 * Existe porque los casos de uso reciben sus dependencias por parametro y no
 * pueden importarlas: `app` no conoce `infrastructure`. Aqui si, porque este
 * fichero no es una capa, es el cableado.
 */
import { DocumentDeps } from '@/app/use-cases/document/dependencies';
import { IndexingDeps } from '@/app/use-cases/indexing/dependencies';
import { SearchDeps } from '@/app/use-cases/search/dependencies';
import { OrganizationDeps } from '@/app/use-cases/organization/dependencies';

import { documentRepository } from '@/infrastructure/db/repositories/document.repository';
import { organizationRepository } from '@/infrastructure/db/repositories/organization.repository';
import { sequelizeUnitOfWork } from '@/infrastructure/db/unit-of-work';
import { documentStorage } from '@/infrastructure/files/document-storage';
import { fileTypeVerifier } from '@/infrastructure/files/file-type.adapter';
import { activeContentDetector } from '@/infrastructure/antivirus/active-content.adapter';
import antivirus from '@/infrastructure/antivirus/clamav.service';
import { jwtService } from '@/infrastructure/security/jwt';
import { documentChunkRepository } from '@/infrastructure/db/repositories/document-chunk.repository';
import { officeParserConverter } from '@/infrastructure/indexing/converters/officeparser.converter';
import { chunker } from '@/infrastructure/indexing/chunker';
import { openAiCompatibleEmbedder } from '@/infrastructure/indexing/embedders/openai-compatible.embedder';
import { SearchIndexDescriptor } from '@/domain/entities/search-index';
import { indexQueue } from '@/infrastructure/queue/index.queue';
import { assertEmbeddingSchema } from '@/infrastructure/db/embedding-schema';
import { connection, QUEUE_NAME } from '@/infrastructure/queue/connection';

export const documentDeps:DocumentDeps = {
  documents: documentRepository,
  chunks: documentChunkRepository,
  queue: indexQueue,
  storage: documentStorage,
  scanner: antivirus,
  activeContent: activeContentDetector,
  fileType: fileTypeVerifier,
  unitOfWork: sequelizeUnitOfWork
};

export const organizationDeps:OrganizationDeps = {
  organizations: organizationRepository,
  tokens: jwtService
};

export const indexingDeps:IndexingDeps = {
  documents: documentRepository,
  chunks: documentChunkRepository,
  converter: officeParserConverter,
  chunker,
  embedder: openAiCompatibleEmbedder,
  storage: documentStorage,
  unitOfWork: sequelizeUnitOfWork
};

export const searchDeps:SearchDeps = {
  chunks: documentChunkRepository,
  embedder: openAiCompatibleEmbedder
};

// Identidad del indice activo: la mitad la aporta el proveedor y la otra mitad
// el troceado, asi que solo se puede componer aqui.
export const searchIndex = ():SearchIndexDescriptor => ({
  name: 'document_chunk_v1',
  provider: openAiCompatibleEmbedder.provider,
  model: openAiCompatibleEmbedder.model,
  dimension: openAiCompatibleEmbedder.dimension,
  distance: openAiCompatibleEmbedder.distance,
  chunkerVersion: chunker.version,
  version: 1
});

export { QUEUE_NAME };
export const queueConnection = connection;

/**
 * Que el esquema y el proveedor declaran lo mismo. Es local y barato, y lo que
 * detecta —una anchura que no cuadra, un operador que el indice no puede
 * servir— no falla solo: da resultados que no significan nada. Bloquea el
 * arranque de la API y del worker por igual.
 *
 * Memoizado: lo piden los dos y la respuesta no cambia.
 */
let asserted:Promise<void> = null;

export const assertIndexReady = () => {

  if(!asserted) asserted = assertEmbeddingSchema(searchIndex())
    .catch((error) => { asserted = null; throw error; });

  return asserted;
};

/**
 * Ademas, que el proveedor responde. Esto SOLO lo espera el worker: aceptar
 * trabajos contra una maquina de inferencia muerta no sirve de nada.
 *
 * La API no lo hace. Un tercero que no responde no puede impedir que arranque
 * el archivo entero, y /search dira lo que pasa cuando se le pregunte.
 */
export const prepareWorker = async () => {
  await assertIndexReady();
  await indexingDeps.embedder.init();
};
