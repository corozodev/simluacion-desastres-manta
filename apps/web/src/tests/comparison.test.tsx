import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SimulationCreateRequest, SimulationCreated } from '@corodev/contracts';
import { ComparisonLab, comparisonCSV, comparisonExport } from '../features/ComparisonLab';
import { api, ApiError } from '../services/api';
import { created, managedState, results } from './simulation-fixtures';

const input: SimulationCreateRequest = { scenario: 'zombie_outbreak', graph_profile: 'BASE', seed: 77, max_ticks: 150, tick_interval_ms: 2000, config: { mode: 'official', zombie_policy: 'classic_random', evacuation_algorithm: 'legacy_current', survivors: 20, round: 'round1', refuge_ids: [], pro: { runner_prediction: true, shelter_assignment: true, rescue_fleet: false } } };
const clients: QueryClient[] = [];
function setup(configuration = input) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  clients.push(client);
  const busy = vi.fn();
  const create = vi.spyOn(api, 'createSimulation').mockImplementation(async config => created(managedState(undefined, { simulation_id: `comparison-${config.config?.evacuation_algorithm}`, seed: config.seed })));
  vi.spyOn(api, 'simulationState').mockImplementation(async id => managedState(undefined, { simulation_id: id, status: 'COMPLETED' }));
  vi.spyOn(api, 'simulationResults').mockImplementation(async id => results(managedState(undefined, { simulation_id: id, status: 'COMPLETED' })));
  render(<QueryClientProvider client={client}><ComparisonLab input={configuration} valid disabled={false} onBusyChange={busy} /></QueryClientProvider>);
  return { create, busy };
}
afterEach(() => { clients.splice(0).forEach(client => client.clear()); vi.restoreAllMocks(); });

describe('laboratorio comparativo explícito', () => {
  it('abrir el panel no inicia sesiones; la comparación usa una pareja independiente con condiciones idénticas', async () => {
    const { create } = setup();
    await userEvent.click(screen.getByText('Laboratorio comparativo'));
    expect(create).not.toHaveBeenCalled();
    let finish!: (value: SimulationCreated) => void;
    create.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await userEvent.dblClick(screen.getByRole('button', { name: 'Ejecutar comparación' }));
    expect(create).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Comparación en curso…' })).toBeDisabled();
    await act(async () => finish(created(managedState(undefined, { simulation_id: 'comparison-first' }))));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    await screen.findByRole('button', { name: 'Repetir comparación y semillas' });
    const [first, second] = create.mock.calls.map(call => call[0]);
    expect(first?.config?.evacuation_algorithm).toBe('baseline_shortest_path');
    expect(second?.config?.evacuation_algorithm).toBe('predictive_temporal_astar');
    expect({ ...first, config: { ...first?.config, evacuation_algorithm: null } }).toEqual({ ...second, config: { ...second?.config, evacuation_algorithm: null } });
    expect(create.mock.calls[0]![1]).not.toBe(create.mock.calls[1]![1]);
    expect(api.simulationState).toHaveBeenCalledWith('comparison-first', 'opaque-private-test-token', expect.anything());
    expect(screen.getAllByRole('meter')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Exportar JSON' })).toBeEnabled();
    expect(sessionStorage.length).toBe(0);
  });

  it('comparte la semilla automática devuelta por Go y la conserva para repetir', async () => {
    const { seed: _seed, ...automatic } = input;
    const { create } = setup(automatic);
    create.mockImplementation(async config => created(managedState(undefined, { simulation_id: `comparison-${config.config?.evacuation_algorithm}`, seed: config.seed ?? 12345 })));
    await userEvent.click(screen.getByText('Laboratorio comparativo'));
    await userEvent.click(screen.getByRole('button', { name: 'Ejecutar comparación' }));
    await screen.findByRole('button', { name: 'Repetir comparación y semillas' });
    expect(create.mock.calls[0]![0]).not.toHaveProperty('seed');
    expect(create.mock.calls[1]![0].seed).toBe(12345);
    await userEvent.click(screen.getByRole('button', { name: 'Repetir comparación y semillas' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(4));
    expect(create.mock.calls.slice(2).map(call => call[0].seed)).toEqual([12345, 12345]);
  });

  it('reintenta con la misma clave una creación rechazada sin reemplazar la configuración', async () => {
    const { create } = setup();
    create.mockRejectedValueOnce(new ApiError('Sin cupo.', 'CAPACITY_EXHAUSTED', 503));
    await userEvent.click(screen.getByText('Laboratorio comparativo'));
    await userEvent.click(screen.getByRole('button', { name: 'Ejecutar comparación' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Reintentar configuración pendiente' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(3));
    expect(create.mock.calls[0]).toEqual(create.mock.calls[1]);
  });

  it('exporta configuración, semilla y resultados sin credenciales; CSV conserva columnas y comillas', () => {
    const row = { input, state: managedState(undefined, { status: 'COMPLETED', seed: 77 }), metadata: created() };
    const exported = comparisonExport([row]);
    expect(exported[0]?.configuration.seed).toBe(77);
    expect(JSON.stringify(exported)).not.toContain('opaque-private-test-token');
    expect(JSON.stringify(exported)).not.toContain('access_token');
    const csv = comparisonCSV(exported);
    expect(csv).toContain('"http_p95_ms"');
    expect(csv).toContain('""seed"":77');
    expect(csv.split('\r\n')).toHaveLength(2);
  });

  it('registra composición y grafo efectivos al exportar una solicitud antigua sin semilla', () => {
    const counts = { walker: 9, runner: 0, horde: 0, sleeper: 0 };
    const state = managedState(undefined, { seed: 123 });
    state.config.zombie_counts = counts;
    const exported = comparisonExport([{ input: { scenario: 'zombie_outbreak', graph_profile: 'BASE', max_ticks: 150, tick_interval_ms: 2000 }, state }]);
    expect(exported[0]).toMatchObject({ graph_version: state.graph_version, configuration: { seed: 123, max_ticks: 150, tick_interval_ms: 2000, config: { zombie_counts: counts } } });
  });
});
