# Pergamo

Pergamo es una API HTTP de gestión documental multi-organización. Cada organización (tenant) se autentica, sube documentos, los versiona, los etiqueta con metadatos y los descarga, con aislamiento entre organizaciones aplicado en cada consulta. Los ficheros subidos se analizan con ClamAV antes de almacenarse, y el corpus almacenado se reanaliza cuando avanzan las firmas.

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
* `clamav` — configuración del demonio ClamAV (`clamd.conf`) y lista local de firmas ignoradas.
* `test` — pruebas de integración.

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
npm run build     # genera dist/ y copia init.sql y las migraciones
npm run init      # crea esquema, organización inicial y claves; aplica migraciones
npm start         # ejecuta dist/index.js

npm run rescan               # reanaliza el corpus con las firmas actuales
npm run scan:release -- <id> # libera un falso positivo de la cuarentena
```

Para desarrollo, `npm run dev` ejecuta el código sin compilar mediante ts-node.

### Despliegue con Docker

`docker compose up --build` levanta la pila completa: **postgres**, **clamav** y **pergamo**. Antes el `docker-compose.yml` declaraba un único servicio, con ClamAV dentro del contenedor de la API y sin base de datos, así que no levantaba nada usable por sí solo.

| Servicio | Papel |
|---|---|
| `postgres` | Base de datos, con volumen propio y `healthcheck`. |
| `clamav` | Demonio de análisis, imagen oficial con versión fijada, volumen propio para las firmas y `healthcheck` real contra el puerto 3310. Su puerto **no** se publica al host. |
| `pergamo` | La API. No arranca hasta que los dos anteriores están sanos. |

ClamAV vive ahora en su propio contenedor por tres motivos: aísla su ~1–1,5 GB residentes del cgroup de la API (antes un OOM del escáner tumbaba el servicio), permite un healthcheck de verdad, y saca la lógica de arranque de clamd del `docker-entrypoint.sh`. La aplicación le habla por TCP y espera a poder hacerlo **antes** de escuchar: la ventana en la que cada subida devolvía un `500` opaco mientras clamd cargaba firmas ya no existe.

La imagen de la aplicación ejecuta el proceso como usuario `node`: **no corre como root**.

Los límites de `clamav/clamd.conf` (`MaxFileSize`, `MaxScanSize`, `StreamMaxLength`) deben ser siempre mayores o iguales que `MAX_FILE_SIZE`. Están en dos ficheros distintos, así que la prueba `Should scan a file up to MAX_FILE_SIZE` existe precisamente para detectar que se han desalineado. `AlertExceedsMax yes` hace que lo que no se pueda analizar se **señale** en lugar de aprobarse, que es el comportamiento contrario al de ClamAV por defecto.

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

* Decidir sobre los índices de `init.sql` para hash, descripción y etiquetas: no los usa ninguna consulta actual, a la espera de una funcionalidad de búsqueda.
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

Cada suite abre su propio puerto libre, así que pueden ejecutarse en paralelo.

* `test/02-document.test.ts` — ciclo de vida del documento, detección de virus, preservación byte a byte de un PDF firmado y análisis hasta `MAX_FILE_SIZE`.
* `test/03-isolation.test.ts` — aislamiento entre organizaciones, rechazo de tokens manipulados y validaciones de fichero y metadatos.
* `test/04-quarantine.test.ts` — bloqueo de descarga con `423`, acceso a metadatos en cuarentena y cabeceras de respuesta.

Las pruebas que necesitan un veredicto real del escáner usan `it.skip` cuando el antivirus está desactivado, de modo que Jest **las reporta como omitidas**. Antes iban envueltas en un `if`, que desaparecía del informe y daba la impresión de una cobertura inexistente.

## Antivirus y cuarentena

### Qué cubre y qué no

ClamAV está basado en firmas, así que su rendimiento sobre muestras nuevas o dirigidas es modesto y ningún ajuste de configuración cambia eso. Lo que sí cubre bien es el **payload ejecutable embebido** (`/EmbeddedFile` con .exe/.lnk, `/Launch`): descomprime los flujos del PDF y analiza los objetos de dentro.

Lo que ningún motor resuelve por sí solo es que **se analizaba una sola vez, en la subida**. Un fichero limpio hoy puede tener firma dentro de tres días. De ahí el estado de análisis por documento y el reescaneo del corpus.

Pergamo nunca abre los documentos que almacena: lee 128 bytes de cabecera, calcula un SHA-256 por streaming y mueve el fichero. No hay parser de PDF ni motor de JavaScript en el proceso. El riesgo que se gestiona no es la ejecución local, sino que Pergamo es un **punto de distribución**: lo que entra se sirve después con el aval implícito de la organización.

### Estado de análisis por documento

Cada documento lleva `scan_status`, `scan_signature`, `scan_engine` y `scan_date` en **columnas dedicadas**. No van en el JSONB `metadata` a propósito: `metadata` es modificable por el cliente mediante `modifyMetadata`, cuya allowlist `VALID_METADATA_MODIFY` es configurable por entorno; si el estado viviera ahí, añadir esa clave por descuido permitiría a un cliente auto-liberarse de la cuarentena.

| Estado | Significado | Descarga |
|---|---|---|
| `clean` | Analizado y aprobado (o antivirus desactivado por configuración). | Permitida |
| `pending` | El antivirus estaba habilitado pero no disponible en el momento de la subida. | **423** |
| `infected` | Una firma lo señaló, en la subida o en un reescaneo posterior. | **423** |
| `error` | El análisis no pudo completarse (por ejemplo, el fichero no está en disco). | **423** |

El bloqueo se aplica en `GET /document/:id/file` y **no** en `GET /document/:id`: los metadatos de un documento en cuarentena siguen siendo consultables, porque es como el cliente descubre por qué está bloqueado.

**Política ante escáner no disponible**: la subida se acepta y el documento queda `pending`. Prioriza la disponibilidad de la subida sin llegar a servir nunca contenido que se pretendía verificar y no se verificó.

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

## Licencia

El proyecto se distribuye bajo la licencia indicada en el fichero LICENSE.
