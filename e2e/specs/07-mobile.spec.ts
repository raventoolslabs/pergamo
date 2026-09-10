import { test, expect, shot, login, openUserMenu } from '../helpers';

test.describe('On mobile', () => {

  test('Should fit the sign-in screen', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: /entrar/i })).toBeVisible();
    await shot(page, 'login');
  });

  test('Should open and close the user menu', async ({ page }) => {
    await login(page);
    await expect(page.getByRole('button', { name: /subir documento/i })).toBeVisible();
    await shot(page, 'documents');

    const menu = page.getByRole('button', { name: /menú de usuario/i });
    await expect(menu).toBeVisible();

    await menu.click();
    await expect(page.getByRole('link', { name: /mi cuenta/i })).toBeVisible();
    await shot(page, 'menu');

    // Un menu que tapa el contenido y no se quita solo es peor que no tenerlo.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('link', { name: /mi cuenta/i })).toHaveCount(0);
  });

  test('Should not overflow horizontally', async ({ page }) => {
    await login(page);

    // Un scroll horizontal en movil es siempre un fallo de maquetacion.
    const overflows = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);

    expect(overflows, 'the page must not overflow horizontally').toBe(false);
  });

  test('Should fit the password card on screen', async ({ page }) => {
    await login(page);
    await openUserMenu(page);
    await page.getByRole('link', { name: /mi cuenta/i }).click();

    // Es la pantalla con mas densidad (medidor, checklist en grid, dos campos
    // con boton superpuesto): si algo se desborda, es aqui.
    await expect(page.getByText('10 caracteres o más')).toBeVisible();
    await shot(page, 'account');

    const overflows = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);

    expect(overflows, 'the password card must not overflow horizontally').toBe(false);
  });
});
