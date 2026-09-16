-- Origen de cada documento: disco, como hasta ahora, o Google Drive.
--
-- Sin backfill: todo lo existente queda 'disk' y se comporta igual que antes.
-- El estado de Drive va en columnas propias y no en metadata por lo mismo que
-- el del antivirus (003): metadata la edita el cliente.
ALTER TABLE pergamo.document
  ADD COLUMN source VARCHAR(16) NOT NULL DEFAULT 'disk',
  ADD COLUMN drive_file_id VARCHAR(128),
  ADD COLUMN drive_folder VARCHAR(40),
  ADD COLUMN drive_revision VARCHAR(128),
  ADD COLUMN drive_view_link VARCHAR(512),
  -- Baja logica: lo que desaparece de Drive deja de verse, pero conserva id y
  -- metadatos por si vuelve.
  ADD COLUMN discharge_date TIMESTAMP WITHOUT TIME ZONE,
  ADD CONSTRAINT document_source_check CHECK (source IN ('disk','drive')),
  ADD CONSTRAINT document_drive_file_check CHECK (source = 'disk' OR drive_file_id IS NOT NULL),
  -- Borrar la carpeta no borra sus documentos: la baja la decide la sincronizacion.
  ADD CONSTRAINT document_drive_folder_fk FOREIGN KEY (drive_folder)
    REFERENCES pergamo.drive_folder(id) ON DELETE SET NULL;

-- Idempotencia de la importacion. Incluye las filas dadas de baja a proposito:
-- un fichero que reaparece revive su documento en vez de crear otro.
CREATE UNIQUE INDEX idx_document_drive_file
  ON pergamo.document(organization, drive_file_id)
  WHERE drive_file_id IS NOT NULL;

CREATE INDEX idx_document_drive_folder ON pergamo.document(drive_folder)
  WHERE drive_folder IS NOT NULL;

CREATE INDEX idx_document_discharge ON pergamo.document(organization)
  WHERE discharge_date IS NOT NULL;
