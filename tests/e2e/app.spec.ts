import { expect, test } from '@playwright/test';

test('explora datos reales, pagina, busca y abre detalle', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByText('Todo conectado', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Explorar elementos', exact: true }).click();
  await expect(page.getByText('Portal de medianoche', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Página siguiente', exact: true }).click();
  await expect(page.getByText('Mapa estelar', { exact: true })).toBeVisible();
  await page.getByRole('searchbox').fill('violeta');
  await expect(page.getByText('Archivo violeta', { exact: true })).toBeVisible();
  await page.getByRole('link').filter({ hasText: 'Archivo violeta' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Archivo violeta' })).toBeVisible();
  await expect(page.getByText('item-005', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('valida el formulario y recibe confirmación del servidor', async ({ page }) => {
  await page.goto('/demo');
  await page.getByRole('button', { name: 'Enviar demo', exact: true }).click();
  await expect(page.getByText('Escribe un título para continuar.', { exact: true })).toBeVisible();
  await page.getByLabel('Título', { exact: true }).fill('Una idea de prueba');
  const accepted = page.waitForResponse(response => response.url().endsWith('/v1/demo/submit') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Enviar demo', exact: true }).click();
  expect((await accepted).status()).toBe(202);
  await expect(page.getByText('Tu idea dio el primer paso.', { exact: true })).toBeVisible();
});

test('muestra vacío y controla un detalle inexistente', async ({ page }) => {
  await page.goto('/items?q=sin-coincidencia-xyz');
  await expect(page.getByRole('heading', { name: /Sin resultados/ })).toBeVisible();
  await page.goto('/items/no-existe');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByText('El elemento solicitado no existe.', { exact: true })).toBeVisible();
});

test('diagnóstico muestra configuración y versión obtenida por HTTP', async ({ page }) => {
  await page.goto('/');
  if ((page.viewportSize()?.width ?? 1440) < 768) {
    await page.getByRole('button', { name: 'Abrir menú', exact: true }).click();
  }
  await page.getByRole('link', { name: 'Diagnóstico', exact: true }).click();
  await expect(page.getByText('Tu API está respondiendo.', { exact: true })).toBeVisible();
  await expect(page.getByText('http://localhost:3001', { exact: true })).toBeVisible();
  await expect(page.getByText('corodev-mock-api', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
