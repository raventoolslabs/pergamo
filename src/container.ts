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
 * Lo que hay que comprobar antes de indexar o buscar: que el esquema y el
 * proveedor dicen lo mismo, y que el proveedor responde.
 *
 * Memoizado porque lo piden dos: el arranque de la API —que necesita el
 * proveedor para /search aunque el worker vaya suelto— y el propio worker.
 */
let prepared:Promise<void> = null;

export const prepareIndexing = () => {

  if(!prepared) prepared = (async () => {
    await assertEmbeddingSchema(searchIndex());
    await indexingDeps.embedder.init();
  })().catch((error) => { prepared = null; throw error; });

  return prepared;
};
