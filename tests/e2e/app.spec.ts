import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Graph, SimulationCapabilities, SimulationCreated, SimulationState, WorldSnapshot } from '@corodev/contracts';

const graph = JSON.parse(readFileSync(new URL('../../packages/contracts/examples/graph.json', import.meta.url), 'utf8')) as Graph;
const initial = JSON.parse(readFileSync(new URL('../../packages/contracts/examples/world.json', import.meta.url), 'utf8')) as WorldSnapshot;
const goOrigin = 'http://127.0.0.1:8089';
const token = 'opaque-browser-fixture-token';
const capabilities: SimulationCapabilities = {
  scenarios: [{ id: 'zombie_outbreak', name: 'Brote zombie', available: true, synthetic: true }, { id: 'urban_flood', name: 'Inundación urbana', available: true, synthetic: true }],
  graph_profiles: [{ id: 'BASE', name: 'Base', available: true, graph_version: graph.version, nodes: graph.nodes.length, edges: graph.edges.length }, { id: 'FULL_MANTA', name: 'Manta completo', available: false, graph_version: 'master', nodes: 9179, edges: 13452, disabled_reason: 'Modo experimental deshabilitado.' }],
  defaults: { scenario: 'zombie_outbreak', graph_profile: 'BASE', seed: 20261026, max_ticks: 150, tick_interval_ms: 2000, survivors: 20, round: 'round1' },
  limits: { max_active: 2, max_full_active: 1, max_retained: 8, max_memory_bytes: 134217728, min_tick_interval_ms: 1000, max_tick_interval_ms: 5000, max_ticks: 150, max_survivors: 200 },
  rounds: [{ id: 'round1', name: 'Ronda 1', survivors: 20, turns: 150 }],
};

function state(id: string, tick = 0, status: SimulationState['status'] = 'RUNNING'): SimulationState {
  const current = tick > 1 ? 'N-0001' : 'N-0000';
  return { simulation_id: id, status, tick, max_ticks: 150, state_version: tick + 1,
    scenario: 'zombie_outbreak', graph_profile: 'BASE', graph_version: graph.version, seed: 20261026, tick_interval_ms: 2000,
    created_at: '2026-10-27T10:00:00Z', started_at: '2026-10-27T10:00:00Z', updated_at: '2026-10-27T10:00:02Z', expires_at: '2026-10-27T10:15:00Z',
    config: { survivors: 20, round: 'round1', refuge_ids: graph.shelters.map(shelter => shelter.id) },
    snapshot: { ...initial, turn: tick, world_version: tick + 1, graph_version: graph.version,
      survivors: [{ id: 'S-0001', current_node: current, status: 'active', target_shelter_id: 'R-2', planned_route: [current] }], metrics: { ...initial.metrics, active: 1, bitten: 0, evacuated: 0 } },
  };
}

// Test doubles are confined to browser QA. The companion integration harness
// exercises React against a real Go manager with two isolated browser contexts.
test.beforeEach(async ({ page }) => {
  let current: SimulationState | undefined;
  let stateReads = 0;
  let count = 0;
  await page.route(`${goOrigin}/**`, async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const reply = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': 'http://localhost:5173' }, body: JSON.stringify(body) });
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': 'http://localhost:5173', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'authorization,content-type,idempotency-key' } });
    if (path === '/v1/simulations/capabilities') return reply(capabilities);
    if (path === '/grafo') return reply(graph);
    if (path === '/v1/simulations' || path.endsWith('/restart')) {
      current = state(`browser-simulation-${++count}`); stateReads = 0;
      const { snapshot: _snapshot, ...metadata } = current;
      return reply({ ...metadata, access_token: token } satisfies SimulationCreated, 201);
    }
    if (path.endsWith('/state') && current) {
      if (current.status === 'RUNNING') current = state(current.simulation_id, Math.min(++stateReads, 2));
      return reply(current);
    }
    if (path.endsWith('/pause') || path.endsWith('/resume') || path.endsWith('/cancel')) {
      current = { ...current!, status: path.endsWith('/pause') ? 'PAUSED' : path.endsWith('/resume') ? 'RUNNING' : 'CANCELLED' };
      const { snapshot: _snapshot, ...metadata } = current;
      return reply(metadata);
    }
    if (path.endsWith('/results') && current) return reply({ ...current, results: { initial_survivors: 20, evacuated: 0, bitten: 0, active: 20, survival_rate: 1, refuges_used: 0 } });
    return reply({ error: { code: 'NOT_FOUND', message: 'No disponible.', requestId: 'browser-404', details: [] } }, 404);
  });
});

test('abre el mapa sin crear ni ejecutar una sesión', async ({ page }) => {
  const requests: { path: string; method: string; privileged: boolean }[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.url().startsWith(goOrigin)) requests.push({ path: new URL(request.url()).pathname, method: request.method(), privileged: Object.hasOwn(request.headers(), 'x-api-key') });
  });
  await page.goto('/');
  await expect(page).toHaveURL('/escape');
  await expect(page.getByRole('img', { name: /Red de evacuación/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Iniciar simulación', exact: true })).toBeEnabled();
  await expect(page.locator('.escape-survivor, .escape-zombie')).toHaveCount(0);
  expect(requests.every(request => ['/v1/simulations/capabilities', '/grafo'].includes(request.path) && request.method === 'GET' && !request.privileged)).toBe(true);
  expect(errors).toEqual([]);
});

test('inicia una vez, observa movimientos y recupera la misma sesión al recargar', async ({ page }) => {
  let creates = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/v1/simulations' && request.method() === 'POST') creates++; });
  await page.goto('/escape');
  await page.getByRole('button', { name: 'Iniciar simulación', exact: true }).dblclick();
  const map = page.getByRole('img', { name: /Red de evacuación/ });
  const marker = page.locator('.escape-survivor').first();
  await expect(marker).toBeVisible();
  const first = await marker.getAttribute('transform');
  await expect.poll(async () => await marker.getAttribute('transform')).not.toBe(first);
  await page.getByRole('button', { name: 'Refugios y agentes' }).click();
  await page.getByRole('tab', { name: /Supervivientes/ }).click();
  await page.getByRole('searchbox', { name: 'Buscar por ID' }).fill('S-0001');
  await page.getByRole('button', { name: 'Ver ruta de S-0001' }).click();
  await expect(page.getByText('S-0001 · Ruta resaltada en el mapa')).toBeVisible();
  await expect(page.getByRole('columnheader')).toHaveText(['Superviviente', 'Estado', 'Refugio', 'Acción']);
  await page.getByRole('button', { name: 'Cerrar refugios y agentes' }).click();
  const view = await map.getAttribute('viewBox');
  await map.focus();
  await map.press('+');
  await expect(map).not.toHaveAttribute('viewBox', view!);
  await page.getByRole('button', { name: 'Restablecer vista', exact: true }).click();
  await expect(map).toHaveAttribute('viewBox', view!);
  await page.reload();
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('corodev.simulation-session.v1')!).simulation_id)).toBe('browser-simulation-1');
  expect(creates).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('pausa, reanuda, cancela, muestra resultados y reinicia con otro ID', async ({ page }) => {
  await page.goto('/escape');
  await page.getByRole('button', { name: 'Iniciar simulación', exact: true }).click();
  await page.getByRole('button', { name: 'Pausar', exact: true }).click();
  await expect(page.getByLabel('Tu simulación')).toContainText('Pausada');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByLabel('Tu simulación')).toContainText('En ejecución');
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.getByLabel('Resultados de simulación')).toContainText('Cancelada');
  await page.getByRole('button', { name: 'Reiniciar', exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('corodev.simulation-session.v1')!).simulation_id)).toBe('browser-simulation-2');
});

test('conserva el último snapshot durante desconexión y permite reintento', async ({ page }) => {
  await page.goto('/escape');
  await page.getByRole('button', { name: 'Iniciar simulación', exact: true }).click();
  await expect(page.locator('.escape-survivor')).toHaveCount(1);
  await page.route(`${goOrigin}/v1/simulations/*/state`, route => route.fulfill({ status: 503, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': 'http://localhost:5173' }, body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Snapshot temporalmente desconectado.', requestId: 'req-go-browser', details: [] } }) }));
  await expect(page.getByRole('alert')).toContainText('req-go-browser', { timeout: 10_000 });
  await expect(page.locator('.escape-survivor')).toHaveCount(1);
  await page.unroute(`${goOrigin}/v1/simulations/*/state`);
  await page.getByRole('button', { name: /Intentar de nuevo/ }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('descarta una sesión perdida sin crear otra automáticamente', async ({ page }) => {
  let creates = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/v1/simulations' && request.method() === 'POST') creates++; });
  await page.goto('/escape');
  await page.getByRole('button', { name: 'Iniciar simulación', exact: true }).click();
  await expect(page.getByLabel('Tu simulación')).toBeVisible();
  await page.route(`${goOrigin}/v1/simulations/*/state`, route => route.fulfill({ status: 410, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': 'http://localhost:5173' }, body: JSON.stringify({ error: { code: 'EXPIRED', message: 'La sesión ha caducado.', requestId: 'req-expired', details: [] } }) }));
  await page.reload();
  await expect(page.getByText(/Tu simulación ya no está disponible/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Iniciar simulación', exact: true })).toBeVisible();
  expect(creates).toBe(1);
});

test('enlaces antiguos regresan a Escape y el menú móvil sigue accesible', async ({ page }) => {
  await page.goto('/ruta-anterior');
  await expect(page).toHaveURL('/escape');
  await expect(page.getByRole('heading', { name: 'Escape de Manta Zombie' })).toBeVisible();
  if ((page.viewportSize()?.width ?? 1440) < 768) {
    await page.getByRole('button', { name: 'Abrir menú', exact: true }).click();
    await expect(page.locator('nav a')).toHaveCount(2);
    await expect(page.getByRole('link', { name: 'Escape Manta Zombie' })).toBeVisible();
    await page.getByRole('button', { name: 'Cerrar menú', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Abrir menú', exact: true })).toHaveAttribute('aria-expanded', 'false');
  }
});
