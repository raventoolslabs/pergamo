# Pergamo

Gestor de documentos con analisis antivirus. API en Express + TypeScript
(`src/`), interfaz en React + Vite (`web/`), PostgreSQL y ClamAV.

## Regla obligatoria

**Antes de crear o editar cualquier fichero de codigo, test, migracion, script
o estilo, invoca la skill `write-code`** (`Skill(skill: "write-code")`) y sigue
lo que dice. Cubre las convenciones de escritura —codigo en ingles, texto de
interfaz en el catalogo de i18n, comentarios en espanol y sinteticos, markdown
en espanol— y el flujo de git que envuelve la tarea: actualizar contra
`development`, trabajar en una rama propia y terminar con push y PR.

Aplica tambien al terminar la tarea, para la parte de subida y PR.

## Comandos

```bash
npm run dev          # API + interfaz en desarrollo
npm run dev:seed     # datos de prueba
npx tsc --noEmit     # comprobacion de tipos
npx jest             # tests de integracion
./e2e/run.sh         # tests end-to-end (Playwright)
```
