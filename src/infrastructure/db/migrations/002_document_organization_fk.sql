-- Integridad referencial entre documentos y organizaciones.
--
-- El esquema original declaraba document.organization sin clave foranea, de
-- modo que nada impedia documentos apuntando a organizaciones inexistentes.
--
-- Si la base de datos ya tiene documentos huerfanos, esta migracion se detiene
-- con un mensaje explicito en lugar de borrar datos por su cuenta: son datos de
-- produccion y la decision de que hacer con ellos no puede automatizarse.
DO $$
DECLARE
  huerfanos INTEGER;
BEGIN

  SELECT COUNT(DISTINCT d.organization) INTO huerfanos
  FROM pergamo.document d
  WHERE NOT EXISTS (
    SELECT 1 FROM pergamo.organization o WHERE o.id = d.organization
  );

  IF huerfanos > 0 THEN
    RAISE EXCEPTION
      'Hay % organizacion(es) referenciadas por documentos que no existen. Revisalas con: SELECT DISTINCT organization FROM pergamo.document d WHERE NOT EXISTS (SELECT 1 FROM pergamo.organization o WHERE o.id = d.organization); y resuelvelas antes de reintentar.',
      huerfanos;
  END IF;

END $$;

-- ON DELETE RESTRICT: una organizacion con documentos no puede borrarse por
-- error. La baja de organizaciones es logica (discharge_date), asi que esto no
-- interfiere con el funcionamiento normal.
--
-- Nota: no se estrecha document.organization de VARCHAR(64) a VARCHAR(40) para
-- igualarlo a organization.id. PostgreSQL admite la clave foranea entre ambos
-- tal cual, y reducir la longitud obligaria a reescribir la tabla con un
-- bloqueo exclusivo sin ganancia funcional.
ALTER TABLE pergamo.document
  ADD CONSTRAINT document_organization_fk
  FOREIGN KEY (organization) REFERENCES pergamo.organization(id)
  ON DELETE RESTRICT ON UPDATE CASCADE;
