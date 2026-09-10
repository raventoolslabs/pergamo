-- Ordenar el listado por columna: la interfaz ya no lista solo por fecha de
-- deposito, sino tambien por nombre y por gravedad del veredicto.
--
-- Los indices llevan organization delante porque toda consulta del listado
-- filtra por inquilino, e id al final porque el ORDER BY desempata por id: sin
-- el, dos paginas consecutivas pueden repetir una fila y saltarse otra.

CREATE INDEX idx_document_sort_creation
  ON pergamo.document(organization, creation_date, id);

CREATE INDEX idx_document_sort_modification
  ON pergamo.document(organization, modification_date, id);

-- Al construir o mantener un indice, Postgres restringe el search_path a
-- pg_catalog, y ahi clean_str no encuentra unaccent: el indice de abajo no se
-- puede crear sin esto, y el de description del esquema inicial solo existe
-- porque se creo con la tabla vacia.
--
-- Ni la funcion ni la extension estan en un esquema fijo: el search_path de la
-- conexion es «"$user", public», asi que caen en public o en el esquema del
-- rol segun como se llame el usuario del despliegue. Se resuelven, no se
-- suponen.
DO $$
DECLARE
  target regprocedure := to_regprocedure('clean_str(character varying)');
  home TEXT;
BEGIN
  IF target IS NULL THEN
    RAISE EXCEPTION 'No se encuentra clean_str(varchar) desde el search_path %', current_schemas(true);
  END IF;

  SELECT n.nspname INTO home
  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'unaccent';

  EXECUTE format('ALTER FUNCTION %s SET search_path = %I, pg_temp', target, home);
END $$;

-- La misma expresion con que se filtra por nombre, para que sirva a las dos.
CREATE INDEX idx_document_sort_name
  ON pergamo.document(organization, clean_str(metadata->>'name'), id);

-- El orden por estado no se indexa: sale de un CASE por gravedad que ningun
-- indice normal casa, y las filas que interesan las cubre el indice parcial
-- idx_document_scan_status de 003.
