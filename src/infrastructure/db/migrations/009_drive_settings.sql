-- Cliente OAuth de Google de cada organizacion. Antes era del despliegue entero:
-- asi cada una usa su propio proyecto de Google Cloud, con su cuota y su
-- pantalla de consentimiento.
--
-- Tener fila aqui es lo que significa que una organizacion tiene Drive;
-- DRIVE_ENABLED sigue siendo el interruptor del despliegue.
--
-- client_secret llega sellado con SECRET_KEY, igual que el refresh_token de 007:
-- la base nunca lo ve en claro. Es NULL cuando se retira sin borrar el resto.
CREATE TABLE pergamo.drive_settings(
  organization VARCHAR(40) NOT NULL,
  creation_date TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  modification_date TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  client_id VARCHAR(256) NOT NULL,
  client_secret TEXT,
  CONSTRAINT drive_settings_pk PRIMARY KEY(organization),
  CONSTRAINT drive_settings_organization_fk FOREIGN KEY (organization)
    REFERENCES pergamo.organization(id) ON DELETE CASCADE ON UPDATE CASCADE
);
