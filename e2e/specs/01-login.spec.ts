import { test, expect, shot, login, menuUsuario, ORGANIZATION, PASSWORD } from '../helpers';

test.describe('Acceso', () => {

  test('muestra el formulario de acceso', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('img', { name: /pergamo/i })).toBeVisible();
    await expect(page.getByLabel(/organización o usuario/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /entrar/i })).toBeVisible();

    await shot(page, 'acceso');
  });

  test('explica el rechazo de unas credenciales incorrectas', async ({ page }) => {
    await login(page, ORGANIZATION, 'ContrasenaIncorrecta1#');

    const error = page.getByRole('alert');
    await expect(error).toBeVisible();
    await expect(error).not.toBeEmpty();

    await shot(page, 'acceso-error');
  });

  test('entra y aterriza en el listado de documentos', async ({ page }) => {
    await login(page);

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: /subir documento/i })).toBeVisible();
    // El nombre de la organizacion queda a la vista: es la unica pista de con
    // que sesion se esta trabajando.
    await expect(page.getByText(ORGANIZATION, { exact: false }).first()).toBeVisible();
  });

  test('sale de la sesión y vuelve al acceso', async ({ page }) => {
    await login(page);
    await menuUsuario(page);
    await page.getByRole('button', { name: /salir/i }).click();

    await expect(page.getByRole('button', { name: /entrar/i })).toBeVisible();
  });
});

test.describe('Configuración', () => {

  test('la contraseña por defecto sigue siendo la esperada', async ({ page }) => {
    // Un fallo aqui suele significar que una ejecucion anterior dejo la
    // contrasena cambiada, y todos los demas recorridos fallarian sin decir
    // por que.
    await login(page, ORGANIZATION, PASSWORD);
    await expect(page.getByRole('button', { name: /menú de usuario/i })).toBeVisible();
  });
});
