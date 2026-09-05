# Etapa de compilacion: produce dist/ a partir del codigo TypeScript.
# Version exacta para que el build sea reproducible (fija tambien la release de
# Alpine, y con ella el conjunto de paquetes apk disponibles).
FROM node:20.20.2-alpine AS build

WORKDIR /usr/src/app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Etapa final: solo dependencias de produccion y el JavaScript ya compilado.
FROM node:20.20.2-alpine

WORKDIR /usr/src/app

# clamav: motor antivirus. su-exec: permite lanzar cada proceso con su propio
# usuario desde el entrypoint, de modo que ninguno quede corriendo como root.
# TODO: fijar la version de clamav (apk add clamav=<version>) con la version
# disponible para la release de Alpine de la imagen base.
RUN apk add --no-cache clamav su-exec && \
    mkdir -p /run/clamav && \
    chown clamav:clamav /run/clamav /var/lib/clamav

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /usr/src/app/dist ./dist
COPY docker-entrypoint.sh ./

# El usuario 'node' (uid 1000) ya existe en la imagen base. Se le da propiedad
# del codigo y se le anade al grupo clamav para poder usar el socket de clamd.
RUN chmod +x docker-entrypoint.sh && \
    chown -R node:node /usr/src/app && \
    addgroup node clamav

EXPOSE 3000

# Activa el modo produccion de Express y hace que el logger emita JSON
# estructurado en lugar del formato legible de desarrollo.
ENV NODE_ENV=production

ENTRYPOINT ["./docker-entrypoint.sh"]
