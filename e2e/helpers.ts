import { test as base, expect, type Page } from '@playwright/test';
import { Client } from 'pg';
import fs from 'node:fs';
import path from 'node:path';

export const ORGANIZATION = process.env.PERGAMO_ORG || 'pergamo';
export const PASSWORD = process.env.PERGAMO_PASSWORD || 'Pergamo0123#';
export const MASTER = process.env.PERGAMO_MASTER || 'master';

const SHOTS = path.join(process.cwd(), 'screenshots');

/**
 * Cualquier excepcion no capturada de la pagina tumba la prueba.
 *
 * Es la diferencia entre revisar una interfaz y fotografiarla: un fallo de
 * React puede dejar una pantalla que se ve bien y no hace nada, y sin esto
 * pasaria como buena.
 */
export const test = base.extend<{ page: Page }>({
  page: async ({ page }, use) => {

    const errors: string[] = [];

    page.on('pageerror', (error) => errors.push(error.message));

    // Los errores de consola tambien cuentan —ahi salen los avisos de React—,
    // pero no los fallos de red: la interfaz provoca 4xx a proposito (login
    // rechazado, documento en cuarentena) y el navegador los registra como
    // error aunque esten manejados.
    page.on('console', (message) => {
      if(message.type() !== 'error') return;
      if(/Failed to load resource/i.test(message.text())) return;
      errors.push(`console: ${message.text()}`);
    });

    await use(page);

    expect(errors, 'la pagina no debe registrar errores de JavaScript').toEqual([]);
  }
});

export { expect };

/**
 * Captura a pagina completa en screenshots/<proyecto>/<nombre>.png.
 *
 * Se desactivan las animaciones para que dos ejecuciones den la misma imagen y
 * las diferencias que se vean sean cambios de diseño, no fotogramas distintos.
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
  // Anclado: el boton que muestra la contraseña se llama «Ver contraseña», asi
  // que sin los limites la busqueda encuentra el campo y el boton.
  await page.getByLabel(/^contraseña$/i).fill(password);
  await page.getByRole('button', { name: /entrar/i }).click();
};

/**
 * Abre el menu de usuario del membrete.
 *
 * «Mi cuenta» y «Salir» ya no estan en la barra: viven detras del icono de
 * usuario, asi que llegar a ellos es un paso mas que conviene no repetir en
 * cada prueba.
 */
export const menuUsuario = async (page: Page) => {
  await page.getByRole('button', { name: /menú de usuario/i }).click();
};

/**
 * Consulta directa a la base de datos de prueba.
 *
 * Hace falta para forzar estados que la API no deja provocar desde fuera: sin
 * un ClamAV real no hay forma de conseguir un documento en cuarentena, y la
 * cuarentena es justo la pantalla que mas importa revisar.
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
 * Cierra un dialogo por su boton de pie.
 *
 * El aspa de la cabecera y el boton del pie comparten nombre accesible
 * ('Cerrar'), asi que un selector por rol y nombre encuentra dos elementos. Se
 * toma el ultimo, que es el del pie.
 */
export const closeDialog = async (page: Page) => {
  await page.getByRole('dialog')
    .getByRole('button', { name: /^(cerrar|cancelar)$/i })
    .last()
    .click();
};
