import { defineConfig, devices } from '@playwright/test';

/**
 * El servidor lo levanta e2e/run.sh, no Playwright: la pila necesita ademas una
 * base de datos desechable y un esquema inicializado, asi que la orquestacion
 * vive en el script y aqui solo llega la URL ya en pie.
 */
const baseURL = process.env.PERGAMO_URL || 'http://127.0.0.1:3999';

export default defineConfig({
  testDir: './specs',
  outputDir: './test-results',
  // En serie: las pruebas comparten un unico fondo documental y se pisarian
  // entre ellas al filtrar y al contar entradas.
  workers: 1,
  fullyParallel: false,
  // Sin reintentos: un fallo intermitente aqui es informacion, no ruido que
  // convenga esconder repitiendo.
  retries: 0,
  timeout: 30000,
  expect: { timeout: 7000 },
  reporter: [['list'], ['html', { outputFolder: './playwright-report', open: 'never' }]],
  use: {
    baseURL,
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    {
      name: 'light',
      testIgnore: /07-mobile/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, colorScheme: 'light' }
    },
    {
      name: 'dark',
      testIgnore: /07-mobile/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, colorScheme: 'dark' }
    },
    {
      // El recorrido movil comprueba lo que solo se rompe en pantalla estrecha
      // —navegacion plegada, desbordes—; repetir en 390 px todo el resto seria
      // duplicar tiempo sin cubrir nada nuevo.
      name: 'mobile',
      testMatch: /07-mobile/,
      use: { ...devices['Pixel 7'], colorScheme: 'light' }
    }
  ]
});
