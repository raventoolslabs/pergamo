import { test, expect, shot, login, sql } from '../helpers';

test.describe.configure({ mode: 'serial' });

/**
 * A Google no se llama: la conexion, las carpetas y los documentos de Drive se
 * siembran en la base de prueba. Lo que se revisa es la pantalla, no la API de
 * Google, que ya cubren test/17 a test/22.
 */
test.describe('Google Drive', () => {

  test.beforeAll(async () => {
    await sql('DELETE FROM pergamo.document;');
    await sql('DELETE FROM pergamo.drive_folder;');
    await sql('DELETE FROM pergamo.drive_connection;');
  });

  test('Should offer to connect when there is no connection', async ({ page }) => {
    await login(page);

    await page.getByRole('link', { name: /google drive/i }).click();

    await expect(page.getByText(/sin conexión/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /conectar con google drive/i })).toBeVisible();

    await shot(page, 'drive-disconnected');
  });

  test('Should list the synced folders with their last error', async ({ page }) => {
    await sql(`INSERT INTO pergamo.drive_connection(organization, google_account, refresh_token, scope)
      VALUES ('pergamo', 'archivo@example.com', 'sealed', 'drive.readonly');`);
    await sql(`INSERT INTO pergamo.drive_folder(organization, folder_id, name, index_documents, sync_date, sync_error)
      VALUES ('pergamo', 'f1', 'Contratos', false, CURRENT_TIMESTAMP, 'Drive answered 403: quota'),
             ('pergamo', 'f2', 'Facturas', false, NULL, NULL);`);

    await login(page);
    await page.goto('/drive');

    await expect(page.getByText(/archivo@example\.com/)).toBeVisible();
    await expect(page.getByText('Contratos')).toBeVisible();
    await expect(page.getByText(/quota/)).toBeVisible();
    await expect(page.getByText(/sin sincronizar todavía/i)).toBeVisible();

    await shot(page, 'drive-folders');
  });

  test('Should stop syncing a folder after confirming', async ({ page }) => {
    await login(page);
    await page.goto('/drive');

    await page.getByRole('button', { name: /quitar facturas/i }).click();
    await page.getByRole('dialog').getByRole('button', { name: /dejar de sincronizar/i }).click();

    await expect(page.getByText('Facturas')).toHaveCount(0);
    expect(await sql(`SELECT id FROM pergamo.drive_folder WHERE folder_id = 'f2';`)).toHaveLength(0);
  });

  test('Should mark Drive documents and link to Drive instead of replacing them', async ({ page }) => {
    await sql(`INSERT INTO pergamo.document(organization, metadata, source, drive_file_id, drive_revision, drive_view_link)
      VALUES ('pergamo', '{"name":"Contrato marco","original_name":"Contrato marco.pdf","mimetype":"application/pdf","extension":"pdf","hash":"drive:1","size":1024,"tags":[]}',
              'drive', 'file-1', '1', 'https://drive.google.com/file/d/file-1/view');`);

    await login(page);

    const row = page.locator('.record', { hasText: 'Contrato marco' });
    await expect(row.getByText('Google Drive')).toBeVisible();

    await row.getByRole('link', { name: 'Contrato marco' }).click();

    const open = page.getByRole('link', { name: /abrir en google drive/i });
    await expect(open).toHaveAttribute('href', 'https://drive.google.com/file/d/file-1/view');
    await expect(page.getByRole('button', { name: /reemplazar fichero/i })).toHaveCount(0);

    await shot(page, 'drive-document');
  });
});
