import { readFileSync } from 'node:fs';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { Graph, OperatorSession, SimulationInfo } from '@corodev/contracts';
import { Escape } from '../features/Escape';
import { api } from '../services/api';
import { capabilities, created, graph, managedState } from './simulation-fixtures';

const master = JSON.parse(readFileSync('../../services/evacuation/data/manta-master.json', 'utf8')) as Graph;
const info: SimulationInfo = { run_id: 'a'.repeat(32), mode: 'competition', round: 'round1', seed: 42, state: 'finished', graph_version: graph.version, turn_limit: 150, interval_ms: 2000 };
const authenticated: OperatorSession = { enabled: true, authenticated: true, operator: 'test-operator', csrf_token: 'test-csrf', expires_at: '2099-01-01T00:00:00Z' };
function setup() {
  vi.spyOn(api, 'graph').mockImplementation(async (_signal, query) => query?.mode === 'full' ? master : graph);
  vi.spyOn(api, 'simulationCapabilities').mockResolvedValue(capabilities);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={client}><Escape /></QueryClientProvider>);
  return client;
}
afterEach(() => vi.restoreAllMocks());

it('explora las 13.452 aristas sin activar una ejecución ni mezclar posiciones', async () => {
  const start = vi.spyOn(api, 'createSimulation');
  const client = setup();
  await screen.findByLabelText('Profundidad del grafo');
  await userEvent.selectOptions(screen.getByLabelText('Profundidad del grafo'), 'FULL_MANTA');
  await waitFor(() => expect(screen.getByText(/9.179 nodos|9179 nodos/)).toBeInTheDocument());
  expect(document.querySelectorAll('.escape-survivor, .escape-zombie, .escape-planned-route')).toHaveLength(0);
  expect(screen.getByText('Solo geografía')).toBeInTheDocument();
  expect(document.querySelectorAll('.escape-road')).toHaveLength(2);
  expect([...document.querySelectorAll('.escape-road')].reduce((count, path) => count + (path.getAttribute('d')?.match(/M/g)?.length ?? 0), 0)).toBe(master.edges.length);
  expect(start).not.toHaveBeenCalled();
  client.clear();
}, 15000);

it('inicia FULL_MANTA sólo con la selección pública y conserva la topología de esa sesión', async () => {
  const client = setup();
  const next = managedState(undefined, { graph_profile: 'FULL_MANTA', graph_version: master.version, snapshot: { ...managedState().snapshot, graph_version: master.version, survivors: [], zombies: [] } });
  const start = vi.spyOn(api, 'createSimulation').mockResolvedValue(created(next));
  vi.spyOn(api, 'simulationState').mockResolvedValue(next);
  await screen.findByLabelText('Profundidad del grafo');
  await userEvent.selectOptions(screen.getByLabelText('Profundidad del grafo'), 'FULL_MANTA');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Iniciar simulación' })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: 'Iniciar simulación' }));
  await waitFor(() => expect(start).toHaveBeenCalledWith(expect.objectContaining({ graph_profile: 'FULL_MANTA' }), expect.any(String)));
  await screen.findByLabelText('Tu simulación');
  expect(api.graph).toHaveBeenLastCalledWith(expect.anything(), { runId: undefined, mode: 'full' });
  expect(screen.getByLabelText('Buscar por ID')).toHaveValue('');
  client.clear();
}, 15000);

it('usa cookies y CSRF sólo para administración y conserva el código fuera del estado persistente', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(authenticated)));
  await api.login('test-operator', 'transient-test-code');
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({ credentials: 'include', method: 'POST', body: JSON.stringify({ operator: 'test-operator', access_code: 'transient-test-code' }) });
  fetch.mockResolvedValue(new Response(JSON.stringify(info)));
  await api.startRun({ mode: 'competition', round: 'round1', seed: 42, expected_run_id: info.run_id }, 'test-csrf');
  expect(fetch.mock.calls[1]?.[1]?.headers).toMatchObject({ 'X-CSRF-Token': 'test-csrf' });
  expect(fetch.mock.calls.every(([, init]) => !Object.hasOwn(init?.headers ?? {}, 'x-api-key'))).toBe(true);
});
