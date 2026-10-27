import { readFileSync } from 'node:fs';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { Graph, OperatorSession, SimulationCatalog, SimulationInfo, WorldSnapshot } from '@corodev/contracts';
import { Escape } from '../features/Escape';
import { api } from '../services/api';

const graph = JSON.parse(readFileSync('../../packages/contracts/examples/graph.json', 'utf8')) as Graph;
const master = JSON.parse(readFileSync('../../services/evacuation/data/manta-master.json', 'utf8')) as Graph;
const sample = JSON.parse(readFileSync('../../packages/contracts/examples/world.json', 'utf8')) as WorldSnapshot;
const info: SimulationInfo = { run_id: 'a'.repeat(32), mode: 'competition', round: 'round1', seed: 42, state: 'finished', graph_version: graph.version, turn_limit: 150, interval_ms: 2000 };
const catalog: SimulationCatalog = { default_mode: 'competition', admin_enabled: true, history_limit: 10, rounds: [{ id: 'round1', name: 'Prueba', survivors: 20, turns: 150 }], presets: [
  { id: 'competition', name: 'Competición — 300 intersecciones', nodes: 300, edges: 383, graph_version: graph.version, source: graph.source, coverage: 'Muestra operativa', enabled: true, experimental: false, preview_available: true, disabled_reason: '' },
  { id: 'full', name: 'Manta completo — 9.179 intersecciones', nodes: 9179, edges: 13452, graph_version: master.version, source: master.source, coverage: 'Maestro urbano', enabled: true, experimental: true, preview_available: true, disabled_reason: '' },
] };
const authenticated: OperatorSession = { enabled: true, authenticated: true, operator: 'test-operator', csrf_token: 'test-csrf', expires_at: '2099-01-01T00:00:00Z' };
function setup(options?: { authenticated?: boolean; active?: boolean; disabled?: boolean }) {
  const world = { ...sample, simulation: { ...info, state: options?.active ? 'running' as const : 'finished' as const } };
  vi.spyOn(api, 'world').mockResolvedValue(world);
  vi.spyOn(api, 'graph').mockImplementation(async (_signal, query) => query?.mode === 'full' ? master : graph);
  const c = structuredClone(catalog);
  if (options?.disabled) c.presets[1]!.enabled = false;
  vi.spyOn(api, 'catalog').mockResolvedValue(c);
  vi.spyOn(api, 'session').mockResolvedValue(options?.authenticated ? authenticated : { enabled: true, authenticated: false });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={client}><Escape /></QueryClientProvider>);
  return { client, world };
}
afterEach(() => vi.restoreAllMocks());

it('previsualiza las 13.452 aristas sin activar una ronda ni mezclar posiciones', async () => {
  const start = vi.spyOn(api, 'startRun');
  setup();
  await screen.findByLabelText('Previsualizar cobertura');
  await userEvent.selectOptions(screen.getByLabelText('Previsualizar cobertura'), 'full');
  await waitFor(() => expect(document.querySelectorAll('.escape-road')).toHaveLength(13452));
  expect(document.querySelectorAll('.escape-survivor, .escape-zombie, .escape-planned-route')).toHaveLength(0);
  expect(screen.getByText('Previsualización.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Iniciar ronda seleccionada' })).not.toBeInTheDocument();
  expect(start).not.toHaveBeenCalled();
}, 15000); // jsdom creates 27k SVG DOM nodes; browser performance is measured separately.

it('bloquea el inicio durante una ronda activa y cuando el experimental está deshabilitado', async () => {
  setup({ authenticated: true, active: true, disabled: true });
  const start = await screen.findByRole('button', { name: 'Iniciar ronda seleccionada' });
  expect(start).toBeDisabled();
  await userEvent.selectOptions(screen.getByLabelText('Previsualizar cobertura'), 'full');
  expect(start).toBeDisabled();
});

it('inicia con semilla, ronda esperada y CSRF; cambia la caché y limpia selección al cambiar de ejecución', async () => {
  const { client } = setup({ authenticated: true });
  const next = { ...info, run_id: 'b'.repeat(32), mode: 'full' as const, graph_version: master.version, state: 'running' as const };
  const start = vi.spyOn(api, 'startRun').mockImplementation(async () => {
    vi.mocked(api.world).mockResolvedValue({ ...sample, graph_version: master.version, simulation: next, survivors: [] });
    vi.mocked(api.graph).mockResolvedValue(master);
    return next;
  });
  await screen.findByRole('button', { name: 'Iniciar ronda seleccionada' });
  await userEvent.selectOptions(screen.getByLabelText('Previsualizar cobertura'), 'full');
  await userEvent.clear(screen.getByLabelText('Semilla'));
  await userEvent.type(screen.getByLabelText('Semilla'), '123');
  await userEvent.click(screen.getByRole('button', { name: 'Iniciar ronda seleccionada' }));
  await waitFor(() => expect(start).toHaveBeenCalledWith({ mode: 'full', round: 'round1', seed: 123, expected_run_id: info.run_id }, 'test-csrf'));
  await waitFor(() => expect(api.graph).toHaveBeenCalledWith(expect.anything(), { runId: next.run_id, mode: undefined }));
  expect(screen.getByLabelText('Buscar por ID')).toHaveValue('');
  client.clear();
});

it('usa cookies y CSRF sólo para administración y conserva el código fuera del estado persistente', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(authenticated)));
  await api.login('test-operator', 'transient-test-code');
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({ credentials: 'include', method: 'POST', body: JSON.stringify({ operator: 'test-operator', access_code: 'transient-test-code' }) });
  fetch.mockResolvedValue(new Response(JSON.stringify(info)));
  await api.startRun({ mode: 'competition', round: 'round1', seed: 42, expected_run_id: info.run_id }, 'test-csrf');
  expect(fetch.mock.calls[1]?.[1]?.headers).toMatchObject({ 'X-CSRF-Token': 'test-csrf' });
  expect(fetch.mock.calls.every(([, init]) => !Object.hasOwn(init?.headers ?? {}, 'x-api-key'))).toBe(true);
});
