import { test, expect, shot, login, sql, MASTER, PASSWORD } from '../helpers';

const NOMBRE = `e2e-${Date.now()}`;
const CONTRASENA = 'Organizacion0123#';

test.describe.configure({ mode: 'serial' });

test.describe('Sesión master', () => {

  test.afterAll(async () => {
    await sql('DELETE FROM pergamo.organization WHERE name LIKE $1;', ['e2e-%']);
  });

  test('ve organizaciones y no ve documentos', async ({ page }) => {
    await login(page, MASTER, PASSWORD);

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: /nueva organización/i })).toBeVisible();
    // El token master no lleva organizacion: ofrecer documentos seria ofrecer
    // una pantalla que solo puede fallar.
    await expect(page.getByRole('link', { name: /^documentos$/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /subir documento/i })).toHaveCount(0);

    await shot(page, 'master-organizaciones');
  });

  test('crea una organización', async ({ page }) => {
    await login(page, MASTER, PASSWORD);
    await page.getByRole('button', { name: /nueva organización/i }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/nombre/i).fill(NOMBRE);
    await dialog.getByLabel(/^contraseña$/i).fill(CONTRASENA);
    await dialog.getByLabel(/repetir/i).fill(CONTRASENA);

    await shot(page, 'master-nueva-organizacion');

    await dialog.getByRole('button', { name: /crear/i }).click();
    await expect(page.getByText(NOMBRE).first()).toBeVisible();
  });

  test('cambia la contraseña de una organización', async ({ page }) => {
    await login(page, MASTER, PASSWORD);

    await page.getByRole('row').filter({ hasText: NOMBRE })
      .getByRole('button', { name: /contraseña/i }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/contraseña nueva/i).fill('Cambiada0123#');
    await dialog.getByLabel(/repetir/i).fill('Cambiada0123#');

    await shot(page, 'master-cambiar-contrasena');

    await dialog.getByRole('button', { name: /cambiar/i }).click();
    await expect(page.getByText(/cambiada/i).first()).toBeVisible();
  });

  test('la organización nueva puede entrar con su contraseña', async ({ page }) => {
    await login(page, NOMBRE, 'Cambiada0123#');
    await expect(page.getByRole('button', { name: /subir documento/i })).toBeVisible();
  });
});
