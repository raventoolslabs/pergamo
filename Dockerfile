# Etapa de compilacion: produce dist/ a partir del codigo TypeScript.
# Version exacta para que el build sea reproducible (fija tambien la release de
# Alpine, y con ella el conjunto de paquetes apk disponibles).
FROM node:24.20.0-alpine AS build

WORKDIR /usr/src/app

COPY package.json package-lock.json ./
RUN npm ci

# Las dependencias de la interfaz se instalan antes de copiar su codigo: asi un
# cambio en web/src no invalida la capa de npm ci, que es la cara.
COPY web/package.json web/package-lock.json ./web/
RUN npm --prefix web ci

COPY tsconfig.json ./
COPY src ./src
# El logo y los favicons: Vite los toma de aqui (publicDir) y los deja en el
# build de la interfaz.
COPY public ./public
COPY web ./web
RUN npm run build

# Etapa final: solo dependencias de produccion y el JavaScript ya compilado.
FROM node:24.20.0-alpine

WORKDIR /usr/src/app

# su-exec: permite lanzar la aplicacion con su propio usuario desde el
# entrypoint, de modo que no quede corriendo como root.
#
# ClamAV no vive en esta imagen. Corria en el mismo contenedor y cgroup que la
# API, con ~1-1.5 GB residentes: un OOM del escaner tumbaba el servicio. Ahora
# es el clamav-daemon del host, al que la aplicacion habla por su socket unix
# (/run/clamav, que monta docker/docker-compose.yml).
RUN apk add --no-cache su-exec

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# dist incluye tanto el JavaScript de la API como la interfaz compilada en
# dist/web, que Express sirve en el mismo puerto.
COPY --from=build /usr/src/app/dist ./dist
COPY docker-entrypoint.sh ./

# El usuario 'node' (uid 1000) ya existe en la imagen base; solo se le da
# propiedad del codigo. No hace falta el grupo clamav: el socket de clamd se
# abre con LocalSocketMode 666.
RUN chmod +x docker-entrypoint.sh && \
    chown -R node:node /usr/src/app

EXPOSE 3000

# Activa el modo produccion de Express y hace que el logger emita JSON
# estructurado en lugar del formato legible de desarrollo.
ENV NODE_ENV=production

ENTRYPOINT ["./docker-entrypoint.sh"]
