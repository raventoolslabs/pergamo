-- Conexion de una organizacion con su Google Drive y carpetas que sincroniza.
--
-- Una conexion por organizacion: la cuenta de Google es de la organizacion, no
-- de quien pulso el boton. El refresh_token llega ya sellado con SECRET_KEY;
-- la base nunca lo ve en claro.
CREATE TABLE pergamo.drive_connection(
  organization VARCHAR(40) NOT NULL,
  creation_date TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  modification_date TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  google_account VARCHAR(320) NOT NULL,
  refresh_token TEXT NOT NULL,
  scope VARCHAR(512) NOT NULL,
  -- Google puede invalidar el token por su cuenta: se marca y se pide
  -- reconectar, en vez de borrar y perder la cuenta asociada.
  revoked_date TIMESTAMP WITHOUT TIME ZONE,
  CONSTRAINT drive_connection_pk PRIMARY KEY(organization),
  CONSTRAINT drive_connection_organization_fk FOREIGN KEY (organization)
    REFERENCES pergamo.organization(id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- El progreso de una sincronizacion en marcha no esta aqui: vive en el trabajo
-- de BullMQ. Aqui solo queda el resultado de la ultima.
CREATE TABLE pergamo.drive_folder(
  id VARCHAR(40) NOT NULL DEFAULT uuid_generate_v4()::varchar,
  creation_date TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  organization VARCHAR(40) NOT NULL,
  folder_id VARCHAR(128) NOT NULL,
  name VARCHAR(512) NOT NULL,
  index_documents BOOLEAN NOT NULL DEFAULT false,
  sync_date TIMESTAMP WITHOUT TIME ZONE,
  sync_error TEXT,
  CONSTRAINT drive_folder_pk PRIMARY KEY(id),
  CONSTRAINT drive_folder_unique UNIQUE(organization, folder_id),
  CONSTRAINT drive_folder_organization_fk FOREIGN KEY (organization)
    REFERENCES pergamo.organization(id) ON DELETE CASCADE ON UPDATE CASCADE
);
