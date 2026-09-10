# Pergamo

Gestor de documentos con analisis antivirus. API en Express + TypeScript
(`src/`), interfaz en React + Vite (`web/`), PostgreSQL y ClamAV.

## Regla obligatoria

**Antes de crear o editar cualquier fichero de codigo, test, migracion, script
o estilo, invoca la skill `write-code`** (`Skill(skill: "write-code")`) y sigue
lo que dice. Cubre las convenciones de escritura —codigo en ingles, texto de
interfaz en el catalogo de i18n, comentarios en espanol y sinteticos, markdown
en espanol— y el flujo de git que envuelve la tarea: toda rama nace de un
`development` recien bajado, se trabaja en ella y se termina con push y PR.

Aplica tambien al terminar la tarea, para la parte de subida y PR.

**Antes de crear un fichero nuevo bajo `src/` o de mover codigo entre capas,
invoca la skill `ddd-architecture`** (`Skill(skill: "ddd-architecture")`).
Define las cinco capas, que puede importar a que, y donde vive cada cosa.

## Arquitectura

```
src/api/              controladores, rutas, middleware, DTO
src/app/              casos de uso y puertos
src/domain/           entidades, value objects, excepciones
src/infrastructure/   base de datos, ficheros, antivirus, criptografia
src/shared/           configuracion y utilidades transversales
```

Dependencias: `api → app → domain`, `infrastructure → domain`, y `shared` la
importa cualquiera. Lo demas esta prohibido.

## Comandos

```bash
npm run dev          # API + interfaz en desarrollo
npm run dev:seed     # datos de prueba
npm run typecheck    # tipos, src y test (tsc --noEmit solo mira src)
npm test             # tests (jest necesita --experimental-vm-modules)
./e2e/run.sh         # tests end-to-end (Playwright)
```

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
