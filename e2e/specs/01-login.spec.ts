import { test, expect, shot, login, openUserMenu, ORGANIZATION, PASSWORD } from '../helpers';

test.describe('Sign in', () => {

  test('Should show the sign-in form', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('img', { name: /pergamo/i })).toBeVisible();
    await expect(page.getByLabel(/organización o usuario/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /entrar/i })).toBeVisible();

    await shot(page, 'login');
  });

  test('Should explain rejected credentials', async ({ page }) => {
    await login(page, ORGANIZATION, 'ContrasenaIncorrecta1#');

    const error = page.getByRole('alert');
    await expect(error).toBeVisible();
    await expect(error).not.toBeEmpty();

    await shot(page, 'login-error');
  });

  test('Should land on the document list after signing in', async ({ page }) => {
    await login(page);

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: /subir documento/i })).toBeVisible();
    // El nombre de la organizacion queda a la vista: es la unica pista de con
    // que sesion se esta trabajando.
    await expect(page.getByText(ORGANIZATION, { exact: false }).first()).toBeVisible();
  });

  test('Should sign out and return to the form', async ({ page }) => {
    await login(page);
    await openUserMenu(page);
    await page.getByRole('button', { name: /salir/i }).click();

    await expect(page.getByRole('button', { name: /entrar/i })).toBeVisible();
  });
});

test.describe('Configuration', () => {

  test('Should keep the expected default password', async ({ page }) => {
    // Un fallo aqui suele significar que una ejecucion anterior dejo la
    // contrasena cambiada, y los demas recorridos fallarian sin decir por que.
    await login(page, ORGANIZATION, PASSWORD);
    await expect(page.getByRole('button', { name: /menú de usuario/i })).toBeVisible();
  });
});
