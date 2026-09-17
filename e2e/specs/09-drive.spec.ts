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

  test('Should ask for the Google client before offering to connect', async ({ page }) => {
    await login(page);

    await page.getByRole('link', { name: /google drive/i }).click();

    await expect(page.getByText(/sin conexión/i).first()).toBeVisible();
    await expect(page.getByLabel(/id de cliente/i)).toBeVisible();
    // Sin cliente registrado no hay con que pedirle permiso a Google.
    await expect(page.getByRole('button', { name: /conectar con google drive/i })).toHaveCount(0);

    await shot(page, 'drive-no-client');
  });

  test('Should register the OAuth client and keep the secret sealed', async ({ page }) => {
    await login(page);
    await page.goto('/drive');

    await page.getByLabel(/id de cliente/i).fill('e2e.apps.googleusercontent.com');
    await page.getByLabel(/secreto de cliente/i).fill('GOCSPX-e2e-secret');
    await page.getByRole('button', { name: /registrar cliente/i }).click();

    await expect(page.getByText('e2e.apps.googleusercontent.com')).toBeVisible();
    await expect(page.getByRole('button', { name: /conectar con google drive/i })).toBeVisible();

    // Ni en la pantalla ni en claro en la base: se guarda como iv:tag:data.
    await expect(page.getByText(/GOCSPX-e2e-secret/)).toHaveCount(0);

    const [row]:any = await sql(`SELECT client_secret FROM pergamo.drive_settings WHERE organization = 'pergamo';`);
    expect(row.client_secret).not.toContain('GOCSPX-e2e-secret');
    expect(row.client_secret.split(':')).toHaveLength(3);

    await shot(page, 'drive-client');
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

  test('Should take the connection away when the client is removed', async ({ page }) => {
    await login(page);
    await page.goto('/drive');

    await page.getByRole('button', { name: /quitar cliente/i }).click();
    await page.getByRole('dialog').getByRole('button', { name: /quitar cliente/i }).click();

    // Vuelve el formulario: sin cliente no hay nada que leer.
    await expect(page.getByLabel(/id de cliente/i)).toBeVisible();

    expect(await sql('SELECT organization FROM pergamo.drive_settings;')).toHaveLength(0);
    // El refresh_token lo emitio ese cliente: sin el no se puede renovar.
    expect(await sql('SELECT organization FROM pergamo.drive_connection;')).toHaveLength(0);
  });
});
