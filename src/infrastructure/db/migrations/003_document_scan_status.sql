-- Estado de analisis antivirico por documento.
--
-- ClamAV solo se ejecutaba en la subida. Un fichero limpio hoy puede tener
-- firma dentro de tres dias, y sin estado persistente ni reescaneo Pergamo
-- seguiria sirviendo ese documento indefinidamente. Estas columnas son lo que
-- permite reevaluar el corpus y bloquear la descarga de lo no verificado.
--
-- El estado va en columnas dedicadas y NO en el JSONB metadata: metadata es
-- modificable por el cliente a traves de modifyMetadata, cuya allowlist
-- (VALID_METADATA_MODIFY) es configurable por entorno. Si la clave de estado
-- viviera ahi, anadirla por descuido a esa lista permitiria a un cliente
-- auto-liberarse de la cuarentena.
ALTER TABLE pergamo.document
  ADD COLUMN scan_status    VARCHAR(16) NOT NULL DEFAULT 'pending',
  ADD COLUMN scan_signature VARCHAR(128),   -- firma disparada, para trazar falsos positivos
  ADD COLUMN scan_engine    VARCHAR(64),    -- version motor/BD: define que reescanear
  ADD COLUMN scan_date      TIMESTAMP WITHOUT TIME ZONE,
  ADD CONSTRAINT document_scan_status_check
    CHECK (scan_status IN ('pending','clean','infected','error'));

-- Backfill del corpus existente.
--
-- Poner 'pending' a todo bloquearia de golpe TODAS las descargas de una
-- instalacion en produccion: es el principal riesgo operativo de esta
-- migracion. Las filas existentes quedan como 'clean' con scan_engine NULL,
-- que es a la vez:
--   - el estado que preserva el comportamiento actual mientras no haya barrido,
--   - y la cola de trabajo del primer reescaneo, que selecciona exactamente por
--     scan_engine IS NULL.
--
-- Contrapartida explicita: el corpus preexistente sigue siendo descargable
-- hasta que `npm run rescan` lo evalue. Ejecutalo cuanto antes tras migrar.
UPDATE pergamo.document
  SET scan_status = 'clean'
  WHERE scan_engine IS NULL;

-- Indice parcial: las consultas operativas buscan lo que NO esta limpio
-- (cuarentena, cola de reescaneo), que es una fraccion minima de la tabla.
CREATE INDEX idx_document_scan_status ON pergamo.document(scan_status)
  WHERE scan_status <> 'clean';

-- Cola de reescaneo: documentos nunca analizados por este mecanismo o
-- analizados con una version de firmas anterior a la actual.
CREATE INDEX idx_document_scan_engine ON pergamo.document(scan_engine);
