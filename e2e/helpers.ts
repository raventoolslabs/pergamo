import { test as base, expect, type Page } from '@playwright/test';
import { Client } from 'pg';
import fs from 'node:fs';
import path from 'node:path';

export const ORGANIZATION = process.env.PERGAMO_ORG || 'pergamo';
export const PASSWORD = process.env.PERGAMO_PASSWORD || 'Pergamo0123#';
export const MASTER = process.env.PERGAMO_MASTER || 'master';

const SHOTS = path.join(process.cwd(), 'screenshots');

/**
 * Cualquier excepcion no capturada tumba la prueba: es la diferencia entre
 * revisar una interfaz y fotografiarla, porque un fallo de React puede dejar
 * una pantalla que se ve bien y no hace nada.
 */
export const test = base.extend<{ page: Page }>({
  page: async ({ page }, use) => {

    const errors: string[] = [];

    page.on('pageerror', (error) => errors.push(error.message));

    // Los errores de consola cuentan —ahi salen los avisos de React—, pero no
    // los de red: la interfaz provoca 4xx a proposito y el navegador los
    // registra como error aunque esten manejados.
    page.on('console', (message) => {
      if(message.type() !== 'error') return;
      if(/Failed to load resource/i.test(message.text())) return;
      errors.push(`console: ${message.text()}`);
    });

    await use(page);

    expect(errors, 'the page must not log JavaScript errors').toEqual([]);
  }
});

export { expect };

/**
 * Captura a pagina completa en screenshots/<proyecto>/<nombre>.png. Sin
 * animaciones, para que dos ejecuciones den la misma imagen y las diferencias
 * sean cambios de diseño y no fotogramas distintos.
 */
export const shot = async (page: Page, name: string) => {

  const project = test.info().project.name;
  const directory = path.join(SHOTS, project);

  await fs.promises.mkdir(directory, { recursive: true });

  await page.screenshot({
    path: path.join(directory, `${name}.png`),
    fullPage: true,
    animations: 'disabled'
  });
};

export const login = async (page: Page, name = ORGANIZATION, password = PASSWORD) => {
  await page.goto('/');
  await page.getByLabel(/organización o usuario/i).fill(name);
  // Anclado: el boton que muestra la contrasena se llama «Ver contraseña», asi
  // que sin los limites la busqueda encuentra el campo y el boton.
  await page.getByLabel(/^contraseña$/i).fill(password);
  await page.getByRole('button', { name: /entrar/i }).click();

  // Se espera al desenlace, sea cual sea: sin esto un `page.reload()` inmediato
  // adelanta a la peticion de acceso y la pantalla vuelve al formulario.
  //
  // Las dos salidas cuentan porque este helper tambien sirve para entrar mal:
  // el menu de usuario o el aviso de credenciales rechazadas.
  await Promise.race([
    page.getByRole('button', { name: /menú de usuario/i }).waitFor({ state: 'visible' }),
    page.getByRole('alert').waitFor({ state: 'visible' })
  ]);
};

/** «Mi cuenta» y «Salir» viven detras del icono de usuario. */
export const openUserMenu = async (page: Page) => {
  await page.getByRole('button', { name: /menú de usuario/i }).click();
};

/**
 * Consulta directa a la base de datos de prueba, para forzar estados que la API
 * no deja provocar desde fuera: sin un ClamAV real no hay forma de conseguir un
 * documento en cuarentena, que es la pantalla que mas importa revisar.
 *
 * Llega por el puerto que publica el contenedor: dentro de la imagen de
 * Playwright no hay cliente de docker, pero con --network host el Postgres de
 * prueba esta en el mismo 127.0.0.1.
 */
export const sql = async (query: string, values: unknown[] = []) => {

  const client = new Client({
    host: process.env.PERGAMO_DB_HOST || '127.0.0.1',
    port: Number.parseInt(process.env.PERGAMO_DB_PORT || '55432', 10),
    user: process.env.PERGAMO_DB_USER || 'pergamo',
    password: process.env.PERGAMO_DB_PASSWORD || 'pergamotest',
    database: process.env.PERGAMO_DB_NAME || 'pergamo_test'
  });

  await client.connect();

  try {
    return (await client.query(query, values)).rows;
  } finally {
    await client.end();
  }
};

export const asset = (name: string) => path.join('/repo/test/assets', name);

/**
 * El aspa de la cabecera y el boton del pie comparten nombre accesible, asi que
 * un selector por rol y nombre encuentra dos elementos: se toma el ultimo.
 */
export const closeDialog = async (page: Page) => {
  await page.getByRole('dialog')
    .getByRole('button', { name: /^(cerrar|cancelar)$/i })
    .last()
    .click();
};
