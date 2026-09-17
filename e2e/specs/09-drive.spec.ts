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
    await sql('DELETE FROM pergamo.drive_settings;');
  });

  test('Should ask for the Google client behind the connect button', async ({ page }) => {
    await login(page);

    await page.getByRole('link', { name: /google drive/i }).click();

    await expect(page.getByText(/sin conexión/i).first()).toBeVisible();
    // Un solo boton: lo que hace falta antes de Google se pide en su dialogo.
    await expect(page.getByLabel(/id de cliente/i)).toHaveCount(0);

    await shot(page, 'drive-disconnected');

    await page.getByRole('button', { name: /conectar con google drive/i }).click();
    await expect(page.getByRole('dialog').getByLabel(/id de cliente/i)).toBeVisible();

    await shot(page, 'drive-connect-dialog');
  });

  test('Should seal the secret and head to Google on the next step', async ({ page }) => {
    // Google no se llama: se intercepta la navegacion que abre la autorizacion.
    await page.route('https://accounts.google.com/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<html><body>google</body></html>' }));

    await login(page);
    await page.goto('/drive');

    await page.getByRole('button', { name: /conectar con google drive/i }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/id de cliente/i).fill('e2e.apps.googleusercontent.com');
    await dialog.getByLabel(/secreto de cliente/i).fill('GOCSPX-e2e-secret');
    await dialog.getByRole('button', { name: /siguiente/i }).click();

    await page.waitForURL(/accounts\.google\.com/);
    expect(new URL(page.url()).searchParams.get('client_id')).toBe('e2e.apps.googleusercontent.com');

    // En claro no se guarda: iv:tag:data en base64.
    const [row]:any = await sql(`SELECT client_secret FROM pergamo.drive_settings WHERE organization = 'pergamo';`);
    expect(row.client_secret).not.toContain('GOCSPX-e2e-secret');
    expect(row.client_secret.split(':')).toHaveLength(3);
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

  test('Should tear Drive down when the account is disconnected', async ({ page }) => {
    await login(page);
    await page.goto('/drive');

    await page.getByRole('button', { name: /desconectar/i }).click();
    await page.getByRole('dialog').getByRole('button', { name: /desconectar/i }).click();

    await expect(page.getByRole('button', { name: /conectar con google drive/i })).toBeVisible();

    expect(await sql('SELECT organization FROM pergamo.drive_settings;')).toHaveLength(0);
    expect(await sql('SELECT organization FROM pergamo.drive_connection;')).toHaveLength(0);
    expect(await sql('SELECT id FROM pergamo.drive_folder;')).toHaveLength(0);
    // Baja logica: el fichero sigue en Drive y el documento conserva su id.
    expect(await sql("SELECT id FROM pergamo.document WHERE source = 'drive' AND discharge_date IS NULL;")).toHaveLength(0);
  });
});
