-- GitHub como segundo origen remoto, con el mismo trato que Drive: se recoge la
-- documentacion en Markdown de una rama, se indexa, y lo que cambia se reindexa.
--
-- Las columnas drive_* del documento pasan a remote_*: ya no describen a Google
-- sino de donde viene el binario, y `source` dice de quien. La clave ajena a
-- drive_folder se cae porque una sola columna no puede apuntar a dos tablas: la
-- baja de la referencia la hace ahora quien borra la carpeta o el repositorio.
ALTER TABLE pergamo.document DROP CONSTRAINT document_drive_folder_fk;
ALTER TABLE pergamo.document DROP CONSTRAINT document_drive_file_check;
ALTER TABLE pergamo.document DROP CONSTRAINT document_source_check;

ALTER TABLE pergamo.document RENAME COLUMN drive_file_id TO remote_file_id;
ALTER TABLE pergamo.document RENAME COLUMN drive_folder TO remote_folder;
ALTER TABLE pergamo.document RENAME COLUMN drive_revision TO remote_revision;
ALTER TABLE pergamo.document RENAME COLUMN drive_view_link TO remote_view_link;

-- owner/repositorio@rama:ruta no cabe en los 128 de un id de Drive.
ALTER TABLE pergamo.document ALTER COLUMN remote_file_id TYPE VARCHAR(512);

ALTER TABLE pergamo.document
  ADD CONSTRAINT document_source_check CHECK (source IN ('disk','drive','github')),
  ADD CONSTRAINT document_remote_file_check CHECK (source = 'disk' OR remote_file_id IS NOT NULL);

ALTER INDEX pergamo.idx_document_drive_file RENAME TO idx_document_remote_file;
ALTER INDEX pergamo.idx_document_drive_folder RENAME TO idx_document_remote_folder;

-- Credenciales de GitHub de cada organizacion. Un token personal o de
-- aplicacion, sellado con SECRET_KEY igual que el client_secret de Drive: la
-- base nunca lo ve en claro. Tener fila aqui es lo que significa que una
-- organizacion tiene GitHub; GITHUB_ENABLED es el interruptor del despliegue.
--
-- api_url en NULL es github.com; se rellena para GitHub Enterprise.
CREATE TABLE pergamo.github_settings(
  organization VARCHAR(40) NOT NULL,
  creation_date TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  modification_date TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  api_url VARCHAR(256),
  token TEXT,
  CONSTRAINT github_settings_pk PRIMARY KEY(organization),
  CONSTRAINT github_settings_organization_fk FOREIGN KEY (organization)
    REFERENCES pergamo.organization(id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- Un repositorio y una rama concretos. last_commit es el atajo de la
-- sincronizacion: si la rama sigue en el mismo commit no hay nada que mirar, y
-- solo cuando avanza se compara el hash de cada documento.
CREATE TABLE pergamo.github_repository(
  id VARCHAR(40) NOT NULL DEFAULT uuid_generate_v4()::varchar,
  creation_date TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  organization VARCHAR(40) NOT NULL,
  owner VARCHAR(128) NOT NULL,
  repository VARCHAR(128) NOT NULL,
  branch VARCHAR(255) NOT NULL,
  index_documents BOOLEAN NOT NULL DEFAULT false,
  -- Guarda una copia en Pergamo mientras se sincroniza. Sin ella el documento
  -- se baja de la API cada vez que alguien lo pide.
  store_content BOOLEAN NOT NULL DEFAULT false,
  last_commit VARCHAR(40),
  sync_date TIMESTAMP WITHOUT TIME ZONE,
  sync_error TEXT,
  CONSTRAINT github_repository_pk PRIMARY KEY(id),
  CONSTRAINT github_repository_unique UNIQUE(organization, owner, repository, branch),
  CONSTRAINT github_repository_organization_fk FOREIGN KEY (organization)
    REFERENCES pergamo.organization(id) ON DELETE CASCADE ON UPDATE CASCADE
);
