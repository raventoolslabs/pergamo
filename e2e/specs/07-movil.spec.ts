import { test, expect, shot, login, menuUsuario } from '../helpers';

test.describe('En móvil', () => {

  test('el acceso cabe en la pantalla', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: /entrar/i })).toBeVisible();
    await shot(page, 'acceso');
  });

  test('el menú de usuario se abre y se cierra', async ({ page }) => {
    await login(page);
    await expect(page.getByRole('button', { name: /subir documento/i })).toBeVisible();
    await shot(page, 'fondo');

    const menu = page.getByRole('button', { name: /menú de usuario/i });
    await expect(menu).toBeVisible();

    await menu.click();
    await expect(page.getByRole('link', { name: /mi cuenta/i })).toBeVisible();
    await shot(page, 'menu');

    // Un menu que tapa el contenido y no se quita solo es peor que no tenerlo.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('link', { name: /mi cuenta/i })).toHaveCount(0);
  });

  test('no hay desbordamiento horizontal', async ({ page }) => {
    await login(page);

    // Un scroll horizontal en movil es siempre un fallo de maquetacion.
    const desborda = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);

    expect(desborda, 'la página no debe desbordarse en horizontal').toBe(false);
  });

  test('la tarjeta de cambiar contraseña cabe en la pantalla', async ({ page }) => {
    await login(page);
    await menuUsuario(page);
    await page.getByRole('link', { name: /mi cuenta/i }).click();

    // Es la pantalla con mas densidad de la app (medidor, checklist en grid,
    // dos campos con boton superpuesto): si algo se desborda, es aqui.
    await expect(page.getByText('10 caracteres o más')).toBeVisible();
    await shot(page, 'cuenta');

    const desborda = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);

    expect(desborda, 'la tarjeta de contraseña no debe desbordarse en horizontal').toBe(false);
  });
});
