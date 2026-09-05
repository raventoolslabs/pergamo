#!/bin/sh
set -e

# Arranca cada proceso con el usuario minimo que necesita: clamd y freshclam
# como 'clamav', la aplicacion como 'node'. Ningun proceso queda como root.

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

if [ "$ENABLE_ANTIVIRUS" = "true" ]; then
  su-exec clamav freshclam || echo "AVISO: freshclam no actualizo las firmas; se usaran las ya presentes"
  su-exec clamav freshclam -d
  su-exec clamav clamd
fi

su-exec node node dist/init.js

exec su-exec node node dist/index.js
