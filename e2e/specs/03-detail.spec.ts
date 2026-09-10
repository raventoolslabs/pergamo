import { test, expect, shot, login, asset, sql } from '../helpers';

test.describe.configure({ mode: 'serial' });

test.describe('Document detail', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.getByRole('link', { name: 'test' }).first().click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('Should show the fingerprint and the provenance', async ({ page }) => {
    const [document] = await sql("SELECT metadata->>'hash' AS hash FROM pergamo.document LIMIT 1;");

    // El SHA-256 acredita que el contenido no ha cambiado: tiene que estar a la
    // vista, no escondido.
    await expect(page.getByText(String(document.hash).slice(0, 8), { exact: false }).first()).toBeVisible();
    await expect(page.getByText('application/pdf').first()).toBeVisible();

    await shot(page, 'detail');
  });

  test('Should save the metadata and survive a reload', async ({ page }) => {
    await page.getByLabel(/descripción/i).fill('Contrato de arrendamiento');

    const tags = page.getByPlaceholder(/etiqueta/i);
    await tags.fill('contratos');
    await tags.press('Enter');

    await page.getByRole('button', { name: /guardar cambios/i }).click();
    await expect(page.getByRole('button', { name: /guardar cambios/i })).toBeDisabled();

    await shot(page, 'detail-edited');

    await page.reload();
    await expect(page.getByLabel(/descripción/i)).toHaveValue('Contrato de arrendamiento');
    await expect(page.getByText('contratos').first()).toBeVisible();
  });

  test('Should reject a replacement of a different type', async ({ page }) => {
    await page.locator('input[type=file]').setInputFiles(asset('test.odt'));

    // El aviso llega sin subir el fichero: la comprobacion se hace antes de
    // gastar el ancho de banda.
    await expect(page.getByText(/mismo tipo|application\/pdf/i).first()).toBeVisible();
    await shot(page, 'detail-wrong-type');
  });

  test('Should record a version when the file is replaced', async ({ page }) => {
    await page.locator('input[type=file]').setInputFiles(asset('test2.pdf'));

    await expect(page.getByRole('listitem').filter({ hasText: /versión 1/i }).first())
      .toBeVisible({ timeout: 15000 });
    await shot(page, 'detail-versions');
  });

  test('Should delete the document after confirming', async ({ page }) => {
    await page.getByRole('button', { name: /eliminar/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await shot(page, 'detail-delete');

    await dialog.getByRole('button', { name: /eliminar/i }).click();

    await expect(page.getByRole('button', { name: /subir documento/i })).toBeVisible();
    await expect(page.getByRole('link', { name: 'test' })).toHaveCount(0);
  });
});
