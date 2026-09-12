import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// El destino de la API en desarrollo. El 6230 y no el 6231 porque el 6231 lo
// ocupa este mismo servidor de Vite: es la puerta de entrada compartida con el
// contenedor. En produccion no hay proxy: la interfaz la sirve el propio
// Express desde dist/web, en el mismo origen que la API.
const API_TARGET = process.env.PERGAMO_API || 'http://127.0.0.1:6230';

// Host publico por el que se llega a la interfaz a traves del proxy inverso
// (en este despliegue, pergamo.raventools.labs). Vacio en local.
const WEB_HOST = process.env.PERGAMO_WEB_HOST;

const proxy = ['/organization', '/document', '/version', '/config']
  .reduce((routes, path) => ({ ...routes, [path]: { target: API_TARGET, changeOrigin: true } }), {});

export default defineConfig({
  plugins: [react()],
  // El logo y los favicons ya viven en public/ del repositorio: se reutilizan
  // tal cual en lugar de duplicarlos dentro de web/.
  publicDir: '../public',
  build: {
    // Cae junto al JavaScript compilado de la API para que una sola imagen
    // sirva ambas cosas, y para que el COPY de dist en el Dockerfile la
    // recoja sin cambios.
    outDir: '../dist/web',
    emptyOutDir: true
  },
  server: {
    proxy,
    // Vite rechaza toda peticion cuyo 'Host' no sea localhost o una IP, y el
    // proxy inverso conserva el Host original ('proxy_set_header Host $host'),
    // asi que sin esto el dominio publico recibe «Blocked request. This host is
    // not allowed» en lugar de la interfaz.
    allowedHosts: ['localhost', ...(WEB_HOST ? [WEB_HOST] : [])],
    // El HMR viaja por el 443 del proxy inverso, no por el puerto de Vite: el
    // cortafuegos del host solo admite 22, 80 y 443, y el cliente por defecto
    // intentaria conectar al puerto del servidor de Vite.
    //
    // Contrapartida: navegando por 127.0.0.1 el websocket tambien apunta al
    // dominio publico. Funciona si el navegador lo resuelve; si no, la pagina
    // se sirve igual y lo unico que se pierde es la recarga en caliente.
    ...(WEB_HOST ? { hmr: { host: WEB_HOST, clientPort: 443, protocol: 'wss' } } : {})
  }
});
