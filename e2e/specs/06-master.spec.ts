import { test, expect, shot, login, closeDialog, sql, MASTER, PASSWORD } from '../helpers';

const NAME = `e2e-${Date.now()}`;
const PASSPHRASE = 'Organizacion0123#';

test.describe.configure({ mode: 'serial' });

test.describe('Master session', () => {

  test.afterAll(async () => {
    await sql('DELETE FROM pergamo.organization WHERE name LIKE $1;', ['e2e-%']);
  });

  test('Should see organizations and no documents', async ({ page }) => {
    await login(page, MASTER, PASSWORD);

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: /nueva organización/i })).toBeVisible();
    // El token master no lleva organizacion: ofrecer documentos seria ofrecer
    // una pantalla que solo puede fallar.
    await expect(page.getByRole('link', { name: /^documentos$/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /subir documento/i })).toHaveCount(0);

    await shot(page, 'master-organizations');
  });

  test('Should create an organization', async ({ page }) => {
    await login(page, MASTER, PASSWORD);
    await page.getByRole('button', { name: /nueva organización/i }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/nombre/i).fill(NAME);
    await dialog.getByLabel(/^contraseña$/i).fill(PASSPHRASE);
    await dialog.getByLabel(/repetir/i).fill(PASSPHRASE);

    await shot(page, 'master-new-organization');

    await dialog.getByRole('button', { name: /crear/i }).click();
    await expect(page.getByText(NAME).first()).toBeVisible();
  });

  test('Should change an organization password', async ({ page }) => {
    await login(page, MASTER, PASSWORD);

    await page.getByRole('row').filter({ hasText: NAME })
      .getByRole('button', { name: /contraseña/i }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/contraseña nueva/i).fill('Cambiada0123#');
    await dialog.getByLabel(/repetir/i).fill('Cambiada0123#');

    await shot(page, 'master-change-password');

    await dialog.getByRole('button', { name: /^cambiar$/i }).click();

    // El dialogo no se cierra solo: se queda mostrando la confirmacion para que
    // el master la vea antes de cerrarlo el mismo.
    await expect(dialog.getByText(/contraseña actualizada correctamente/i)).toBeVisible();
    await closeDialog(page);
  });

  test('Should search, paginate and show discharged organizations', async ({ page }) => {

    // Nueve organizaciones mas para que haya mas de una pagina: por la interfaz
    // serian nueve dialogos, y lo que se prueba es el listado, no el alta.
    await sql(`INSERT INTO pergamo.organization(name, password)
      SELECT 'e2e-relleno-' || n, 'x' FROM generate_series(1, 9) AS n;`);
    await sql(`UPDATE pergamo.organization SET discharge_date = CURRENT_TIMESTAMP
      WHERE name = 'e2e-relleno-1';`);

    await login(page, MASTER, PASSWORD);

    // La de baja no se cuenta entre las activas, pero tampoco desaparece del
    // censo: el subtitulo la nombra aparte.
    await expect(page.getByText(/dada de baja\./i)).toBeVisible();

    await expect(page.getByRole('button', { name: /^página 2$/i })).toBeVisible();
    await page.getByRole('button', { name: /^página 2$/i }).click();
    await shot(page, 'master-paginated');

    await page.getByLabel(/buscar/i).fill('relleno-3');
    await expect(page.getByRole('row').filter({ hasText: 'e2e-relleno-3' })).toBeVisible();
    await expect(page.getByText(/1 organización coincide/i)).toBeVisible();

    // Las bajas solo salen si se piden.
    await page.getByRole('button', { name: /limpiar filtros/i }).click();
    await expect(page.getByRole('row').filter({ hasText: 'e2e-relleno-1' })).toHaveCount(0);

    await page.getByLabel(/dadas de baja/i).selectOption('true');
    await expect(page.getByRole('row').filter({ hasText: 'e2e-relleno-1' })).toBeVisible();
    await expect(page.getByText('de baja', { exact: true })).toBeVisible();
    await shot(page, 'master-with-discharged');

    await sql(`DELETE FROM pergamo.organization WHERE name LIKE 'e2e-relleno-%';`);
  });

  test('Should let the new organization sign in with its password', async ({ page }) => {
    await login(page, NAME, 'Cambiada0123#');
    await expect(page.getByRole('button', { name: /subir documento/i })).toBeVisible();
  });
});
