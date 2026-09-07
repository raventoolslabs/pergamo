# Pergamo

Pergamo es una API HTTP de gestión documental multi-organización. Cada organización (tenant) se autentica, sube documentos, los versiona, los etiqueta con metadatos y los descarga, con aislamiento entre organizaciones aplicado en cada consulta. Los ficheros subidos se analizan con ClamAV antes de almacenarse, y el corpus almacenado se reanaliza cuando avanzan las firmas.

Incluye una **interfaz web** que cubre todo lo que ofrece la API y que sirve el propio proceso, en el mismo puerto: no hay que desplegar nada aparte.

Es un **servicio único** (monolito modular ejecutado en un solo proceso Node), no una arquitectura de microservicios.

## Estructura del proyecto

* `src/routes` — definición de rutas y encadenado de middleware.
* `src/controllers` — lógica de negocio de documentos y organizaciones.
* `src/models` — interfaces TypeScript de las entidades.
* `src/middleware` — autenticación JWT, manejo de errores y logging por petición.
* `src/utils` — base de datos, JWT, hashing, ficheros, tipo de fichero, antivirus, migraciones y logger.
* `src/config` — configuración por variables de entorno e `init.sql` (esquema, triggers y funciones).
* `src/migrations` — migraciones SQL versionadas (ver más abajo).
* `src/scripts` — tareas de operación: reescaneo del corpus y liberación de falsos positivos.
* `web` — interfaz web (React + Vite), proyecto npm propio; su build cae en `dist/web`.
* `web/src/i18n` — catálogo de la interfaz: clave en inglés, texto en español. Ningún literal de cara al usuario vive suelto en el JSX.
* `dev.js` — arranque de desarrollo: API e interfaz en un solo comando.
* `e2e` — recorrido en navegador de la interfaz, en contenedor. Proyecto npm propio, fuera de `web/` para que Playwright no entre en el build de la imagen.
* `public` — logo y favicons, que Vite incorpora al build de la interfaz.
* `clamav` — configuración del demonio ClamAV (`clamd.conf`) y lista local de firmas ignoradas.
* `test` — pruebas de integración.

## Convenciones de código

El código va **en inglés** —identificadores, tipos, nombres de fichero, clases CSS, rutas de la URL,
mensajes de commit— y los comentarios **en español**, breves y explicando el *porqué*: si un
comentario se limita a traducir a prosa la línea de debajo, sobra. El texto que ve el usuario vive en
`web/src/i18n`, con la clave en inglés y la traducción en español. Los `.md` del proyecto, este
incluido, se escriben en español.

La regla completa, junto al flujo de git que envuelve cualquier tarea de código (toda rama nace de un
`development` recién bajado, se trabaja en ella y se termina con push y PR contra `development`), está
en la skill `write-code` (`.claude/skills/write-code/SKILL.md`).

## Configuración

Copia `.env.example` a `.env` y ajusta los valores. La configuración **se valida al arrancar**: si falta una variable obligatoria o tiene un formato incorrecto, el proceso falla de inmediato indicando cuál.

Variables que conviene revisar antes de desplegar:

| Variable | Efecto |
|---|---|
| `JWT_EXPIRES_IN` | Caducidad de los tokens (por defecto `8h`). |
| `TRUST_PROXY` | Saltos de proxy inverso en los que confiar. **Si hay un proxy delante y vale 0, el rate limiting agrupará a todos los clientes bajo una sola IP.** |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | Intentos permitidos por IP en los endpoints de credenciales. |
| `MAX_FILE_SIZE` | Tamaño máximo por fichero subido, en bytes. **Si lo cambias, ajusta también `MaxFileSize`, `MaxScanSize` y `StreamMaxLength` en `clamav/clamd.conf`**: por debajo de este valor, ClamAV deja de analizar por completo los ficheros más grandes. |
| `DEBUG` | Nivel de log `debug`; registra metadatos completos de fichero y documento. |
| `ENABLE_ANTIVIRUS` | Análisis con ClamAV. Si no se define, el antivirus queda **desactivado** y el arranque lo advierte por log. Acepta `true/1/yes/on` y `false/0/no/off` sin distinguir mayúsculas; **un valor no reconocido detiene el arranque** en lugar de desactivar el escaneo en silencio. |
| `CLAMAV_HOST` / `CLAMAV_PORT` | Destino del demonio clamd. Con `ENABLE_ANTIVIRUS` activo hay que definir esto o `CLAMAV_SOCKET`: sin uno de los dos, el arranque falla. |
| `CLAMAV_SOCKET` | Alternativa a host/puerto para un clamd local por socket unix. |
| `CLAMAV_INIT_RETRIES` / `CLAMAV_INIT_RETRY_DELAY_MS` | Reintentos de conexión al arrancar. clamd tarda decenas de segundos en cargar las firmas. |
| `TMP_MAX_AGE_MS` / `TMP_CLEANUP_INTERVAL_MS` | Limpieza periódica de temporales huérfanos en `data/tmp`. |

## Construcción y ejecución

El código TypeScript se compila antes de ejecutarse:

```
npm install
npm run build     # API (dist/) + interfaz web (dist/web)
npm run init      # crea esquema, organización inicial y claves; aplica migraciones
npm start         # ejecuta dist/index.js

npm run build:api            # solo la API
npm run build:web            # solo la interfaz
npm run rescan               # reanaliza el corpus con las firmas actuales
npm run scan:release -- <id> # libera un falso positivo de la cuarentena
```

`npm run build` construye también la interfaz, así que necesita acceso a la red para instalar
las dependencias de `web/`. Si solo interesa la API, `npm run build:api` hace lo de siempre: el
servidor arranca igual y avisa por log de que se sirve sin interfaz.

Para desarrollo, `npm run dev` ejecuta la API sin compilar mediante ts-node.

### Despliegue con Docker

`docker compose up --build` levanta dos servicios: **clamav** y **pergamo**. Antes el `docker-compose.yml` declaraba un único servicio, con ClamAV dentro del contenedor de la API.

| Servicio | Papel |
|---|---|
| `clamav` | Demonio de análisis, imagen oficial con versión fijada, volumen propio para las firmas y `healthcheck` real contra el puerto 3310. Su puerto **no** se publica al host. |
| `pergamo` | La aplicación: interfaz y API en el puerto 3000. No arranca hasta que el escáner está sano. |

**La base de datos no la declara el compose.** Sale de `DB_HOST` y `DB_PORT` del `.env`, y se alcanza por la red `steamfront`, que es externa —no la crea este fichero— y es donde vive el postgres compartido del host. Antes el compose levantaba su propio contenedor de postgres con su propio volumen, lo que creaba una segunda base en máquinas que ya tenían una. Si la red no existe todavía:

```
docker network create steamfront
```

El contenedor publica el **3000**, que es la puerta de entrada: el mismo puerto que ocupa la interfaz en `npm run dev`, para que el proxy inverso apunte siempre al mismo sitio. Los dos entornos comparten ese puerto a propósito, así que solo puede correr uno de los dos a la vez. El compose fija `PORT=3000` dentro de la imagen, de modo que el `PORT=3001` que el `.env` lleva para desarrollo no se filtra al contenedor.

En un host cuyos contenedores no tengan salida a internet, el servicio `clamav` necesita `CLAMAV_NO_FRESHCLAMD=true` y que las firmas se siembren desde fuera sobre el volumen que monta en `/var/lib/clamav`: freshclam no puede actualizarse por sí mismo desde dentro, y sin esa variable falla en cada arranque.

ClamAV vive ahora en su propio contenedor por tres motivos: aísla su ~1–1,5 GB residentes del cgroup de la API (antes un OOM del escáner tumbaba el servicio), permite un healthcheck de verdad, y saca la lógica de arranque de clamd del `docker-entrypoint.sh`. La aplicación le habla por TCP y espera a poder hacerlo **antes** de escuchar: la ventana en la que cada subida devolvía un `500` opaco mientras clamd cargaba firmas ya no existe.

La imagen de la aplicación ejecuta el proceso como usuario `node`: **no corre como root**.

Los límites de `clamav/clamd.conf` (`MaxFileSize`, `MaxScanSize`, `StreamMaxLength`) deben ser siempre mayores o iguales que `MAX_FILE_SIZE`. Están en dos ficheros distintos, así que la prueba `Should scan a file up to MAX_FILE_SIZE` existe precisamente para detectar que se han desalineado. `AlertExceedsMax yes` hace que lo que no se pueda analizar se **señale** en lugar de aprobarse, que es el comportamiento contrario al de ClamAV por defecto.

## Interfaz web

La interfaz vive en `web/` (React + Vite) y se compila a `dist/web`, junto al JavaScript de la
API. Express la sirve en la raíz del mismo puerto, así que `http://localhost:3000` abre la
aplicación y `http://localhost:3000/document` sigue siendo la API. Si `dist/web` no existe —por
ejemplo tras un `npm run build:api` a secas— el arranque lo advierte por log y el servicio
funciona igual, solo que sin interfaz.

Qué permite hacer, según con quién se entre:

| Sesión | Puede |
|---|---|
| Organización | Listar, buscar y filtrar documentos; subirlos (varios a la vez, con arrastrar y soltar); ver la ficha completa; editar los metadatos que permita `VALID_METADATA_MODIFY`; descargar; reemplazar el fichero; consultar las versiones; eliminar; y cambiar su propia contraseña. |
| Master | Crear organizaciones, listarlas y cambiar la contraseña de cualquiera de ellas. |

El token master **no pertenece a ninguna organización**, así que con él no se puede operar sobre
documentos: la interfaz lo dice de forma explícita en lugar de mostrar una bandeja vacía.

La paleta sale del logo de `public/img/logo.png` (verde `#00B85C`, negro y grises), y la interfaz
se adapta al tema claro u oscuro del sistema.

### El diseño

La interfaz no es un panel de administración con una tabla: es un **registro de custodia**. El
rasgo que distingue a Pergamo de un almacén de ficheros no es guardar, es responder de lo que
guarda —huella SHA-256, veredicto del antivirus, versiones al sobrescribir—, y eso es lo que la
pantalla pone por delante.

* **El verde del logotipo significa una cosa y solo una: custodia verificada.** No es el color de
  los botones. Las acciones van en tinta, el negro del propio logotipo. Un color que informa deja
  de informar en cuanto se usa de adorno.
* **El registro lleva la marca del veredicto en el margen**, así que el estado del fondo entero se
  lee bajando la vista por esa columna. Nunca va sola: todo lo que no está verificado lleva además
  su palabra, porque el color no puede ser el único portador de la información.
* **La ficha gasta la audacia en un solo sitio: el sello.** El SHA-256 es lo único que acredita que
  el contenido no ha cambiado desde que se depositó, así que se compone como un sello y no como
  una línea gris al fondo de una tabla. Cambia de color con el veredicto.
* **En cuarentena el botón de descarga no está deshabilitado: no está.** En su lugar hay una frase
  que dice qué pasó y qué puede hacerse. Un botón que no responde obliga a adivinar por qué.
* Tipografías auto-alojadas: **Archivo** —una grotesca pensada para impresión institucional— para
  todo el texto, e **IBM Plex Mono** solo donde la precisión carácter a carácter es funcional, que
  son las huellas y los identificadores. Ninguna petición a terceros.

### Desarrollo

```
npm run dev
```

Un solo comando: aplica las migraciones pendientes y levanta la API con recarga en caliente y la
interfaz con Vite, ya enlazadas entre sí.

| | |
|---|---|
| Interfaz | `http://127.0.0.1:3000` |
| API | `http://127.0.0.1:3001` |

La interfaz ocupa el **3000**, que es el mismo puerto que publica el contenedor. Es deliberado: el
proxy inverso apunta siempre ahí y no hay que tocarlo para cambiar de un entorno a otro, a cambio
de que solo pueda correr uno de los dos. Si el 3000 está pillado por el contenedor, el arranque lo
dice y basta con un `docker stop pergamo`.

La API se va al 3001, detrás. El proxy de Vite redirige `/organization`, `/document`, `/version` y
`/config` a ella, así que se trabaja contra datos reales; `PERGAMO_API` apunta a otro destino si
hace falta, y `PERGAMO_DEV_WEB_PORT` mueve la interfaz para levantarla con el contenedor en marcha.

Para llegar por un dominio y no por `localhost`, `PERGAMO_WEB_HOST` en el `.env`
(`pergamo.raventools.labs` en este despliegue). Hacen falta las dos cosas que configura: Vite
**bloquea** toda petición cuyo `Host` no sea `localhost` —y el proxy inverso conserva el original—,
y el websocket del HMR hay que dirigirlo al 443 del proxy en lugar de al puerto de Vite, que el
cortafuegos no deja pasar. Efecto lateral que conviene conocer: con la variable puesta, navegando
por `127.0.0.1` el HMR también se conecta al dominio público; si el navegador no lo resuelve, la
página se sirve igual y lo único que se pierde es la recarga en caliente.

Un `Ctrl+C` cierra las dos cosas. Cada proceso se lanza en su propio grupo y se mata el grupo
entero: `ts-node` y `vite` son envoltorios que lanzan a su vez el node de verdad, y una señal al
proceso directo dejaría al nieto escuchando en el puerto, con el siguiente arranque fallando por
«puerto ocupado» sin que se vea quién lo tiene.

Si un puerto está pillado o la base no responde, el arranque se detiene con el motivo y el comando
para resolverlo, en vez de dejar caer una traza de `sequelize`.

**Preparación, una sola vez:**

```
cp .env.dev.example .env
```

Después hay que rellenar `DB_PASSWORD` y crear la base de desarrollo. El propio
`.env.dev.example` lleva el SQL: un rol `pergamo_dev`, su base, y las extensiones `uuid-ossp`,
`pgcrypto` y `unaccent` creadas **por el superusuario** —no son «trusted», así que el rol de la
aplicación no puede instalarlas—. Es la misma convención que siguen las demás bases del host.

Otros comandos, por si se quieren las piezas por separado:

```
npm run dev:api    # solo la API
npm run dev:web    # solo la interfaz
npm run dev:init   # solo esquema, claves y migraciones
npm run dev:seed   # cuatro documentos de ejemplo, uno por estado de análisis
```

`dev:seed` deposita cinco documentos, uno por estado de análisis —analizado, análisis pendiente,
cuarentena por firma, cuarentena por contenido activo y sin fichero en disco—, para poder mirar las
pantallas que producen. El script sube los ficheros **por la propia API** y solo fuerza por SQL lo
que no se puede provocar desde fuera sin un ClamAV con firmas reales; el de contenido activo no se
fuerza en absoluto, lo pone el propio depósito. Se niega a correr si `DB_NAME` no acaba en `_dev`,
`_test` o `_local` (`--force` lo salta, `--clean` retira lo sembrado y `--org=<nombre>` elige otra
organización).

`PERGAMO_DEV_HOST=0.0.0.0 npm run dev` escucha en todas las interfaces, para abrir la interfaz
desde otro equipo. No basta con eso: el firewall del host tiene política `DROP` y hay que permitir
los puertos además.

### Revisión visual y recorrido en navegador

```
npm run test:e2e
```

Levanta una pila **desechable y aislada** —base de datos propia en un contenedor propio,
`DIR_DATA` en un temporal y la API en su propio puerto—, recorre la interfaz y la desmonta al
terminar. No toca ningún despliegue existente. Con `E2E_KEEP=1` la deja en pie para inspeccionarla.

El navegador va **dentro de un contenedor**: la imagen oficial de Playwright trae Chromium con
todas sus dependencias, así que el recorrido funciona en un servidor sin entorno gráfico y sin
instalar nada en la máquina. `--network host` le da acceso al servidor local. La versión de
`@playwright/test` y la etiqueta de la imagen deben coincidir; `e2e/run.sh` lo comprueba y aborta
con un mensaje claro si no es así, porque el desajuste produce errores incomprensibles.

Cada prueba afirma comportamiento **y** captura la pantalla, en claro, oscuro y móvil: las
capturas quedan en `e2e/screenshots/` y el informe en `e2e/playwright-report/`. Cualquier
excepción de JavaScript de la página tumba la prueba, que es lo que distingue revisar una interfaz
de fotografiarla: un fallo puede dejar una pantalla que se ve bien y no hace nada.

Los estados que no se pueden provocar desde fuera se fuerzan en la base de datos de prueba: sin un
ClamAV con firmas reales no hay forma de conseguir un documento en cuarentena, y la cuarentena es
justo la pantalla que más importa revisar.

El recorrido **no** está en el workflow de GitHub Actions, que hoy solo construye y publica la
imagen: añadirlo exigiría un servicio de base de datos en CI.

### Sesión y token

El token se guarda en `sessionStorage`: sobrevive a recargar la página pero no a cerrar la
pestaña. La interfaz lee la caducidad del propio JWT y cierra la sesión al vencer, y cualquier
`401` la cierra también. El JWT se decodifica en el navegador **solo** para decidir qué pintar
(menú de master, nombre, caducidad); quien decide lo que se puede hacer sigue siendo el backend,
que verifica la firma en cada petición.

### Endpoints que añade

La API no tenía forma de enumerar nada, así que una interfaz obligaba a pegar identificadores a
mano. Estos cuatro endpoints cubren ese hueco y son de solo lectura:

| Endpoint | Quién | Qué devuelve |
|---|---|---|
| `GET /document` | Organización | Listado paginado de sus documentos: `{ total, limit, offset, documents }`, con metadatos y estado de análisis —incluido `scan_engine`, que es lo que distingue un documento analizado de uno depositado sin análisis—. Filtros `name` (parcial, sin distinguir acentos), `tag` (exacta), `scan_status` (uno o varios separados por comas: `scan_status=infected,malicious`), `from` y `to` (franja inclusiva de fecha de depósito, instantes ISO), y orden por `creation_date` o `modification_date`. `limit` va de 1 a 100 (25 por defecto). Un parámetro inválido devuelve `400`, no se ignora. Con un token master devuelve `400`: no tiene organización sobre la que listar. |
| `GET /document/:id/scan` | Organización | `scan_status`, `scan_signature`, `scan_engine` y `scan_date` del documento. Va aparte de `GET /document/:id` porque el cuerpo de ese endpoint es el JSONB de metadatos tal cual, y añadirle claves rompería a quien ya lo consume. |
| `GET /organization` | Master | Listado paginado de organizaciones con `id`, `name` y fechas. Filtros `name` e `include_discharged`. La columna `password` no entra siquiera en el `SELECT`. |
| `GET /config` | Autenticado | Límites del despliegue: `enable_antivirus`, `valid_mimetype`, `valid_metadata_modify`, `max_file_size` y `max_version_file`. Permite a la interfaz validar antes de subir —y no prometer un análisis que este despliegue no hace— en lugar de duplicar la configuración. |

El aislamiento por organización se aplica igual que en el resto: el `WHERE organization` de
`GET /document` es incondicional, y `path` —la ruta en disco— no sale nunca al cliente.

## Migraciones de base de datos

`src/config/init.sql` solo se aplica en la **primera** instalación. Cualquier cambio de esquema posterior va en `src/migrations` como fichero `.sql` numerado, y lo aplica automáticamente `npm run init` en cada arranque.

* Cada migración se ejecuta dentro de su propia transacción junto con su registro en `pergamo.schema_migrations`: o se aplica entera, o no deja rastro.
* Las migraciones ya aplicadas se omiten, de modo que arrancar varias veces es seguro.
* En una base de datos anterior a este mecanismo, la migración `001_init` se marca como aplicada automáticamente (baseline) sin reejecutar `init.sql`.

Para añadir una migración, crea `src/migrations/00N_descripcion.sql`. El orden de aplicación es alfabético.

## Notas de migración desde la versión 1.0.2

Esta versión incluye correcciones de seguridad y cambios de empaquetado que **requieren acciones manuales** sobre despliegues existentes. Conviene hacer copia de seguridad de la base de datos y del volumen de datos antes de actualizar.

### 1. El arranque ahora compila (rompe el flujo anterior)

`npm start` ya no usa `ts-node`: ejecuta `dist/index.js`, así que **hay que ejecutar `npm run build` antes**. El `Dockerfile` lo hace por sí solo en una etapa de compilación separada.

Las dependencias de ejecución se han movido de `devDependencies` a `dependencies`, de modo que una instalación con `npm ci --omit=dev` ya es válida. `package-lock.json` pasa a estar versionado en git y es necesario para construir la imagen.

### 2. El contenedor deja de ejecutarse como root

La aplicación corre como el usuario `node` (uid 1000). El volumen de datos viene del host y conserva su propiedad, así que **antes de arrancar** hay que cederlo a ese usuario:

```
chown -R 1000:1000 ./data
```

Si no se hace, el contenedor se detiene en el arranque con un mensaje indicando este mismo comando, en lugar de fallar más tarde con un error de permisos opaco.

`antivirus.sh` desapareció en su día a favor de `docker-entrypoint.sh`. Este ya no arranca clamd: el escáner es un servicio propio (ver el punto 6), y el entrypoint se limita a comprobar los permisos del volumen y lanzar la aplicación como `node`.

### 3. Los tokens caducan

Los JWT se emiten con `exp` (`JWT_EXPIRES_IN`, 8 horas por defecto). Los clientes deben tratar el `401` reautenticándose contra `/organization/login`.

Los tokens emitidos **antes** de esta versión no tienen `exp` y siguen siendo válidos indefinidamente. Para invalidarlos, una vez que los clientes hayan rotado, hay que rechazar en `verifyToken` los tokens sin ese claim; es un segundo paso pendiente y planificado aparte.

Cambiar la contraseña sigue sin invalidar los tokens ya emitidos.

### 4. Clave privada existente

Las claves nuevas se crean con permisos restringidos (`0600` el fichero, `0700` el directorio). Sobre una instalación existente hay que aplicarlo a mano:

```
chmod 700 <DIR_DATA>/.key && chmod 600 <DIR_DATA>/.key/private-key.pem
```

### 5. Clave foránea entre documentos y organizaciones

La migración `002_document_organization_fk` añade la integridad referencial que faltaba. **Si existen documentos que apuntan a organizaciones inexistentes, la migración se detiene sin aplicar nada** y muestra la consulta para localizarlos. Hay que resolver esos registros y volver a arrancar. Para comprobarlo por adelantado:

```sql
SELECT DISTINCT organization FROM pergamo.document d
WHERE NOT EXISTS (SELECT 1 FROM pergamo.organization o WHERE o.id = d.organization);
```

En una tabla `document` grande, añadir la restricción toma un bloqueo exclusivo breve mientras se validan las filas; conviene aplicarlo en ventana de mantenimiento. La alternativa para tablas muy grandes es dividirla en `ADD CONSTRAINT ... NOT VALID` y `VALIDATE CONSTRAINT`, que usa un bloqueo más débil.

### 6. ClamAV pasa a ser un servicio propio (acción obligatoria)

La imagen de la aplicación **ya no incluye ClamAV**, y el `docker-entrypoint.sh` ya no arranca clamd ni freshclam. El escáner es ahora el servicio `clamav` de `docker-compose.yml`.

Antes de actualizar:

* Define `CLAMAV_HOST` y `CLAMAV_PORT` (o `CLAMAV_SOCKET`) en tu `.env`. **Con `ENABLE_ANTIVIRUS` activo y sin ninguno de los dos, el arranque falla**: es deliberado, porque la configuración anterior ejecutaba el binario local y no podía hablar con un clamd remoto.
* Revisa el valor de `ENABLE_ANTIVIRUS`. Antes se exigía el literal exacto `true`; un `True`, `TRUE`, `1` o `yes` desactivaba el antivirus en silencio. Ahora esos valores funcionan, y **un valor no reconocido detiene el arranque**. Si tu despliegue llevaba tiempo sin analizar nada sin saberlo, al actualizar empezará a hacerlo.
* Si despliegas el contenedor suelto, sin compose, necesitas levantar clamd por tu cuenta y apuntarle con `CLAMAV_HOST`.

La aplicación ahora **espera a poder hablar con clamd antes de escuchar**, y si no lo consigue tras `CLAMAV_INIT_RETRIES` intentos termina con código 1 en lugar de aceptar tráfico sin escáner.

### 7. Estado de análisis por documento (migración `003`)

Añade `scan_status`, `scan_signature`, `scan_engine` y `scan_date` a `pergamo.document`, y bloquea con `423` la descarga de todo lo que no esté `clean`.

**El corpus existente se marca `clean` con `scan_engine` nulo.** Marcarlo `pending` bloquearía de golpe todas las descargas de una instalación en producción. La contrapartida es explícita: esos documentos siguen siendo descargables sin haber sido verificados por el nuevo mecanismo. `scan_engine IS NULL` es justamente la cola de trabajo del reescaneo, así que **ejecuta `npm run rescan` cuanto antes tras migrar**.

### 8. Cambios de comportamiento de la API

| Cambio | Efecto |
|---|---|
| `POST /organization/master/create` valida la robustez de la contraseña | Crear una organización con contraseña débil devuelve `400`. La contraseña maestra debe cumplir la política si se usa también para organizaciones. |
| Endpoints de credenciales con límite de intentos | Superar el límite devuelve `429`. Los entornos de prueba deben elevar `RATE_LIMIT_MAX`. |
| Verificación del contenido del fichero | Un fichero cuyo contenido no corresponde al mimetype declarado devuelve `400`, aunque la cabecera `Content-Type` sea válida. |
| Límite de tamaño de subida | Superar `MAX_FILE_SIZE` devuelve `413`. |
| Valores de metadatos validados | Cadenas de más de 1024 caracteres, arrays de más de 64 elementos o estructuras anidadas devuelven `400`. |
| `REMOVE_FILE_DISK` | Antes se ignoraba y los ficheros se borraban siempre. Ahora `false` los conserva de verdad: **revisa el valor en tu `.env` antes de desplegar**. |
| Descarga de documentos no verificados | `GET /document/:id/file` devuelve `423` si el documento no está `clean`. `GET /document/:id` sigue devolviendo `200`. |
| Mimetype sin firma de contenido | Antes se aceptaba con un `log.warn`. Ahora devuelve `400`: **ampliar `VALID_MIMETYPE` exige añadir la firma en `src/utils/filetype.ts`**. |
| `PUT /document/:id/file` sobre un id ajeno | Antes se analizaba el fichero *antes* de comprobar la propiedad, así que un tenant podía forzar análisis de 50 MB contra ids ajenos. Ahora el `404` llega primero. |
| `Content-Disposition` | El nombre viaja entrecomillado y con escape, más `filename*` en UTF-8 (RFC 5987). Un cliente que parseara la cabecera sin comillas debe adaptarse. |
| `X-Content-Type-Options: nosniff` | Presente en todas las respuestas. |

### 9. Pendiente

* Decidir sobre los índices de `init.sql` para hash y descripción: no los usa ninguna consulta. El de etiquetas (`idx_document_metadata_tags`) sí lo aprovecha ya el filtro `tag` de `GET /document`; la búsqueda por nombre, en cambio, es un `ILIKE '%…%'` que ningún índice B-tree puede servir.
* Aviso `uuid <11.1.1` en `npm audit`: no afecta a este proyecto (requiere pasar `buf` a v3/v5/v6, y aquí solo se usa `v4()` sin ese argumento). Corregirlo exige un salto mayor de versión en `sequelize`.

## Pruebas

```
npm test
```

Las pruebas son de **integración**: levantan la aplicación real y necesitan

* una instancia de PostgreSQL accesible, ya inicializada con `npm run init`;
* un demonio ClamAV alcanzable en `CLAMAV_HOST`/`CLAMAV_PORT` si `ENABLE_ANTIVIRUS` está activo;
* `RATE_LIMIT_MAX` suficientemente alto para no toparse con el límite de intentos;
* `USER_MASTER` distinto del nombre de la organización `pergamo`, y `PASSWORD_MASTER` **entrecomillado** en el `.env` si contiene `#` (dotenv trataría el resto de la línea como comentario).

Cada suite abre su propio puerto libre, pero **corren en serie** (`maxWorkers: 1` en
`jest.config.js`): todas hablan con la misma base de datos y con la misma organización `pergamo`, a
la que `01-organization.test.ts` le cambia la contraseña a mitad de recorrido. En paralelo,
cualquier otra suite que entrase en esa ventana recibía un `401` que no tenía nada que ver con lo
que estaba probando. La batería entera baja de cinco segundos, así que el paralelismo no compraba
nada.

* `test/02-document.test.ts` — ciclo de vida del documento, detección de virus, preservación byte a byte de un PDF firmado y análisis hasta `MAX_FILE_SIZE`.
* `test/03-isolation.test.ts` — aislamiento entre organizaciones, rechazo de tokens manipulados y validaciones de fichero y metadatos.
* `test/04-quarantine.test.ts` — bloqueo de descarga con `423`, acceso a metadatos en cuarentena y cabeceras de respuesta.
* `test/05-listing.test.ts` — listados de documentos y organizaciones: filtros, paginación, rechazo de parámetros inválidos, aislamiento entre organizaciones y que el hash de contraseña no se expone.
* `test/06-payloads.test.ts` — corpus de PDF con contenido activo (`test/assets/payloads/`): dónde está el límite de cada capa, que la cuarentena por contenido activo retiene sin rechazar el depósito y solo se levanta a mano, y que lo que se almacena se entrega siempre como adjunto y byte a byte.

Las pruebas que necesitan un veredicto real del escáner usan `it.skip` cuando el antivirus está desactivado, de modo que Jest **las reporta como omitidas**. Antes iban envueltas en un `if`, que desaparecía del informe y daba la impresión de una cobertura inexistente.

## Antivirus y cuarentena

### Qué cubre y qué no

ClamAV está basado en firmas, así que su rendimiento sobre muestras nuevas o dirigidas es modesto y ningún ajuste de configuración cambia eso. Lo que sí cubre bien es el **payload ejecutable embebido** (`/EmbeddedFile` con .exe/.lnk, `/Launch`): descomprime los flujos del PDF y analiza los objetos de dentro.

Lo que ningún motor resuelve por sí solo es que **se analizaba una sola vez, en la subida**. Un fichero limpio hoy puede tener firma dentro de tres días. De ahí el estado de análisis por documento y el reescaneo del corpus.

**Medido, no supuesto.** `test/assets/payloads/` es el corpus de [PayloadsAllThePDFs](https://github.com/luigigubello/PayloadsAllThePDFs): once PDF estructuralmente válidos con JavaScript, anotaciones, URI `data:` y formularios dentro. De los once, ClamAV 1.4.3 (firmas 28116, septiembre de 2026) reconoce **uno**: `payload1.pdf`. Ninguna casilla de `clamd.conf` cambia eso: un `/OpenAction` con `app.alert()` no es código malicioso conocido, es un PDF haciendo lo que el formato permite. Esa medida es la que motivó la segunda capa —**contenido activo**, más abajo—, que retiene nueve de los diez restantes; el que se escapa de las dos, `payload8.pdf`, también está en las pruebas. `test/06-payloads.test.ts` fija los tres hechos por escrito en lugar de dejarlos en una expectativa cómoda.

Lo que sí depende de Pergamo es no convertirse en el visor: el contenido activo es inocuo mientras nadie lo renderice. Pergamo nunca abre los documentos que almacena: lee 128 bytes de cabecera, calcula un SHA-256 por streaming y mueve el fichero. No hay parser de PDF ni motor de JavaScript en el proceso. El riesgo que se gestiona no es la ejecución local, sino que Pergamo es un **punto de distribución**: lo que entra se sirve después con el aval implícito de la organización.

### Estado de análisis por documento

Cada documento lleva `scan_status`, `scan_signature`, `scan_engine` y `scan_date` en **columnas dedicadas**. No van en el JSONB `metadata` a propósito: `metadata` es modificable por el cliente mediante `modifyMetadata`, cuya allowlist `VALID_METADATA_MODIFY` es configurable por entorno; si el estado viviera ahí, añadir esa clave por descuido permitiría a un cliente auto-liberarse de la cuarentena.

| Estado | Significado | Descarga |
|---|---|---|
| `clean` | Analizado y aprobado (o antivirus desactivado por configuración: ver abajo). | Permitida |
| `pending` | No hay veredicto todavía: el antivirus estaba habilitado pero no disponible en la subida, o un reescaneo no llegó a completarse sobre ese fichero. Se reintenta solo en el siguiente barrido. | Permitida |
| `infected` | Una firma lo señaló, en la subida o en un reescaneo posterior. | **423** |
| `error` | El fichero no está en disco (`scan_signature` = `FILE_MISSING`). Es el **único** caso que lo produce: no es un análisis pendiente, es un documento roto, y un reescaneo no lo arregla. | **423** |
| `malicious` | El documento lleva contenido activo: JavaScript, acciones al abrir, ficheros embebidos. Lo decide Pergamo, no el escáner, y **no lo levanta un reescaneo** —solo una liberación manual—. | **423** |

**`clean` no siempre quiere decir «analizado».** Con `ENABLE_ANTIVIRUS` desactivado no hay intención de verificar, así que la subida se guarda como `clean` con **`scan_engine` nulo**; marcarla `pending` dejaría el despliegue sin descargas y sin salida, porque el reescaneo tampoco puede correr sin escáner. `scan_engine` es entonces la única columna que separa un documento aprobado por un motor de uno que nadie miró, y por eso viaja también en el listado (`GET /document`) y `GET /config` publica `enable_antivirus`.

La interfaz usa exactamente esa distinción: un `clean` con motor se llama «Analizado» (verde), y uno sin motor, «Sin analizar», en gris y con la explicación al lado —se entrega, pero nadie ha verificado su contenido—. No comparte palabra con `pending`, que es «Análisis pendiente» y **no** se entrega. Cualquier otro consumidor de la API debería mirar las dos columnas por el mismo motivo: llamar analizado a lo que no lo está es precisamente la afirmación que un archivo no puede permitirse.

El bloqueo se aplica en `GET /document/:id/file` y **no** en `GET /document/:id`: los metadatos de un documento en cuarentena siguen siendo consultables, porque es como el cliente descubre por qué está bloqueado.

**Qué retiene y qué no.** El `423` lo disparan `infected`, `malicious` y `error`, y solo esos tres: son los que exigen que alguien intervenga —revisar una firma, revisar contenido activo, buscar un fichero que falta— y ninguno se arregla esperando. `pending` **se entrega**.

Es una decisión con su coste, y conviene verlo escrito: un documento `pending` es contenido que se pretendía verificar y no se verificó, y aun así sale del archivo. A cambio, una caída de clamd deja de convertir el archivo en un almacén que no entrega nada, y el coste de esa caída no recae sobre depósitos que en su inmensa mayoría no tienen nada y cuyos autores no hicieron nada mal. El estado no se esconde: la interfaz lo llama «Análisis pendiente» y lo explica en la ficha, y el siguiente barrido lo resuelve sin que nadie tenga que intervenir.

**Política ante escáner no disponible**: la subida se acepta, se entrega y queda `pending`, en la cola del próximo reescaneo.

`pending` y `error` no significan lo mismo y por eso no se han fundido nunca: `pending` se resuelve solo —queda en la cola de reescaneo con `scan_engine` nulo—, mientras que `error` sale de esa cola y exige que alguien mire por qué falta el fichero. De ahí que uno se entregue y el otro no.

Por el mismo motivo la interfaz **no llama cuarentena a `error`**. «En cuarentena» agrupa `infected` y `malicious`, que son documentos íntegros y retenidos a la espera de una decisión sobre su contenido; `error` es un fichero que falta del almacén, se muestra y se filtra como **Error**, y a quien le toca mirarlo es a quien administra el despliegue, no a quien revisa documentos.

### Contenido activo

ClamAV responde a «¿es esto malware conocido?». Un fondo documental tiene además otra pregunta —«¿qué le hace este fichero al programa con el que se abra?»— y esa no tiene firma: un `/OpenAction` que ejecuta JavaScript es el formato haciendo lo que el formato permite. La medida está arriba: de los once PDF de `test/assets/payloads/`, ClamAV reconoce uno.

`src/utils/activecontent.ts` es la capa que cubre esa pregunta. Busca marcadores estructurales sobre los bytes del fichero **y sobre los flujos Flate descomprimidos**, que es donde acaba escondiéndose casi todo:

| Regla | Qué marca |
|---|---|
| `JavaScript` | `/JavaScript`, `/JS` |
| `OpenAction` | acción disparada al abrir el documento |
| `AdditionalAction` | `/AA` en páginas, campos o anotaciones |
| `Launch` | lanzamiento de una aplicación externa |
| `EmbeddedFile` | ficheros embebidos dentro del documento |
| `RichMedia` | contenido multimedia ejecutable |
| `RemoteGoTo` | `/GoToR`, `/GoToE`: salto a otro fichero |
| `SubmitForm` | envío o importación de datos de formulario |
| `XFA` | formulario XFA, con su propia lógica |
| `JavaScriptURI` | URI con esquema `javascript:` |

**Política**: a diferencia de una firma antivírica, el contenido activo **no rechaza la subida**. El documento se deposita y queda en `malicious`: se guarda, no se entrega, y de ahí solo sale por `npm run scan:release -- <id>`. En un archivo, el depósito no se pierde; lo que se retiene es la entrega. `npm run rescan` excluye esas filas de forma explícita —un barrido las encontraría limpias y liberaría en lote justo lo que se decidió retener— y avisa al terminar de cuántas hay.

**Lo que no cubre**, escrito aquí para que su ausencia no se lea como una garantía:

* No hay parser de PDF en el proceso, y es deliberado: un parser en la ruta de subida es superficie de ataque. `payload8.pdf` del corpus inyecta su código en un array `/FontMatrix`, sin `/JavaScript` ni `/OpenAction`, y no lo detecta ni ClamAV ni este filtro.
* Un fichero preparado para esquivarlo lo esquiva. Es un **filtro de contenido activo, no un veredicto de seguridad**.
* Solo mira PDF. Un ODT con macros pasa sin marca.
* Lo que exceda los límites de descompresión (8 MB por flujo, 64 MB en total) no se examina.

**Falsos positivos, que aquí son caros**: un PDF firmado lleva ficheros embebidos por norma —PAdES-LTV embebe respuestas OCSP y CRLs; Factur-X embebe el XML de la factura—, así que un archivo de documentos firmados los retendría todos al depositarlos. `MALICIOUS_ACTIVE_CONTENT_IGNORE` desactiva reglas concretas por nombre, separadas por `;`:

```
MALICIOUS_ACTIVE_CONTENT_IGNORE="EmbeddedFile"
```

Es el equivalente de `clamav/local.ign2` para esta capa, y se usa igual: se anota siempre por qué se ignora y quién lo decidió. Un nombre que no corresponda a ninguna regla **detiene el arranque**, en lugar de dejar un despliegue cuarentenando lo que su operador daba por exceptuado.

### Reescaneo del corpus

```
npm run rescan
```

Recorre los documentos cuyo `scan_engine` es nulo o distinto del actual y actualiza su estado. Conviene ejecutarlo tras cada actualización de firmas.

**Este proceso marca; nunca borra.** La garantía es estructural: `src/utils/antivirus.ts` fija `removeInfected` en `false`, de modo que ClamAV no puede eliminar del archivo un documento por un falso positivo. En un archivo, corromper en silencio un documento válido es peor defecto que dejar pasar un virus.

### Falsos positivos

```
npm run scan:release -- <id-documento>
```

Pasa el documento a `clean` **conservando `scan_signature`**, de modo que el falso positivo queda trazado. El fichero no se modifica en ningún momento: los falsos positivos se **liberan** mediante revisión, no se "arreglan" alterando el documento.

Si una misma firma reincide sobre documentos legítimos, se añade a `clamav/local.ign2` y se reinicia el servicio `clamav`.

> **Por qué no hay saneado automático de PDF (CDR).** Se evaluó y se descartó. Reescribir un PDF para eliminar JavaScript, `/OpenAction`, `/Launch` o ficheros embebidos **rompe cualquier firma electrónica**, porque una firma PAdES/PKCS#7 cubre un `ByteRange` de bytes concretos. Además, los PDF firmados contienen legítimamente lo que un CDR elimina: PAdES-LTV embebe respuestas OCSP y CRLs *como ficheros embebidos*. Y el fallo sería silencioso: un rechazo por falso positivo devuelve 400 y el cliente reclama; una sanitización devuelve 200 y un fichero aparentemente correcto, cuyo daño se descubre meses después. Por último, rompería `metadata.hash`, que es la identidad de registro del documento.
>
> El principio que lo sustituye: **la integridad del byte original es un requisito, no una preferencia**. Todo control que no pueda cumplirse sin modificar el documento se convierte en una decisión de cuarentena, no en una transformación. La prueba `Should preserve a signed PDF byte for byte` es la regresión que lo vigila.

### Fichero de prueba

```
X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*
```

Ha de subirse **exacto**: la firma de ClamAV para EICAR es un hash del fichero completo, así que cualquier byte añadido la anula. Para probar la detección dentro de un fichero grande hay que embeberlo como una entrada de un archivo comprimido, que es lo que hace la prueba del límite de tamaño.

EICAR responde a «¿llega el fichero al motor?», que es una pregunta distinta de «¿sirve el motor para esto?». Para la segunda está el corpus de `test/assets/payloads/` (ver su `README.md`), con el detalle de qué reconoce ClamAV en cada fichero y por qué diez de los once no le corresponden. Aviso al clonar: `payload1.pdf` tiene firma, y un antivirus con vigilancia en tiempo real puede llevárselo del directorio de trabajo.

## Licencia

El proyecto se distribuye bajo la licencia indicada en el fichero LICENSE.
