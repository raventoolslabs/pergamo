---
name: ddd-architecture
description: Arquitectura obligatoria de Pergamo — cinco capas (api, app, domain, infrastructure, shared), que puede importar a que, donde vive cada cosa y las convenciones de nombres y de esquema SQL. Usar SIEMPRE antes de crear un fichero nuevo bajo src/, al mover codigo entre capas, o al decidir donde colocar una funcionalidad.
---

# Arquitectura de Pergamo

Pergamo sigue Domain-Driven Design con separacion estricta de capas. La regla
que sostiene todo lo demas es la tabla de dependencias: si un import la rompe,
el codigo esta en la capa equivocada.

```
src/
  api/              transporte HTTP
  app/              casos de uso y puertos
  domain/           entidades, tipos del negocio y excepciones
  infrastructure/   base de datos, ficheros, antivirus, criptografia
  shared/           configuracion y utilidades transversales
```

## 1. Dependencias permitidas

```
  api  →  app  →  domain
  infrastructure  →  domain
  cualquiera      →  shared
```

Prohibido, sin excepciones:

```
  domain  →  infrastructure     el dominio no sabe que existe una base de datos
  domain  →  api                ni que existe HTTP
  app     →  api                un caso de uso no conoce req ni res
  app     →  infrastructure     salvo por su puerto en app/ports
```

La ultima es la que da el beneficio real: un caso de uso depende de la
**interfaz** que declara en `app/ports`, no de su implementacion. Por eso se
puede probar con dobles sin levantar Postgres, Redis ni clamd.

## 2. Que va en cada capa

### `api/`

Controladores, rutas, middleware y DTO de entrada y salida. Solo transporte:
leer la peticion, invocar un caso de uso, dar forma a la respuesta. Aqui vive la
traduccion de una excepcion de dominio a codigo HTTP, y ningun sitio mas.

**No contiene logica de negocio ni SQL.**

### `app/`

- `app/use-cases/<agregado>/{commands,queries}/` — un caso de uso por fichero.
- `app/ports/repositories/` — interfaces de persistencia.
- `app/ports/services/` — interfaces de todo lo externo: antivirus, almacen de
  ficheros, proveedor de embeddings, cola.

El caso de uso **orquesta**: valida el flujo, ordena las llamadas y controla la
transaccion. No conoce `req`, `res` ni `next`, y no escribe SQL.

### `domain/`

Entidades, value objects y excepciones. Es la capa que define el vocabulario:
que es un documento, que estados de analisis existen, que significa que algo no
se encuentre.

- No importa nada de `api`, `app` ni `infrastructure`.
- **Sin `any`.** Si un tipo no se sabe expresar, se escribe el tipo, no se
  esquiva.
- Sin `snake_case`: eso es forma de la base de datos, no del negocio.

### `infrastructure/`

Implementaciones de los puertos: repositorios, cliente de base de datos,
migraciones, sistema de ficheros, clamd, JWT, hash, logger. Aqui si se usa
`snake_case` y tipos del driver, porque es donde vive esa realidad.

Cada repositorio trae consigo su **mapper** entre la fila y la entidad. La
conversion ocurre en un sitio, no repartida por el codigo.

### `shared/`

Configuracion (`shared/config`) y utilidades sin dueño: validacion de entorno,
helpers de cadenas. Cualquier capa puede importarla, asi que **nada de logica de
negocio aqui**: si algo del dominio acaba en `shared`, esta mal colocado.

### `public/`

Recursos estaticos servidos por HTTP: HTML, imagenes, favicon, CSS. Sin
TypeScript, sin logica, y no importa nada de `src/`.

## 3. Nombres

- **Ficheros y carpetas en kebab-case**, sin excepcion:
  `domain/entities/document.ts`, `app/use-cases/document/commands/upload-document.handler.ts`.
- Clases e interfaces en PascalCase. **Sin prefijo `I`**: es `DocumentRepository`,
  no `IDocumentRepository`.
- Variables y funciones en camelCase; constantes de modulo en UPPER_SNAKE_CASE.
- Sufijos que dicen que es cada cosa: `.repository.ts`, `.handler.ts`,
  `.controller.ts`, `.routes.ts`, `.middleware.ts`, `.service.ts`, `.dto.ts`,
  `.exception.ts`.

## 4. Imports con alias

`tsconfig.json` declara `@/*` apuntando a `src/*`. Se usa siempre para cruzar de
capa:

```ts
// mal: con la anidacion de capas esto es ilegible y se rompe al mover el fichero
import Config from '../../../shared/config';

// bien
import Config from '@/shared/config';
```

Dentro de la misma carpeta el import relativo es correcto y preferible.

## 5. Casos de uso

Un caso de uso es **un fichero con una funcion exportada**, no una clase. La
regla que importa es una responsabilidad por fichero; envolverla en una clase
sin estado solo añade ceremonia, y el resto del proyecto es funcional.

Las dependencias entran por parametro con un valor por defecto, que es lo que
permite sustituirlas en las pruebas:

```ts
export const uploadDocument = async (input:UploadDocumentInput,
  deps = { documents: documentRepository, scanner: clamavService }) => { ... }
```

Commands y queries van en carpetas separadas. Un command cambia estado; una
query no.

## 6. Modelos: dos, y no se mezclan

| | Ubicacion | Puede |
|---|---|---|
| Fila de base de datos | `infrastructure/db/schema/` | `snake_case`, tipos del driver |
| Entidad de dominio | `domain/entities/` | camelCase, tipos propios, sin `any` |

Una fila **nunca** sale de `infrastructure`. Lo que cruza hacia `app` es la
entidad, y lo que la convierte es el mapper.

## 7. Esquema de base de datos

Reglas al crear o modificar SQL, todas ya vigentes en el esquema actual:

1. Todo va en el esquema `pergamo`.
2. Identificadores `VARCHAR(40)`.
3. Fechas `TIMESTAMP WITHOUT TIME ZONE`, con los nombres que ya usa el esquema:
   `creation_date`, `modification_date`.
4. Toda clave foranea con **nombre explicito** y **`ON DELETE` declarado**.
   `CASCADE` para dato derivado, `RESTRICT` para lo que no debe desaparecer solo.
5. Indice en toda clave foranea y en toda columna por la que se filtre.
6. Nunca un secreto en claro: solo hashes.
7. **El estado va en columnas propias, jamas dentro del JSONB `metadata`.**
   `metadata` lo modifica el cliente a traves de una allowlist configurable
   (`VALID_METADATA_MODIFY`): una clave de estado ahi dentro permitiria a un
   cliente cambiarse el suyo. Esta escrito en `003_document_scan_status.sql`.
8. Migraciones en `infrastructure/db/migrations/`, numeradas `NNN_descripcion.sql`,
   y se aplican solas: el runner ejecuta cada una en su propia transaccion.
9. Sin `SELECT *` fuera de un repositorio.

## 8. Al añadir algo nuevo

En este orden, y el orden es la comprobacion:

1. ¿Que concepto del negocio es? → entidad o value object en `domain/`.
2. ¿Que necesita del exterior? → interfaz en `app/ports/`.
3. ¿Que hace? → caso de uso en `app/use-cases/`.
4. ¿Como se hace de verdad? → implementacion en `infrastructure/`.
5. ¿Como se pide? → controlador y ruta en `api/`.

Si el paso 1 no se sabe responder, el paso 3 va a salir mal.
