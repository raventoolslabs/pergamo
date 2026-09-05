# Pergamo

Pergamo es una API HTTP de gestión documental multi-organización. Cada organización (tenant) se autentica, sube documentos, los versiona, los etiqueta con metadatos y los descarga, con aislamiento entre organizaciones aplicado en cada consulta. Los ficheros subidos se analizan con ClamAV antes de almacenarse.

Es un **servicio único** (monolito modular ejecutado en un solo proceso Node), no una arquitectura de microservicios.

## Estructura del proyecto

* `src/routes` — definición de rutas y encadenado de middleware.
* `src/controllers` — lógica de negocio de documentos y organizaciones.
* `src/models` — interfaces TypeScript de las entidades.
* `src/middleware` — autenticación JWT, manejo de errores y logging por petición.
* `src/utils` — base de datos, JWT, hashing, ficheros, tipo de fichero, antivirus, migraciones y logger.
* `src/config` — configuración por variables de entorno e `init.sql` (esquema, triggers y funciones).
* `src/migrations` — migraciones SQL versionadas (ver más abajo).
* `test` — pruebas de integración.

## Configuración

Copia `.env.example` a `.env` y ajusta los valores. La configuración **se valida al arrancar**: si falta una variable obligatoria o tiene un formato incorrecto, el proceso falla de inmediato indicando cuál.

Variables que conviene revisar antes de desplegar:

| Variable | Efecto |
|---|---|
| `JWT_EXPIRES_IN` | Caducidad de los tokens (por defecto `8h`). |
| `TRUST_PROXY` | Saltos de proxy inverso en los que confiar. **Si hay un proxy delante y vale 0, el rate limiting agrupará a todos los clientes bajo una sola IP.** |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | Intentos permitidos por IP en los endpoints de credenciales. |
| `MAX_FILE_SIZE` | Tamaño máximo por fichero subido, en bytes. |
| `DEBUG` | Nivel de log `debug`; registra metadatos completos de fichero y documento. |
| `ENABLE_ANTIVIRUS` | Análisis con ClamAV. Si no se define, el antivirus queda **desactivado**. |

## Construcción y ejecución

El código TypeScript se compila antes de ejecutarse:

```
npm install
npm run build     # genera dist/ y copia init.sql y las migraciones
npm run init      # crea esquema, organización inicial y claves; aplica migraciones
npm start         # ejecuta dist/index.js
```

Para desarrollo, `npm run dev` ejecuta el código sin compilar mediante ts-node.

Con Docker, `docker compose up --build` cubre todo el ciclo. El contenedor ejecuta ClamAV como usuario `clamav` y la aplicación como usuario `node`: **ningún proceso corre como root**.

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

`antivirus.sh` ha desaparecido: su contenido está ahora en `docker-entrypoint.sh`, que arranca cada proceso con su usuario mínimo.

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

### 6. Cambios de comportamiento de la API

| Cambio | Efecto |
|---|---|
| `POST /organization/master/create` valida la robustez de la contraseña | Crear una organización con contraseña débil devuelve `400`. La contraseña maestra debe cumplir la política si se usa también para organizaciones. |
| Endpoints de credenciales con límite de intentos | Superar el límite devuelve `429`. Los entornos de prueba deben elevar `RATE_LIMIT_MAX`. |
| Verificación del contenido del fichero | Un fichero cuyo contenido no corresponde al mimetype declarado devuelve `400`, aunque la cabecera `Content-Type` sea válida. |
| Límite de tamaño de subida | Superar `MAX_FILE_SIZE` devuelve `413`. |
| Valores de metadatos validados | Cadenas de más de 1024 caracteres, arrays de más de 64 elementos o estructuras anidadas devuelven `400`. |
| `REMOVE_FILE_DISK` | Antes se ignoraba y los ficheros se borraban siempre. Ahora `false` los conserva de verdad: **revisa el valor en tu `.env` antes de desplegar**. |

### 7. Pendiente

* Fijar la versión del paquete `clamav` en el `Dockerfile` (marcado con un `TODO`).
* Decidir sobre los índices de `init.sql` para hash, descripción y etiquetas: no los usa ninguna consulta actual, a la espera de una funcionalidad de búsqueda.
* Aviso `uuid <11.1.1` en `npm audit`: no afecta a este proyecto (requiere pasar `buf` a v3/v5/v6, y aquí solo se usa `v4()` sin ese argumento). Corregirlo exige un salto mayor de versión en `sequelize`.

## Pruebas

```
npm test
```

Las pruebas son de **integración**: levantan la aplicación real y necesitan

* una instancia de PostgreSQL accesible, ya inicializada con `npm run init`;
* un demonio ClamAV en marcha si `ENABLE_ANTIVIRUS=true` (la prueba del fichero EICAR lo requiere);
* `RATE_LIMIT_MAX` suficientemente alto para no toparse con el límite de intentos.

Cada suite abre su propio puerto libre, así que pueden ejecutarse en paralelo.

`test/03-isolation.test.ts` cubre el aislamiento entre organizaciones, el rechazo de tokens manipulados y las validaciones de fichero y metadatos.

## Antivirus

Fichero de prueba para verificar la detección:

```
X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*
```

## Licencia

El proyecto se distribuye bajo la licencia indicada en el fichero LICENSE.
