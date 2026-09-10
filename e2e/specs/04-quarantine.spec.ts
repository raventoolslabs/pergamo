import { test, expect, shot, login, asset, sql } from '../helpers';

test.describe.configure({ mode: 'serial' });

/**
 * La cuarentena es la pantalla que mas importa revisar y la unica que no se
 * puede provocar desde fuera sin un ClamAV con firmas reales, asi que el estado
 * se fuerza en la base de datos de prueba.
 */
test.describe('Quarantine', () => {

  test('Should upload a document and put it in quarantine', async ({ page }) => {
    await login(page);

    await page.getByRole('button', { name: /subir documento/i }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('input[type=file]').setInputFiles(asset('test.pdf'));
    await dialog.getByRole('button', { name: /^subir/i }).click();
    // El dialogo se cierra solo en cuanto todo ha entrado: no queda nada que
    // mirar ni que cerrar.
    await expect(dialog).toHaveCount(0);

    await sql(`UPDATE pergamo.document
      SET scan_status = 'infected', scan_signature = 'Eicar-Test-Signature',
          scan_engine = 'ClamAV 1.4.3/27183', scan_date = CURRENT_TIMESTAMP;`);

    await page.reload();
    await shot(page, 'documents-quarantined');
  });

  test('Should explain the block and offer no download', async ({ page }) => {
    await login(page);
    await page.getByRole('link', { name: 'test' }).first().click();

    await expect(page.getByText(/Eicar-Test-Signature/).first()).toBeVisible();
    await shot(page, 'detail-quarantined');

    // La descarga no queda como un boton que no responde: desaparece, y en su
    // lugar hay una frase que dice que ha pasado y que se puede hacer.
    await expect(page.getByRole('button', { name: /descargar/i })).toHaveCount(0);
    await expect(page.getByRole('alert')).toContainText(/reanálisis/i);
  });

  test('Should quarantine active content on its own', async ({ page }) => {

    // El unico estado de cuarentena que no hay que forzar: lo decide Pergamo al
    // depositar. Se comprueba el recorrido entero, que es lo que distingue este
    // estado de los otros dos: se guarda, no se descarga, y esperar no sirve.
    await login(page);

    await page.getByRole('button', { name: /subir documento/i }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('input[type=file]').setInputFiles(asset('payloads/payload3.pdf'));
    await dialog.getByRole('button', { name: /^subir/i }).click();
    // El dialogo se cierra solo en cuanto todo ha entrado: no queda nada que
    // mirar ni que cerrar.
    await expect(dialog).toHaveCount(0);

    await page.getByRole('link', { name: 'payload3' }).click();

    await expect(page.getByText(/ACTIVE_CONTENT/).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /descargar/i })).toHaveCount(0);
    await expect(page.getByRole('alert')).toContainText(/reanálisis no lo libera/i);

    await shot(page, 'detail-active-content');

    await sql(`DELETE FROM pergamo.document WHERE metadata->>'name' = 'payload3';`);
  });

  test('Should deliver a deposit that has no verdict and say so', async ({ page }) => {

    // La otra mitad de la politica, y la que se rompe sin que nadie se entere:
    // 'pending' no retiene. Si alguien vuelve a meterlo en la lista de estados
    // bloqueados, una caida del escaner deja de entregar el archivo entero.
    await sql(`UPDATE pergamo.document
      SET scan_status = 'pending', scan_signature = NULL, scan_engine = NULL, scan_date = NULL;`);

    await login(page);
    await page.getByRole('link', { name: 'test' }).first().click();

    await expect(page.getByRole('button', { name: /descargar/i })).toBeVisible();

    // 'pending' significa una sola cosa —no hay veredicto todavia— y se llama
    // igual haya caido el analizador o no exista ninguno: dos nombres para el
    // mismo estado describian el servidor en la ficha de cada documento.
    // Por texto y no por rol: el aviso es un `warn`, y el rol 'alert'
    // —asertivo, interrumpe al lector de pantalla— se reserva a los errores.
    await expect(page.getByText(/todavía no tiene veredicto/i)).toBeVisible();

    await shot(page, 'detail-pending-scan');
  });

  test('Should clean up the test document', async ({ page }) => {
    await sql('DELETE FROM pergamo.document;');
    await login(page);
    await expect(page.getByRole('link', { name: 'test' })).toHaveCount(0);
  });
});
