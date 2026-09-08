import { test, expect, shot, login, asset, closeDialog, sql } from '../helpers';

/**
 * Solo con E2E_INDEXING: sin maquina de inferencia detras no hay nada que
 * comprobar aqui, y la casilla ni siquiera se dibuja porque GET /config dice
 * que este despliegue no indexa.
 */
test.skip(!process.env.PERGAMO_INDEXING,
  'Necesita E2E_INDEXING=1 y una maquina de inferencia (EMBEDDING_BASE_URL).');

test.describe.configure({ mode: 'serial' });

test.describe('Semantic index', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('Should index a document when the box is ticked', async ({ page }) => {
    // Depende de una maquina de inferencia ajena: el defecto de 30 s deja poco
    // margen para la cola mas la conversion mas el proveedor.
    test.setTimeout(90000);

    await sql('DELETE FROM pergamo.document;');
    await page.reload();

    await page.getByRole('button', { name: /subir documento/i }).click();

    const dialog = page.getByRole('dialog');
    await dialog.locator('input[type=file]').setInputFiles(asset('multipage.pdf'));
    await dialog.getByRole('checkbox').check();

    await shot(page, 'upload-indexing');

    await dialog.getByRole('button', { name: /^subir/i }).click();
    await expect(dialog.getByText(/subido/i)).toBeVisible();
    await closeDialog(page);

    await page.getByRole('link', { name: 'multipage' }).first().click();

    // El trabajo pasa por la cola y vuelve solo: la ficha se refresca sin que
    // nadie recargue, y eso es justo lo que se comprueba —sin reload().
    await expect(page.getByText(/^indexado$/i).first()).toBeVisible({ timeout: 60000 });
    await expect(page.getByText(/trozos?$/i).first()).toBeVisible();

    await shot(page, 'detail-indexed');

    const [document] = await sql(
      'SELECT index_status, index_chunks FROM pergamo.document ORDER BY creation_date DESC LIMIT 1;');

    expect(document.index_status).toBe('indexed');
    expect(Number(document.index_chunks)).toBeGreaterThan(0);
  });

  test('Should leave a document out of the index when the box is not ticked', async ({ page }) => {
    await page.getByRole('button', { name: /subir documento/i }).click();

    const dialog = page.getByRole('dialog');
    await dialog.locator('input[type=file]').setInputFiles(asset('test.pdf'));
    await dialog.getByRole('button', { name: /^subir/i }).click();
    await expect(dialog.getByText(/subido/i)).toBeVisible();
    await closeDialog(page);

    await page.getByRole('link', { name: 'test' }).first().click();

    // 'Sin indexar' no es un fallo, y la ficha tiene que decirlo con esas
    // palabras: un hueco vacio se lee como que algo no ha terminado.
    await expect(page.getByText(/^sin indexar$/i).first()).toBeVisible();
    await shot(page, 'detail-not-indexed');
  });

});
