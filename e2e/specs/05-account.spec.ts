import { test, expect, shot, login, openUserMenu, ORGANIZATION, PASSWORD } from '../helpers';

const TEMPORARY = 'Provisional0123#';

test.describe.configure({ mode: 'serial' });

test.describe('Account', () => {

  test('Should react to what is typed in the password check', async ({ page }) => {
    await login(page);
    await openUserMenu(page);
    await page.getByRole('link', { name: /mi cuenta/i }).click();

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await shot(page, 'account');

    const password = page.getByLabel(/contraseña nueva/i);

    await password.fill('corta');
    await expect(page.getByRole('button', { name: /cambiar contraseña/i })).toBeDisabled();

    await password.fill(TEMPORARY);
    await page.getByLabel(/repetir/i).fill('otra-distinta');
    await expect(page.getByRole('button', { name: /cambiar contraseña/i })).toBeDisabled();

    await page.getByLabel(/repetir/i).fill(TEMPORARY);
    await expect(page.getByRole('button', { name: /cambiar contraseña/i })).toBeEnabled();

    await shot(page, 'account-password');
  });

  test('Should change the password and restore it', async ({ page }) => {
    await login(page);
    await openUserMenu(page);
    await page.getByRole('link', { name: /mi cuenta/i }).click();

    await page.getByLabel(/contraseña nueva/i).fill(TEMPORARY);
    await page.getByLabel(/repetir/i).fill(TEMPORARY);
    await page.getByRole('button', { name: /cambiar contraseña/i }).click();
    await expect(page.getByText(/contraseña actualizada correctamente/i)).toBeVisible();

    // Se restaura: el resto del recorrido —y la siguiente ejecucion— entran con
    // la contrasena original.
    await page.getByLabel(/contraseña nueva/i).fill(PASSWORD);
    await page.getByLabel(/repetir/i).fill(PASSWORD);
    await page.getByRole('button', { name: /cambiar contraseña/i }).click();
    await expect(page.getByText(/contraseña actualizada correctamente/i)).toBeVisible();

    await openUserMenu(page);
    await page.getByRole('button', { name: /salir/i }).click();
    await login(page, ORGANIZATION, PASSWORD);
    await expect(page.getByRole('button', { name: /subir documento/i })).toBeVisible();
  });
});
