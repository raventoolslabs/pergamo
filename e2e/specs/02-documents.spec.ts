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

  test('pagina el fondo y cambia los resultados por página', async ({ page }) => {

    // Once documentos mas para que haya mas de una pagina con el tamaño por
    // defecto. Se insertan por SQL porque subirlos uno a uno por la interfaz
    // tardaria mas que la prueba entera.
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
    await shot(page, 'fondo-paginado');

    await page.getByRole('button', { name: /^página 2$/i }).click();
    await expect(page.getByText('9–12 de 12')).toBeVisible();

    // Con dos paginas se ven las dos: la ventana solo recorta cuando hay tantas
    // que los numeros del medio no le sirven a nadie.
    await expect(page.getByRole('button', { name: /^página \d+$/i })).toHaveCount(2);

    // La pagina actual se lee tambien con el raton encima. El roce tiene un
    // pseudo mas que la regla de la pagina actual, asi que sin cuidado gana en
    // especificidad y deja el numero en papel sobre papel.
    const actual = page.getByRole('button', { name: 'Página 2' });
    await actual.hover();
    const contraste = await actual.evaluate((el) => {
      const estilo = getComputedStyle(el);
      return estilo.color !== estilo.backgroundColor;
    });
    expect(contraste, 'el número de la página actual debe contrastar con su fondo').toBe(true);

    // Cambiar el tamaño de pagina vuelve a la primera: quedarse en la 2 con 24
    // por pagina dejaria la lista vacia sin motivo aparente.
    await page.getByLabel(/por página/i).selectOption('24');
    await expect(page.getByText('1–12 de 12')).toBeVisible();

    await sql(`DELETE FROM pergamo.document WHERE metadata->>'name' LIKE 'relleno-%';`);
  });

  test('el filtro de cuarentena encuentra también lo que no tiene fichero', async ({ page }) => {

    await sql(`INSERT INTO pergamo.document(organization, path, metadata)
      VALUES ('pergamo', 'sin-usar', jsonb_build_object(
        'name', 'sin-fichero', 'extension', 'pdf',
        'mimetype', 'application/pdf', 'hash', md5('perdido'), 'tags', '[]'::jsonb));`);

    // 'error' es el documento cuyo fichero falta. La interfaz lo agrupa con la
    // cuarentena, y el filtro tiene que traerlo: si solo pidiera 'infected',
    // este documento seria imposible de encontrar desde la pantalla.
    await sql(`UPDATE pergamo.document SET scan_status = 'error', scan_signature = 'FILE_MISSING'
      WHERE metadata->>'name' = 'sin-fichero';`);

    await page.reload();
    await page.getByLabel(/analizado/i).selectOption({ label: 'En cuarentena' });

    await expect(page.getByRole('link', { name: 'sin-fichero' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'test' })).toHaveCount(0);
    await shot(page, 'fondo-cuarentena-filtrada');

    // Y no se ofrece descargar lo que no se puede entregar.
    await expect(page.getByRole('button', { name: /descargar sin-fichero/i })).toBeDisabled();

    await sql(`DELETE FROM pergamo.document WHERE metadata->>'name' = 'sin-fichero';`);
  });

  test('descarga el documento', async ({ page }) => {
    const descarga = page.waitForEvent('download');
    await page.getByRole('button', { name: /descargar/i }).first().click();

    const fichero = await descarga;
    expect(fichero.suggestedFilename()).toBe('test.pdf');
  });
});
