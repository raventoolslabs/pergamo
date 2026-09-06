import { test, expect, shot, login, asset, closeDialog, sql } from '../helpers';

/**
 * El fondo empieza vacio en cada ejecucion y estas pruebas lo llenan. Van en
 * orden y comparten estado a proposito: es el recorrido real de alguien que
 * abre Pergamo por primera vez.
 */
test.describe.configure({ mode: 'serial' });

test.describe('Fondo documental', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('el fondo vacío invita a subir el primer documento', async ({ page }) => {
    await sql('DELETE FROM pergamo.document;');
    await page.reload();

    await expect(page.getByRole('button', { name: /subir documento/i })).toBeVisible();
    await shot(page, 'fondo-vacio');
  });

  test('el diálogo de subida anuncia los formatos y el tamaño admitidos', async ({ page }) => {
    await page.getByRole('button', { name: /subir documento/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // Los limites vienen de GET /config: si no llegan, la validacion previa a
    // la subida no existe y conviene enterarse.
    await expect(dialog.getByText(/pdf/i).first()).toBeVisible();

    await shot(page, 'subida-dialogo');
    await closeDialog(page);
  });

  test('sube un documento y lo muestra en el fondo', async ({ page }) => {
    await page.getByRole('button', { name: /subir documento/i }).click();

    const dialog = page.getByRole('dialog');
    await dialog.locator('input[type=file]').setInputFiles(asset('test.pdf'));
    await shot(page, 'subida-preparada');

    await dialog.getByRole('button', { name: /^subir/i }).click();
    await expect(dialog.getByText(/subido/i)).toBeVisible();

    await closeDialog(page);

    await expect(page.getByRole('link', { name: 'test' })).toBeVisible();
    await shot(page, 'fondo-con-documento');
  });

  test('filtra por nombre y por etiqueta', async ({ page }) => {
    const busqueda = page.getByLabel(/buscar/i);

    await busqueda.fill('test');
    await expect(page.getByRole('link', { name: 'test' })).toBeVisible();

    await busqueda.fill('no-existe-este-documento');
    await expect(page.getByRole('link', { name: 'test' })).toHaveCount(0);
    await shot(page, 'fondo-sin-resultados');

    await busqueda.fill('');
    await page.getByLabel(/etiqueta/i).fill('inexistente');
    await expect(page.getByRole('link', { name: 'test' })).toHaveCount(0);
  });

  test('descarga el documento', async ({ page }) => {
    const descarga = page.waitForEvent('download');
    await page.getByRole('button', { name: /descargar/i }).first().click();

    const fichero = await descarga;
    expect(fichero.suggestedFilename()).toBe('test.pdf');
  });
});
