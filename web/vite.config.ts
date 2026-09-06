import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// El destino de la API en desarrollo. En produccion no hay proxy: la interfaz
// la sirve el propio Express desde dist/web, en el mismo origen que la API.
const API_TARGET = process.env.PERGAMO_API || 'http://localhost:3000';

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
  server: { proxy }
});
