import { test, expect, shot, login, asset, closeDialog, sql } from '../helpers';

/**
 * El fondo empieza vacio en cada ejecucion y estas pruebas lo llenan. Van en
 * orden y comparten estado a proposito: es el recorrido de alguien que abre
 * Pergamo por primera vez.
 */
test.describe.configure({ mode: 'serial' });

test.describe('Document holdings', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('Should invite the first upload when empty', async ({ page }) => {
    await sql('DELETE FROM pergamo.document;');
    await page.reload();

    await expect(page.getByRole('button', { name: /subir documento/i })).toBeVisible();
    await shot(page, 'documents-empty');
  });

  test('Should announce the accepted formats and size on the upload dialog', async ({ page }) => {
    await page.getByRole('button', { name: /subir documento/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // Los limites vienen de GET /config: si no llegan, la validacion previa a
    // la subida no existe y conviene enterarse.
    await expect(dialog.getByText(/pdf/i).first()).toBeVisible();

    await shot(page, 'upload-dialog');
    await closeDialog(page);
  });

  test('Should upload a document and list it', async ({ page }) => {
    await page.getByRole('button', { name: /subir documento/i }).click();

    const dialog = page.getByRole('dialog');

    // Se elige pulsando, que es el camino que setInputFiles no recorre: ese
    // escribe en el input directamente y se salta la zona de arrastre.
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      dialog.getByText(/arrastra los ficheros/i).click()
    ]);
    await chooser.setFiles(asset('test.pdf'));

    await expect(dialog.getByText('test.pdf')).toBeVisible();
    await shot(page, 'upload-ready');

    await dialog.getByRole('button', { name: /^subir/i }).click();
    // El dialogo se cierra solo en cuanto todo ha entrado: no queda nada que
    // mirar ni que cerrar.
    await expect(dialog).toHaveCount(0);

    await expect(page.getByRole('link', { name: 'test' })).toBeVisible();
    await shot(page, 'documents-with-one');
  });

  test('Should turn the dialog into a summary when an upload fails', async ({ page }) => {

    // El fallo se provoca desde el navegador: la API no rechaza un PDF sano, y
    // lo que se revisa aqui es lo que el dialogo ensena despues.
    await page.route('**/document*', (route) => route.request().method() === 'POST'
      ? route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'No ha podido guardarse' })
      })
      : route.continue());

    await page.getByRole('button', { name: /subir documento/i }).click();

    const dialog = page.getByRole('dialog');
    await dialog.locator('input[type=file]').setInputFiles(asset('test.pdf'));
    await dialog.getByRole('button', { name: /^subir/i }).click();

    // Solo queda la lista con el motivo: pedir mas ficheros cuando ya no se van
    // a enviar es ofrecer un camino que no lleva a ninguna parte.
    await expect(dialog.getByText(/no ha podido guardarse/i)).toBeVisible();
    await expect(dialog.getByText(/arrastra los ficheros/i)).toHaveCount(0);
    await expect(dialog.getByRole('checkbox')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: /^subir/i })).toHaveCount(0);

    await shot(page, 'upload-failed');

    await dialog.getByRole('button', { name: /^cerrar$/i }).click();
    await expect(dialog).toHaveCount(0);
  });

  test('Should filter by name and by tag', async ({ page }) => {
    const search = page.getByLabel(/buscar/i);

    await search.fill('test');
    await expect(page.getByRole('link', { name: 'test' })).toBeVisible();

    await search.fill('no-existe-este-documento');
    await expect(page.getByRole('link', { name: 'test' })).toHaveCount(0);
    await shot(page, 'documents-no-results');

    await search.fill('');
    await page.getByLabel(/etiqueta/i).fill('inexistente');
    await expect(page.getByRole('link', { name: 'test' })).toHaveCount(0);
  });

  test('Should paginate and change the page size', async ({ page }) => {

    // Once documentos mas para que haya mas de una pagina con el tamano por
    // defecto. Por SQL porque subirlos uno a uno por la interfaz tardaria mas
    // que la prueba entera.
    await sql(`INSERT INTO pergamo.document(organization, path, metadata)
      SELECT 'pergamo', 'sin-usar',
        jsonb_build_object(
          'name', 'relleno-' || n,
          'extension', 'pdf',
          'mimetype', 'application/pdf',
          'hash', md5(n::text),
          'tags', '[]'::jsonb)
      FROM generate_series(1, 11) AS n;`);

    await page.reload();

    await expect(page.getByText('1–8 de 12')).toBeVisible();
    await shot(page, 'documents-paginated');

    await page.getByRole('button', { name: /^página 2$/i }).click();
    await expect(page.getByText('9–12 de 12')).toBeVisible();

    // Con dos paginas se ven las dos: la ventana solo recorta cuando hay tantas
    // que los numeros del medio no le sirven a nadie.
    await expect(page.getByRole('button', { name: /^página \d+$/i })).toHaveCount(2);

    // La pagina actual se lee tambien con el raton encima: el roce tiene un
    // pseudo mas, asi que sin cuidado gana en especificidad y deja el numero en
    // papel sobre papel.
    const current = page.getByRole('button', { name: 'Página 2' });
    await current.hover();
    const contrasts = await current.evaluate((el) => {
      const style = getComputedStyle(el);
      return style.color !== style.backgroundColor;
    });
    expect(contrasts, 'the current page number must contrast with its background').toBe(true);

    // Cambiar el tamano de pagina vuelve a la primera: quedarse en la 2 con 24
    // por pagina dejaria la lista vacia sin motivo aparente.
    await page.getByLabel(/por página/i).selectOption('24');
    await expect(page.getByText('1–12 de 12')).toBeVisible();

    await sql(`DELETE FROM pergamo.document WHERE metadata->>'name' LIKE 'relleno-%';`);
  });

  test('Should filter a missing file as error and not as quarantine', async ({ page }) => {

    await sql(`INSERT INTO pergamo.document(organization, path, metadata)
      VALUES ('pergamo', 'sin-usar', jsonb_build_object(
        'name', 'sin-fichero', 'extension', 'pdf',
        'mimetype', 'application/pdf', 'hash', md5('perdido'), 'tags', '[]'::jsonb));`);

    // 'error' bloquea la descarga igual que la cuarentena, pero no le toca a la
    // misma persona: aqui no hay nada que decidir sobre el documento, falta su
    // fichero del almacen.
    await sql(`UPDATE pergamo.document SET scan_status = 'error', scan_signature = 'FILE_MISSING'
      WHERE metadata->>'name' = 'sin-fichero';`);

    await page.reload();

    // El filtro de cuarentena no lo trae: es lo que separa los dos estados
    // desde la pantalla.
    await page.getByLabel(/^estado$/i).selectOption({ label: 'En cuarentena' });
    await expect(page.getByRole('link', { name: 'sin-fichero' })).toHaveCount(0);

    await page.getByLabel(/^estado$/i).selectOption({ label: 'Error' });

    await expect(page.getByRole('link', { name: 'sin-fichero' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'test' })).toHaveCount(0);
    // Por clase y no por texto: 'Error' es tambien el rotulo de la opcion del
    // desplegable, y un getByText lo encontraria ahi, oculto.
    await expect(page.locator('.verdict--error')).toBeVisible();
    await shot(page, 'documents-error-filtered');

    // Y no se ofrece descargar lo que no se puede entregar.
    await expect(page.getByRole('button', { name: /descargar sin-fichero/i })).toBeDisabled();

    await sql(`DELETE FROM pergamo.document WHERE metadata->>'name' = 'sin-fichero';`);
  });

  test('Should sort the holdings by the column that is clicked', async ({ page }) => {

    // Dos nombres que rodean al del documento subido: asi el orden se lee sin
    // depender de cuantos documentos haya dejado la prueba anterior.
    await sql(`INSERT INTO pergamo.document(organization, path, metadata)
      SELECT 'pergamo', 'sin-usar', jsonb_build_object(
        'name', n, 'extension', 'pdf', 'mimetype', 'application/pdf',
        'hash', md5(n), 'tags', '[]'::jsonb)
      FROM unnest(ARRAY['aaa-orden', 'zzz-orden']) AS n;`);

    await page.reload();

    const titles = page.locator('.record__title a');

    await page.getByRole('button', { name: /ordenar por documento/i }).click();
    await expect(titles).toHaveText(['aaa-orden', 'test', 'zzz-orden']);
    await shot(page, 'documents-sorted-by-name');

    // El segundo clic sobre la misma columna invierte el sentido.
    await page.getByRole('button', { name: /ordenar por documento/i }).click();
    await expect(titles).toHaveText(['zzz-orden', 'test', 'aaa-orden']);

    // Volver al deposito manda lo recien insertado arriba y deja 'test', que
    // entro antes, en el ultimo lugar.
    await page.getByRole('button', { name: /ordenar por depósito/i }).click();
    await expect(titles.last()).toHaveText('test');

    await sql(`DELETE FROM pergamo.document WHERE metadata->>'name' LIKE '%-orden';`);
  });

  test('Should download the document', async ({ page }) => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: /descargar/i }).first().click();

    const download = await pending;
    expect(download.suggestedFilename()).toBe('test.pdf');
  });
});
