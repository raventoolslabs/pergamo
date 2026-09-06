import { test, expect, shot, login } from '../helpers';

test.describe('En móvil', () => {

  test('el acceso cabe en la pantalla', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: /entrar/i })).toBeVisible();
    await shot(page, 'acceso');
  });

  test('la navegación se pliega y se despliega', async ({ page }) => {
    await login(page);
    await expect(page.getByRole('button', { name: /subir documento/i })).toBeVisible();
    await shot(page, 'fondo');

    const menu = page.getByRole('button', { name: /menú/i });
    await expect(menu).toBeVisible();

    await menu.click();
    await expect(page.getByRole('link', { name: /mi cuenta/i })).toBeVisible();
    await shot(page, 'menu');
  });

  test('no hay desbordamiento horizontal', async ({ page }) => {
    await login(page);

    // Un scroll horizontal en movil es siempre un fallo de maquetacion.
    const desborda = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);

    expect(desborda, 'la página no debe desbordarse en horizontal').toBe(false);
  });
});
