#!/bin/sh
set -e

# Arranca la aplicacion con el usuario minimo que necesita ('node'), nunca root.
#
# Aqui ya no se lanza clamd. Antes se demonizaba y la aplicacion arrancaba
# detras sin esperar al socket: cargar las firmas lleva decenas de segundos y
# durante esa ventana cada subida devolvia un 500 opaco ('set -e' no ayudaba,
# porque cubre el exit code del fork y no el estado del demonio). Ahora clamd es
# un servicio propio con healthcheck, y la aplicacion espera a poder hablar con
# el antes de escuchar (ver src/app.ts).

DATA_DIR="${DIR_DATA:-/usr/src/app/data}"

mkdir -p "$DATA_DIR" 2>/dev/null || true

# El volumen viene del host y conserva su propiedad por uid. Si la aplicacion no
# puede escribir, se avisa aqui en vez de fallar mas tarde con un error de
# permisos opaco. No se hace chown automatico para no modificar en silencio
# ficheros del host.
if ! su-exec node test -w "$DATA_DIR"; then
  echo "ERROR: '$DATA_DIR' no es escribible por el usuario 'node' (uid 1000)."
  echo "       En el host, sobre el directorio montado como volumen, ejecuta:"
  echo "         chown -R 1000:1000 ./data"
  exit 1
fi

# El worker no aplica migraciones: las aplica la API, que es quien manda en el
# esquema. Arrancarlo antes de que lo haga daria un error claro en vez de dos
# procesos compitiendo por migrar.
if [ "${PERGAMO_ROLE:-api}" = "worker" ]; then
  exec su-exec node node dist/worker.js
fi

su-exec node node dist/init.js

exec su-exec node node dist/index.js
