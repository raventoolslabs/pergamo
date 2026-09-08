-- Indexacion semantica: los trozos de cada documento y sus vectores.
--
-- Viven aqui y no en un almacen vectorial aparte porque son dato DERIVADO del
-- documento: el ON DELETE CASCADE los borra solo, la clave foranea de
-- organizacion garantiza el aislamiento entre inquilinos, y escribir el indice
-- cabe en la misma transaccion que el documento.

-- pgvector no es «trusted»: lo instala el superusuario, como uuid-ossp,
-- pgcrypto y unaccent. Se intenta y, si el rol no puede, se para con el remedio
-- exacto en vez de fallar mas adelante con «type vector does not exist».
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    BEGIN
      EXECUTE 'CREATE EXTENSION vector';
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION
        'pgvector no esta instalado y el rol % no puede crearlo. Ejecutelo como superusuario sobre esta base: CREATE EXTENSION vector;', current_user;
    END;
  END IF;
END $$;

CREATE TABLE pergamo.document_chunk_v1(
  id BIGSERIAL,
  document VARCHAR(40) NOT NULL,
  -- Copia de document.organization: el filtro multi-inquilino de la busqueda no
  -- puede pagar un join en cada consulta ANN.
  organization VARCHAR(64) NOT NULL,
  position INTEGER NOT NULL,
  content TEXT NOT NULL,              -- con las migas de pan de los encabezados
  page INTEGER,
  section VARCHAR(256),
  heading_path TEXT[],
  content_type VARCHAR(16) NOT NULL DEFAULT 'text',   -- text|table|code|list
  lang VARCHAR(8),
  tokens INTEGER,
  -- Se crea ya, aunque la busqueda llegue despues: anadirla mas tarde obliga a
  -- reindexar el corpus entero.
  content_tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector('spanish', content)) STORED,
  creation_date TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT document_chunk_v1_pk PRIMARY KEY(id),
  -- CASCADE, y no el RESTRICT de la clave foranea a organization: un trozo es
  -- dato derivado, y borrar el documento debe llevarselos sin que el
  -- controlador tenga que acordarse.
  CONSTRAINT document_chunk_v1_document_fk FOREIGN KEY(document)
    REFERENCES pergamo.document(id) ON DELETE CASCADE,
  CONSTRAINT document_chunk_v1_organization_fk FOREIGN KEY(organization)
    REFERENCES pergamo.organization(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT document_chunk_v1_position_unique UNIQUE(document, position)
);

CREATE INDEX idx_document_chunk_v1_organization ON pergamo.document_chunk_v1(organization);
CREATE INDEX idx_document_chunk_v1_document ON pergamo.document_chunk_v1(document);
CREATE INDEX idx_document_chunk_v1_tsv ON pergamo.document_chunk_v1 USING GIN(content_tsv);

-- Imagenes y adjuntos de cada trozo: es lo que permite que una respuesta cite
-- la figura del documento y no solo su texto.
CREATE TABLE pergamo.document_chunk_asset(
  id BIGSERIAL,
  document VARCHAR(40) NOT NULL,
  chunk BIGINT,
  asset_type VARCHAR(20) NOT NULL,    -- image | file
  asset_name VARCHAR(255) NOT NULL,
  mimetype VARCHAR(100),
  content TEXT NOT NULL,              -- base64
  metadata JSONB,
  creation_date TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT document_chunk_asset_pk PRIMARY KEY(id),
  CONSTRAINT document_chunk_asset_document_fk FOREIGN KEY(document)
    REFERENCES pergamo.document(id) ON DELETE CASCADE,
  -- SET NULL y no CASCADE: reindexar rehace los trozos, y la imagen debe
  -- sobrevivir para volver a enlazarse.
  CONSTRAINT document_chunk_asset_chunk_fk FOREIGN KEY(chunk)
    REFERENCES pergamo.document_chunk_v1(id) ON DELETE SET NULL
);

CREATE INDEX idx_document_chunk_asset_document ON pergamo.document_chunk_asset(document);
CREATE INDEX idx_document_chunk_asset_chunk ON pergamo.document_chunk_asset(chunk);

-- Registro de indices, en lugar de una tabla de una sola fila: cambiar de
-- modelo se hace creando la version siguiente, reindexando y moviendo `active`.
CREATE TABLE pergamo.search_index(
  name VARCHAR(64) NOT NULL,          -- 'document_chunk_v1'
  provider VARCHAR(32) NOT NULL,
  model VARCHAR(96) NOT NULL,
  dimension INTEGER NOT NULL,
  distance VARCHAR(16) NOT NULL,      -- cosine
  chunker_version VARCHAR(16) NOT NULL,
  version INTEGER NOT NULL,
  active BOOLEAN NOT NULL DEFAULT false,
  creation_date TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT search_index_pk PRIMARY KEY(name)
);

-- Una sola version activa: la busqueda siempre sabe contra que tabla ir.
CREATE UNIQUE INDEX idx_search_index_active ON pergamo.search_index(active) WHERE active;

-- Estado por documento. En columnas propias y NO dentro de metadata, por la
-- razon escrita en 003_document_scan_status.sql: metadata la modifica el
-- cliente a traves de una allowlist configurable.
ALTER TABLE pergamo.document
  ADD COLUMN index_status          VARCHAR(16) NOT NULL DEFAULT 'none',
  ADD COLUMN index_model           VARCHAR(96),
  ADD COLUMN index_converter       VARCHAR(64),
  ADD COLUMN index_chunker_version VARCHAR(16),
  ADD COLUMN index_chunks          INTEGER,
  ADD COLUMN index_error           VARCHAR(256),
  ADD COLUMN index_date            TIMESTAMP WITHOUT TIME ZONE,
  ADD CONSTRAINT document_index_status_check
    CHECK (index_status IN ('none','pending','indexing','indexed','error','unsupported'));

-- Parcial: la inmensa mayoria del corpus se queda en 'none' y no interesa aqui.
CREATE INDEX idx_document_index_status ON pergamo.document(index_status)
  WHERE index_status <> 'none';

-- Sin backfill a proposito: el corpus existente queda en 'none'. Ponerlo todo
-- en 'pending' lanzaria una instalacion entera contra la maquina de inferencia
-- sin que nadie lo haya pedido. Entra con `npm run reindex -- --all`.

-- La anchura del vector es un parametro de despliegue, y las migraciones se
-- envian enteras y sin replacements —romperian los casts '::' y los bloques
-- $$—, asi que viaja como GUC local de la transaccion, puesto por el runner.
DO $$
DECLARE
  dimensions TEXT := current_setting('pergamo.embedding_dimensions', true);
BEGIN
  IF dimensions IS NULL OR dimensions = '' THEN
    RAISE EXCEPTION
      'Falta el GUC pergamo.embedding_dimensions. Lo inyecta el runner de migraciones desde EMBEDDING_DIMENSION.';
  END IF;

  EXECUTE format(
    'ALTER TABLE pergamo.document_chunk_v1 ADD COLUMN embedding vector(%s) NOT NULL', dimensions);

  -- vector_cosine_ops OBLIGA a consultar con '<=>'. Con '<->' o '<#>' el
  -- planificador cae a seq scan en silencio: sin error y sin aviso.
  EXECUTE
    'CREATE INDEX idx_document_chunk_v1_embedding ON pergamo.document_chunk_v1 USING hnsw (embedding vector_cosine_ops)';
END $$;
