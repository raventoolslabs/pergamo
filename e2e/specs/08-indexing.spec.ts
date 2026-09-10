import { test, expect, shot, login, asset, sql } from '../helpers';

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
    // El dialogo se cierra solo en cuanto todo ha entrado: no queda nada que
    // mirar ni que cerrar.
    await expect(dialog).toHaveCount(0);

    await page.getByRole('link', { name: 'multipage' }).first().click();

    // El trabajo pasa por la cola y vuelve solo: la ficha se refresca sin que
    // nadie recargue, y eso es justo lo que se comprueba —sin reload().
    await page.getByRole('tab', { name: /índice semántico/i }).click();
    await expect(page.getByText(/^indexado$/i).first()).toBeVisible({ timeout: 60000 });
    await expect(page.getByText(/trozos?$/i).first()).toBeVisible();

    await shot(page, 'detail-indexed');

    const [document] = await sql(
      'SELECT index_status, index_chunks FROM pergamo.document ORDER BY creation_date DESC LIMIT 1;');

    expect(document.index_status).toBe('indexed');
    expect(Number(document.index_chunks)).toBeGreaterThan(0);
  });

  test('Should show the chunks with their provenance and formatting', async ({ page }) => {
    test.setTimeout(90000);

    await page.getByRole('button', { name: /subir documento/i }).click();

    const dialog = page.getByRole('dialog');
    // Este produce encabezados y una tabla, que es lo que hace falta para ver
    // que el renderizador pinta algo y no vuelca tuberias.
    await dialog.locator('input[type=file]').setInputFiles(asset('structured.docx'));
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: /^subir/i }).click();
    // El dialogo se cierra solo en cuanto todo ha entrado: no queda nada que
    // mirar ni que cerrar.
    await expect(dialog).toHaveCount(0);

    await page.getByRole('link', { name: 'structured' }).first().click();
    await page.getByRole('tab', { name: /índice semántico/i }).click();
    await expect(page.getByText(/^indexado$/i).first()).toBeVisible({ timeout: 60000 });

    // La tabla del documento se ve como tabla, con sus celdas, y no como el
    // markdown de tuberias con que se guardo.
    const table = page.getByRole('table').first();
    await expect(table).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Concepto' })).toBeVisible();
    await expect(table.getByRole('cell', { name: 'Alta' })).toBeVisible();
    await expect(table.getByRole('cell', { name: '100' })).toBeVisible();

    // Y la procedencia, que es lo que permite comprobar que la cita es correcta.
    await expect(page.getByText('Guia de Pergamo > Cuentas').first()).toBeVisible();

    await shot(page, 'detail-chunks');

    // El interruptor de crudo ensena el texto exacto que se embebio: las migas
    // por delante y las tuberias sin formatear.
    //
    // El trozo no se guarda en una variable filtrada por «tiene tabla»: el
    // localizador se resuelve de nuevo en cada uso, y en cuanto se pulsa el
    // interruptor ese trozo deja de tener tabla y el filtro deja de casar.
    const panel = page.locator('.chunks');

    await panel.locator('.chunk').filter({ has: page.getByRole('table') }).first()
      .getByRole('button', { name: /ver crudo/i }).click();

    // Era la unica tabla del documento, asi que no queda ninguna dibujada.
    await expect(panel.getByRole('table')).toHaveCount(0);
    await expect(panel.locator('pre.md-code')).toContainText('| Concepto | Importe |');
    await expect(panel.locator('pre.md-code')).toContainText('Guia de Pergamo > Cuentas');

    await shot(page, 'detail-chunks-raw');
  });

  test('Should move between the document tabs with the keyboard', async ({ page }) => {

    await page.getByRole('link', { name: 'structured' }).first().click();
    await expect(page.getByRole('tab', { name: /índice semántico/i })).toBeVisible();

    // El patron ARIA: se entra en la pestana activa y se cambia con flechas, no
    // recorriendo una a una con Tab.
    await page.getByRole('tab', { name: /^general$/i }).focus();
    await page.keyboard.press('ArrowRight');

    const index = page.getByRole('tab', { name: /índice semántico/i });

    await expect(index).toHaveAttribute('aria-selected', 'true');
    await expect(index).toBeFocused();

    await page.keyboard.press('Home');
    await expect(page.getByRole('tab', { name: /^general$/i })).toHaveAttribute('aria-selected', 'true');
  });

  test('Should leave a document out of the index when the box is not ticked', async ({ page }) => {
    await page.getByRole('button', { name: /subir documento/i }).click();

    const dialog = page.getByRole('dialog');
    await dialog.locator('input[type=file]').setInputFiles(asset('test.pdf'));
    // La casilla viene marcada: dejar el documento fuera del indice es
    // desmarcarla.
    await dialog.getByRole('checkbox').uncheck();
    await dialog.getByRole('button', { name: /^subir/i }).click();
    // El dialogo se cierra solo en cuanto todo ha entrado: no queda nada que
    // mirar ni que cerrar.
    await expect(dialog).toHaveCount(0);

    await page.getByRole('link', { name: 'test' }).first().click();

    // 'Sin indexar' no es un fallo, y la ficha tiene que decirlo con esas
    // palabras: un hueco vacio se lee como que algo no ha terminado.
    await expect(page.getByText(/^sin indexar$/i).first()).toBeVisible();
    await shot(page, 'detail-not-indexed');
  });

});
