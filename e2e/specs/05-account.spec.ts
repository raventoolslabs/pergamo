import { test, expect, shot, login, menuUsuario, ORGANIZATION, PASSWORD } from '../helpers';

const TEMPORAL = 'Provisional0123#';

test.describe.configure({ mode: 'serial' });

test.describe('Mi cuenta', () => {

  test('la comprobación de contraseña responde a lo que se escribe', async ({ page }) => {
    await login(page);
    await menuUsuario(page);
    await page.getByRole('link', { name: /mi cuenta/i }).click();

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await shot(page, 'cuenta');

    const nueva = page.getByLabel(/contraseña nueva/i);

    await nueva.fill('corta');
    await expect(page.getByRole('button', { name: /cambiar contraseña/i })).toBeDisabled();

    await nueva.fill(TEMPORAL);
    await page.getByLabel(/repetir/i).fill('otra-distinta');
    await expect(page.getByRole('button', { name: /cambiar contraseña/i })).toBeDisabled();

    await page.getByLabel(/repetir/i).fill(TEMPORAL);
    await expect(page.getByRole('button', { name: /cambiar contraseña/i })).toBeEnabled();

    await shot(page, 'cuenta-contrasena');
  });

  test('cambia la contraseña y la deja como estaba', async ({ page }) => {
    await login(page);
    await menuUsuario(page);
    await page.getByRole('link', { name: /mi cuenta/i }).click();

    await page.getByLabel(/contraseña nueva/i).fill(TEMPORAL);
    await page.getByLabel(/repetir/i).fill(TEMPORAL);
    await page.getByRole('button', { name: /cambiar contraseña/i }).click();
    await expect(page.getByText(/contraseña actualizada correctamente/i)).toBeVisible();

    // Se restaura: el resto del recorrido —y la siguiente ejecucion— entran con
    // la contrasena original. Escribir de nuevo oculta el banner anterior, asi
    // que solo hay uno visible en cada momento.
    await page.getByLabel(/contraseña nueva/i).fill(PASSWORD);
    await page.getByLabel(/repetir/i).fill(PASSWORD);
    await page.getByRole('button', { name: /cambiar contraseña/i }).click();
    await expect(page.getByText(/contraseña actualizada correctamente/i)).toBeVisible();

    await menuUsuario(page);
    await page.getByRole('button', { name: /salir/i }).click();
    await login(page, ORGANIZATION, PASSWORD);
    await expect(page.getByRole('button', { name: /subir documento/i })).toBeVisible();
  });
});
