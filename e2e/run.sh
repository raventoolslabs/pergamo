#!/usr/bin/env bash
#
# Recorrido en navegador de la interfaz de Pergamo.
#
# Este equipo no tiene entorno grafico ni las librerias que Chromium necesita, y
# tampoco sudo para instalarlas, asi que el navegador va dentro de la imagen
# oficial de Playwright. Con --network host ve el servidor que se levanta aqui.
#
# Toda la pila es DESECHABLE y AISLADA: base de datos propia en un contenedor
# propio, DIR_DATA en un temporal y la API en su propio puerto. No toca ningun
# despliegue existente, y el trap lo desmonta todo pase lo que pase.
#
# Uso:  npm run test:e2e            recorrido completo
#       npm run test:e2e -- --ui    (no aplica: no hay entorno grafico)
#       E2E_KEEP=1 npm run test:e2e deja la pila en pie para inspeccionarla

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# La etiqueta de la imagen y la version del paquete deben ir a la par. Un
# desajuste produce errores incomprensibles dentro del contenedor, asi que se
# comprueba antes de arrancar nada.
PLAYWRIGHT_VERSION="1.63.0"
IMAGE="mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble"

DB_CONTAINER="pergamo-e2e-db"
DB_PORT="${E2E_DB_PORT:-55432}"
DB_USER="pergamo"
DB_PASSWORD="pergamotest"
DB_NAME="pergamo_test"

REDIS_CONTAINER="pergamo-e2e-redis"
REDIS_PORT="${E2E_REDIS_PORT:-56379}"

APP_PORT="${E2E_APP_PORT:-3999}"
APP_URL="http://127.0.0.1:${APP_PORT}"

MASTER_USER="master"
MASTER_PASSWORD='Pergamo0123#'

DATA_DIR="$(mktemp -d /tmp/pergamo-e2e-XXXXXX)"
SERVER_PID=""

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
die() { printf '\n\033[1;31m!! %s\033[0m\n' "$1" >&2; exit 1; }

cleanup() {
  local status=$?

  if [ -n "${E2E_KEEP:-}" ]; then
    say "E2E_KEEP: la pila sigue en pie en ${APP_URL} (base de datos en el puerto ${DB_PORT})"
    printf '    para desmontarla: docker rm -f %s %s; kill %s; rm -rf %s\n' "$DB_CONTAINER" "$REDIS_CONTAINER" "$SERVER_PID" "$DATA_DIR"
    return $status
  fi

  say 'Desmontando la pila de prueba'
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
  docker rm -f "$DB_CONTAINER" "$REDIS_CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$DATA_DIR"

  return $status
}
trap cleanup EXIT

# --- comprobaciones previas -------------------------------------------------

command -v docker >/dev/null || die 'Hace falta docker: el navegador corre dentro de un contenedor.'

declared="$(node -pe "require('./e2e/package.json').devDependencies['@playwright/test']")"
[ "$declared" = "$PLAYWRIGHT_VERSION" ] || die \
  "Desajuste de version: e2e/package.json declara @playwright/test ${declared} y este script usa la imagen ${IMAGE}. Deben coincidir."

if curl -sf --max-time 2 "${APP_URL}/version" >/dev/null 2>&1; then
  die "Ya hay algo escuchando en ${APP_URL}. Parese o use E2E_APP_PORT para elegir otro puerto."
fi

# --- base de datos desechable -----------------------------------------------

# Con pgvector y no la imagen oficial: la migracion 005 lo exige, y aqui el rol
# de la aplicacion ES el superusuario del contenedor, asi que la crea sola.
say "Levantando la base de datos de prueba (${DB_CONTAINER})"
docker rm -f "$DB_CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$DB_CONTAINER" \
  -e POSTGRES_USER="$DB_USER" \
  -e POSTGRES_PASSWORD="$DB_PASSWORD" \
  -e POSTGRES_DB="$DB_NAME" \
  -p "127.0.0.1:${DB_PORT}:5432" \
  pgvector/pgvector:0.8.6-pg18-trixie >/dev/null

for _ in $(seq 1 60); do
  docker exec "$DB_CONTAINER" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$DB_CONTAINER" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1 \
  || die 'La base de datos de prueba no ha llegado a estar lista.'

# Solo con E2E_INDEXING: el recorrido corto no necesita cola, y levantar un
# Redis que nadie usa alarga cada ejecucion sin comprobar nada.
#
# La maquina de inferencia NO se simula: si se pide indexar de verdad, hay que
# decir contra que. Un proveedor de mentira probaria el cableado, y de eso ya se
# ocupan test/10-indexing y test/12-queue.
if [ -n "${E2E_INDEXING:-}" ]; then

  [ -n "${EMBEDDING_BASE_URL:-}" ] || die \
    'E2E_INDEXING necesita EMBEDDING_BASE_URL: es la maquina de inferencia contra la que indexar. Ej.: EMBEDDING_BASE_URL=http://maquina-ia:11434/v1 E2E_INDEXING=1 npm run test:e2e'

  say "Levantando Redis de prueba (${REDIS_CONTAINER})"
  docker rm -f "$REDIS_CONTAINER" >/dev/null 2>&1 || true
  docker run -d --name "$REDIS_CONTAINER" \
    -p "127.0.0.1:${REDIS_PORT}:6379" \
    redis:7-alpine redis-server --save '' --appendonly no >/dev/null

  for _ in $(seq 1 30); do
    docker exec "$REDIS_CONTAINER" redis-cli ping >/dev/null 2>&1 && break
    sleep 1
  done
  docker exec "$REDIS_CONTAINER" redis-cli ping >/dev/null 2>&1 \
    || die 'El Redis de prueba no ha llegado a estar listo.'

  export REDIS_URL="redis://127.0.0.1:${REDIS_PORT}"
  # La pila de prueba es un solo proceso, asi que el worker va dentro. Se exporta
  # y no se deja al defecto porque el `.env` de quien lanza esto puede llevarlo a
  # 'false' —lo normal si tiene un worker suelto—, y entonces los documentos se
  # quedarian en 'pending' sin que nada lo explique.
  export INDEXING_WORKER_EMBEDDED=true
  export EMBEDDING_BASE_URL
  export EMBEDDING_MODEL="${EMBEDDING_MODEL:-bge-m3}"
  export EMBEDDING_DIMENSION="${EMBEDDING_DIMENSION:-1024}"
fi

# --- entorno de la aplicacion -----------------------------------------------
#
# Sin antivirus: no hace falta clamd para revisar la interfaz, y los estados de
# cuarentena se fuerzan por SQL desde las propias pruebas.
#
# El limite de intentos va alto a proposito: el recorrido entra y cambia
# contrasenas varias veces, y con el valor de produccion (10 por IP) se toparia
# con un 429 a mitad de camino.

export DIR_DATA="$DATA_DIR"
export PORT="$APP_PORT"
export DB_USERNAME="$DB_USER"
export DB_PASSWORD="$DB_PASSWORD"
export DB_HOST=127.0.0.1
export DB_PORT="$DB_PORT"
export DB_NAME="$DB_NAME"
export DB_SSL=false
export DEBUG=false
export ENABLE_ANTIVIRUS=false
# La suite corta no depende de la maquina de inferencia. E2E_INDEXING=1 la
# activa para el recorrido que si la necesita.
export INDEXING_ENABLED="${E2E_INDEXING:+true}"
export INDEXING_ENABLED="${INDEXING_ENABLED:-false}"
export REMOVE_FILE_DISK=true
export JWT_EXPIRES_IN=8h
export TRUST_PROXY=0
export RATE_LIMIT_WINDOW_MS=900000
export RATE_LIMIT_MAX=500
export VALID_METADATA_MODIFY="name; description; tags"
export VALID_MIMETYPE="application/pdf;application/rtf;application/epub+zip;application/vnd.oasis.opendocument.text;application/vnd.oasis.opendocument.spreadsheet;application/vnd.oasis.opendocument.presentation;application/vnd.openxmlformats-officedocument.wordprocessingml.document;application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;application/vnd.openxmlformats-officedocument.presentationml.presentation"
export MAX_VERSION_FILES=3
export MAX_FILE_SIZE=52428800
export USER_MASTER="$MASTER_USER"
export PASSWORD_MASTER="$MASTER_PASSWORD"

say 'Compilando la API y la interfaz'
npm run build >/dev/null

say 'Creando el esquema y la organizacion inicial'
npm run init >/dev/null

say "Arrancando Pergamo en ${APP_URL}"
node dist/index.js > "${DATA_DIR}/server.log" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 40); do
  curl -sf --max-time 2 "${APP_URL}/version" >/dev/null 2>&1 && break
  sleep 0.5
done
curl -sf --max-time 2 "${APP_URL}/version" >/dev/null 2>&1 \
  || { cat "${DATA_DIR}/server.log"; die 'La aplicacion no ha llegado a responder.'; }

# --- dependencias del recorrido ---------------------------------------------
#
# Se instalan en el host SIN navegadores: los trae la imagen, y descargarlos
# aqui seria inutil porque a este equipo le faltan las librerias para ejecutarlos.

if [ ! -d e2e/node_modules ]; then
  say 'Instalando las dependencias del recorrido'
  if [ -f e2e/package-lock.json ]; then
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm --prefix e2e ci >/dev/null
  else
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm --prefix e2e install >/dev/null
  fi
fi

# --- recorrido ---------------------------------------------------------------

say "Ejecutando el recorrido en ${IMAGE}"

# --user con el uid del host: de lo contrario las capturas y el informe quedan
# como root y no hay forma de borrarlos sin sudo.
docker run --rm --network host \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  -e PERGAMO_URL="$APP_URL" \
  -e PERGAMO_DB_PORT="$DB_PORT" \
  -e PERGAMO_MASTER="$MASTER_USER" \
  -e PERGAMO_INDEXING="${E2E_INDEXING:-}" \
  -e PERGAMO_PASSWORD="$MASTER_PASSWORD" \
  -e CI=1 \
  -v "${ROOT}/e2e:/e2e" \
  -v "${ROOT}/test/assets:/repo/test/assets:ro" \
  -w /e2e \
  "$IMAGE" npx playwright test "$@"

say "Capturas en e2e/screenshots/ e informe en e2e/playwright-report/"
