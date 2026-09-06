import { test, expect, shot, login, asset, closeDialog, sql } from '../helpers';

test.describe.configure({ mode: 'serial' });

/**
 * La cuarentena es la pantalla que mas importa revisar y la unica que no se
 * puede provocar desde fuera sin un ClamAV con firmas reales, asi que el estado
 * se fuerza en la base de datos de prueba.
 */
test.describe('Cuarentena', () => {

  test('sube un documento y lo pone en cuarentena', async ({ page }) => {
    await login(page);

    await page.getByRole('button', { name: /subir documento/i }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('input[type=file]').setInputFiles(asset('test.pdf'));
    await dialog.getByRole('button', { name: /^subir/i }).click();
    await expect(dialog.getByText(/subido/i)).toBeVisible();
    await closeDialog(page);

    await sql(`UPDATE pergamo.document
      SET scan_status = 'infected', scan_signature = 'Eicar-Test-Signature',
          scan_engine = 'ClamAV 1.4.3/27183', scan_date = CURRENT_TIMESTAMP;`);

    await page.reload();
    await shot(page, 'fondo-en-cuarentena');
  });

  test('la ficha explica el bloqueo y no ofrece descarga', async ({ page }) => {
    await login(page);
    await page.getByRole('link', { name: 'test' }).first().click();

    await expect(page.getByText(/Eicar-Test-Signature/).first()).toBeVisible();
    await shot(page, 'ficha-en-cuarentena');

    // La descarga no queda como un boton que no responde: desaparece, y en su
    // lugar hay una frase que dice que ha pasado y que se puede hacer.
    await expect(page.getByRole('button', { name: /descargar/i })).toHaveCount(0);
    await expect(page.getByRole('alert')).toContainText(/reanálisis/i);
  });

  test('limpia el documento de prueba', async ({ page }) => {
    await sql('DELETE FROM pergamo.document;');
    await login(page);
    await expect(page.getByRole('link', { name: 'test' })).toHaveCount(0);
  });
});
