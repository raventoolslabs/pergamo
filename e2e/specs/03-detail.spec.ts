import { test, expect, shot, login, asset, sql } from '../helpers';

test.describe.configure({ mode: 'serial' });

test.describe('Ficha del documento', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.getByRole('link', { name: 'test' }).first().click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('muestra el sello de integridad y la procedencia', async ({ page }) => {
    const [documento] = await sql("SELECT metadata->>'hash' AS hash FROM pergamo.document LIMIT 1;");

    // El SHA-256 es lo que acredita que el contenido no ha cambiado: tiene que
    // estar a la vista, no escondido.
    await expect(page.getByText(String(documento.hash).slice(0, 8), { exact: false }).first()).toBeVisible();
    await expect(page.getByText('application/pdf').first()).toBeVisible();

    await shot(page, 'ficha');
  });

  test('guarda los metadatos y el cambio sobrevive a recargar', async ({ page }) => {
    await page.getByLabel(/descripción/i).fill('Contrato de arrendamiento');

    const etiquetas = page.getByPlaceholder(/etiqueta/i);
    await etiquetas.fill('contratos');
    await etiquetas.press('Enter');

    await page.getByRole('button', { name: /guardar cambios/i }).click();
    await expect(page.getByRole('button', { name: /guardar cambios/i })).toBeDisabled();

    await shot(page, 'ficha-editada');

    await page.reload();
    await expect(page.getByLabel(/descripción/i)).toHaveValue('Contrato de arrendamiento');
    await expect(page.getByText('contratos').first()).toBeVisible();
  });

  test('rechaza reemplazar el fichero por otro de distinto tipo', async ({ page }) => {
    await page.locator('input[type=file]').setInputFiles(asset('test.odt'));

    // El aviso llega sin subir el fichero: la comprobacion se hace antes de
    // gastar el ancho de banda.
    await expect(page.getByText(/mismo tipo|application\/pdf/i).first()).toBeVisible();
    await shot(page, 'ficha-tipo-incorrecto');
  });

  test('registra una versión al reemplazar el fichero', async ({ page }) => {
    await page.locator('input[type=file]').setInputFiles(asset('test2.pdf'));

    await expect(page.getByRole('row').filter({ hasText: '1' }).first()).toBeVisible({ timeout: 15000 });
    await shot(page, 'ficha-versiones');
  });

  test('elimina el documento tras confirmar', async ({ page }) => {
    await page.getByRole('button', { name: /eliminar/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await shot(page, 'ficha-eliminar');

    await dialog.getByRole('button', { name: /eliminar/i }).click();

    await expect(page.getByRole('button', { name: /subir documento/i })).toBeVisible();
    await expect(page.getByRole('link', { name: 'test' })).toHaveCount(0);
  });
});
