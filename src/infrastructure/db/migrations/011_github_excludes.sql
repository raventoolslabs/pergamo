-- Rutas de un repositorio que no se archivan. Son patrones glob relativos a la
-- raiz de la rama, y se aplican sobre lo que ya hay: un documento que pasa a
-- estar excluido se da de baja en la siguiente pasada, y revive si se quita.
ALTER TABLE pergamo.github_repository
  ADD COLUMN excludes TEXT[] NOT NULL DEFAULT '{}';
