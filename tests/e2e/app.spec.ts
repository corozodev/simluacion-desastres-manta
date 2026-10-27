import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const graph = JSON.parse(readFileSync(new URL('../../packages/contracts/examples/graph.json', import.meta.url), 'utf8'));
const initial = JSON.parse(readFileSync(new URL('../../packages/contracts/examples/world.json', import.meta.url), 'utf8'));
const goOrigin = 'http://127.0.0.1:8089';

test.beforeEach(async ({ page }) => {
  let requests = 0;
  await page.route(`${goOrigin}/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    const turn = Math.min(++requests, 2);
    const current = turn === 1 ? 'N-0000' : 'N-0001';
    const body = path === '/grafo' ? graph : path === '/healthz' ? { status: 'ok', service: 'corodev-evacuation', version: '0.1.0' } : {
      ...initial, turn, world_version: turn * 2, graph_version: graph.version,
      survivors: [{ id: 'S-0001', current_node: current, status: 'active', target_shelter_id: 'R-2', planned_route: [current] }],
      metrics: { ...initial.metrics, active: 1, bitten: 0, evacuated: 0 },
    };
    await route.fulfill({ status: ['/estado', '/grafo', '/healthz'].includes(path) ? 200 : 404, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': 'http://localhost:5173' }, body: JSON.stringify(body) });
  });
});

test('abre Escape como producto principal y consulta sólo el contrato Go', async ({ page }) => {
  const requests: { path: string; method: string; privileged: boolean }[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.resourceType() === 'fetch') requests.push({ path: new URL(request.url()).pathname, method: request.method(), privileged: Object.hasOwn(request.headers(), 'x-api-key') });
  });
  await page.goto('/');
  await expect(page).toHaveURL('/escape');
  await expect(page.getByRole('img', { name: /Red de evacuación/ })).toBeVisible();
  await expect(page.locator('nav a')).toHaveCount(1);
  await expect(page.locator('nav a')).toHaveAttribute('href', '/escape');
  expect(requests.every(request => ['/estado', '/grafo', '/healthz'].includes(request.path) && request.method === 'GET' && !request.privileged)).toBe(true);
  expect(errors).toEqual([]);
});

test('actualiza el mapa por HTTP y conserva selección y controles', async ({ page }) => {
  // Stable first sample; subsequent publication moves one observable survivor.
  let move = false;
  await page.route(`${goOrigin}/estado`, async route => {
    const turn = move ? 2 : 1, current = move ? 'N-0001' : 'N-0000';
    await route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': 'http://localhost:5173' }, body: JSON.stringify({ ...initial, turn, world_version: turn * 2, graph_version: graph.version, survivors: [{ id: 'S-0001', current_node: current, status: 'active', target_shelter_id: 'R-2', planned_route: [current] }] }) });
  });
  await page.goto('/escape');
  const map = page.getByRole('img', { name: /Red de evacuación/ });
  await expect(map).toBeVisible();
  const marker = page.locator('.escape-survivor').first();
  const first = `${await marker.getAttribute('cx')},${await marker.getAttribute('cy')}`;
  move = true;
  await expect.poll(async () => `${await marker.getAttribute('cx')},${await marker.getAttribute('cy')}`).not.toBe(first);
  await page.getByRole('searchbox', { name: 'Buscar por ID' }).fill('S-0001');
  await expect(page.getByText('Refugio asignado: R-2')).toBeVisible();
  const view = await map.getAttribute('viewBox');
  await page.getByRole('button', { name: 'Acercar mapa', exact: true }).click();
  await expect(map).not.toHaveAttribute('viewBox', view!);
  await page.getByRole('button', { name: 'Restablecer mapa', exact: true }).click();
  await expect(map).toHaveAttribute('viewBox', view!);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('muestra desconexión Go real y recupera con reintento', async ({ page }) => {
  let unavailable = true;
  await page.route(`${goOrigin}/estado`, async route => {
    await route.fulfill({ status: unavailable ? 503 : 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': 'http://localhost:5173' }, body: JSON.stringify(unavailable ? { error: { code: 'UNAVAILABLE', message: 'Esperando estado Go.', requestId: 'req-go-browser', details: [] } } : initial) });
  });
  await page.goto('/escape');
  await expect(page.getByRole('alert')).toContainText('Esperando estado Go.');
  await expect(page.getByRole('alert')).toContainText('req-go-browser');
  unavailable = false;
  await page.getByRole('button', { name: /Intentar de nuevo/ }).click();
  await expect(page.getByRole('img', { name: /Red de evacuación/ })).toBeVisible();
});

test('enlaces antiguos regresan a Escape y la navegación móvil sigue accesible', async ({ page }) => {
  await page.goto('/ruta-anterior');
  await expect(page).toHaveURL('/escape');
  await expect(page.getByRole('heading', { name: 'Escape de Manta Zombie' })).toBeVisible();
  if ((page.viewportSize()?.width ?? 1440) < 768) {
    await page.getByRole('button', { name: 'Abrir menú', exact: true }).click();
    await expect(page.locator('nav a')).toBeVisible();
    await page.getByRole('button', { name: 'Cerrar menú', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Abrir menú', exact: true })).toHaveAttribute('aria-expanded', 'false');
  }
});
