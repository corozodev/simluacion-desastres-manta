import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SimulationState } from '@corodev/contracts';
import { Escape } from '../features/Escape';
import { api, ApiError } from '../services/api';
import { simulationStorageKey } from '../services/simulation';
import { capabilities, created, graph, managedFlood, managedState, restoreSession, results } from './simulation-fixtures';

const clients: QueryClient[] = [];
function setup(options: { state?: SimulationState; unavailableFlood?: boolean; disabledFull?: boolean } = {}) {
  const discovery = structuredClone(capabilities);
  if (options.unavailableFlood) discovery.scenarios[1]!.available = false;
  if (options.disabledFull) discovery.graph_profiles[1]!.available = false;
  vi.spyOn(api, 'simulationCapabilities').mockResolvedValue(discovery);
  vi.spyOn(api, 'graph').mockResolvedValue(graph);
  vi.spyOn(api, 'simulationState').mockResolvedValue(options.state ?? managedState());
  vi.spyOn(api, 'simulationResults').mockImplementation(async () => results(options.state ?? managedState(undefined, { status: 'COMPLETED' })));
  const create = vi.spyOn(api, 'createSimulation').mockResolvedValue(created(options.state));
  const control = vi.spyOn(api, 'controlSimulation').mockImplementation(async (_id, _token, action) => {
    const next = managedState(undefined, { status: action === 'pause' ? 'PAUSED' : action === 'resume' ? 'RUNNING' : 'CANCELLED' });
    vi.mocked(api.simulationState).mockResolvedValue(next);
    return next;
  });
  const restart = vi.spyOn(api, 'restartSimulation').mockImplementation(async () => {
    const next = managedState(undefined, { simulation_id: 'second-independent-id', tick: 0, snapshot: { ...managedState().snapshot, turn: 0 } });
    vi.mocked(api.simulationState).mockResolvedValue(next);
    return created(next);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  clients.push(client);
  const view = render(<QueryClientProvider client={client}><Escape /></QueryClientProvider>);
  return { ...view, client, create, control, restart };
}
async function openAgents() {
  await userEvent.click(screen.getByRole('button', { name: 'Refugios y agentes' }));
  await userEvent.click(screen.getByRole('tab', { name: /^Supervivientes/ }));
}
afterEach(() => { clients.splice(0).forEach(client => client.clear()); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('ejecutor independiente bajo demanda', () => {
  it('prepara una duración personalizada larga, valida límites y sólo comienza al pulsar iniciar', async () => {
    const { create } = setup();
    await screen.findByRole('button', { name: 'Iniciar simulación' });
    await userEvent.click(screen.getByText('Configuración avanzada'));
    const duration = screen.getByLabelText('Turnos máximos');
    expect(duration).toHaveAttribute('min', '30');
    expect(duration).toHaveAttribute('max', '3000');
    fireEvent.change(duration, { target: { value: '29' } });
    expect(screen.getByRole('button', { name: 'Iniciar simulación' })).toBeDisabled();
    fireEvent.change(duration, { target: { value: '3001' } });
    expect(screen.getByRole('button', { name: 'Iniciar simulación' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '600 turnos' }));
    expect(duration).toHaveValue(600);
    expect(create).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar simulación' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ max_ticks: 600, config: expect.objectContaining({ mode: 'experimental' }) }), expect.any(String)));
  });

  it('explora mapa y refugios sin crear ni observar un mundo global', async () => {
    const world = vi.spyOn(api, 'world');
    const { create } = setup();
    expect(await screen.findByRole('img', { name: /Red de evacuación/ })).toBeInTheDocument();
    expect(screen.getByText('Sin ejecución activa')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Iniciar simulación' })).toBeEnabled();
    expect(api.graph).toHaveBeenCalledWith(expect.anything(), { runId: undefined, mode: 'competition' });
    expect(document.querySelectorAll('.escape-zombie, .escape-survivor')).toHaveLength(0);
    expect(world).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(api.simulationState).not.toHaveBeenCalled();
  });

  it('valida parámetros y envía escenario, semilla, ronda y refugios elegidos', async () => {
    const { create } = setup();
    await screen.findByRole('button', { name: 'Iniciar simulación' });
    await userEvent.click(screen.getByText('Configuración avanzada'));
    await userEvent.click(screen.getByText('Parámetros de generación'));
    await userEvent.clear(screen.getByLabelText('Semilla'));
    expect(screen.getByRole('button', { name: 'Iniciar simulación' })).toBeEnabled();
    await userEvent.type(screen.getByLabelText('Semilla'), '123');
    await userEvent.selectOptions(screen.getByLabelText('Ronda'), 'round2');
    fireEvent.change(screen.getByLabelText('Agentes'), { target: { value: '12' } });
    await userEvent.click(screen.getByRole('button', { name: 'Refugios y agentes' }));
    await userEvent.click(screen.getByText(/Refugios ·/));
    await userEvent.click(screen.getByText('Elegir refugios originales activos'));
    await userEvent.click(screen.getByRole('checkbox', { name: new RegExp(graph.shelters[0]!.id) }));
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar simulación' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({ scenario: 'zombie_outbreak', graph_profile: 'BASE', seed: 123, max_ticks: 150, tick_interval_ms: 2000, config: { mode: 'experimental', zombie_policy: 'classic_random', evacuation_algorithm: 'legacy_current', pro: { runner_prediction: true, shelter_assignment: true, rescue_fleet: false }, zombie_counts: { walker: 12, runner: 4, horde: 2, sleeper: 0 }, survivors: 12, round: 'round2', refuge_ids: [graph.shelters[0]!.id] } }, expect.any(String)));
  });

  it('configura políticas y funciones PRO reales y bloquea extensiones al cambiar al modo oficial', async () => {
    const { create } = setup();
    await screen.findByRole('button', { name: 'Iniciar simulación' });
    await userEvent.click(screen.getByText('Configuración avanzada'));
    await userEvent.selectOptions(screen.getByLabelText('Política de zombis'), 'adaptive_exploration');
    await userEvent.selectOptions(screen.getByLabelText('Algoritmo de evacuación'), 'predictive_temporal_astar');
    await userEvent.click(screen.getByLabelText('Flota de rescate · experimental'));
    await userEvent.selectOptions(screen.getByLabelText('Modo de reglas'), 'official');
    expect(screen.getByLabelText('Política de zombis')).toHaveValue('classic_random');
    expect(screen.getByLabelText('Política de zombis')).toBeDisabled();
    expect(screen.getByLabelText('Flota de rescate · experimental')).not.toBeChecked();
    expect(screen.getByLabelText('Flota de rescate · experimental')).toBeDisabled();
    expect(screen.getByLabelText('Agentes')).toBeDisabled();
    expect(screen.getByLabelText('Profundidad del grafo')).toBeDisabled();
    expect(screen.getByLabelText('Turnos máximos')).toHaveValue(150);
    expect(screen.getByLabelText('Turnos máximos')).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar simulación' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ graph_profile: 'BASE', max_ticks: 150, tick_interval_ms: 2000, config: expect.objectContaining({ mode: 'official', zombie_policy: 'classic_random', evacuation_algorithm: 'predictive_temporal_astar', survivors: 20, refuge_ids: [], pro: { runner_prediction: true, shelter_assignment: true, rescue_fleet: false } }) }), expect.any(String)));
    await screen.findByLabelText('Tu simulación');
    expect(screen.queryByLabelText('Política de zombis')).not.toBeInTheDocument();
  });

  it('envía selección experimental y las tres opciones PRO al backend', async () => {
    const { create } = setup();
    await screen.findByRole('button', { name: 'Iniciar simulación' });
    await userEvent.click(screen.getByText('Configuración avanzada'));
    await userEvent.selectOptions(screen.getByLabelText('Política de zombis'), 'correlated_random_walk');
    await userEvent.selectOptions(screen.getByLabelText('Algoritmo de evacuación'), 'dynamic_risk_astar');
    await userEvent.click(screen.getByLabelText('Predicción de corredores'));
    await userEvent.click(screen.getByLabelText('Asignación coordinada de refugios'));
    await userEvent.click(screen.getByLabelText('Flota de rescate · experimental'));
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar simulación' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ mode: 'experimental', zombie_policy: 'correlated_random_walk', evacuation_algorithm: 'dynamic_risk_astar', pro: { runner_prediction: false, shelter_assignment: false, rescue_fleet: true } }) }), expect.any(String)));
  });

  it('valida cantidades por ronda, conserva el borrador y envía una semilla opcional real', async () => {
    const { create } = setup();
    await screen.findByRole('button', { name: 'Iniciar simulación' });
    await userEvent.click(screen.getByText('Parámetros de generación'));
    expect(screen.getByLabelText('Caminantes')).toHaveValue(8);
    expect(screen.getByLabelText('Corredores')).toBeDisabled();
    expect(screen.getByLabelText('Hordas')).toBeDisabled();
    expect(screen.getByLabelText('Dormidos')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Caminantes'), { target: { value: '0' } });
    expect(screen.getByRole('button', { name: 'Iniciar simulación' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Caminantes'), { target: { value: '15' } });
    await userEvent.click(screen.getByRole('button', { name: 'Conservar valores' }));
    expect(create).not.toHaveBeenCalled();
    await userEvent.selectOptions(screen.getByLabelText('Ronda'), 'round2');
    await userEvent.click(screen.getByText('Parámetros de generación'));
    expect(screen.getByLabelText('Corredores')).toBeEnabled();
    expect(screen.getByLabelText('Dormidos')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Hordas'), { target: { value: '0' } });
    expect(screen.getByRole('button', { name: 'Iniciar simulación' })).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText('Ronda'), 'round1');
    expect(screen.getByLabelText('Caminantes')).toHaveValue(15);
    await userEvent.selectOptions(screen.getByLabelText('Ronda'), 'round3');
    expect(screen.getByLabelText('Dormidos')).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Dormidos'), { target: { value: '1.5' } });
    expect(screen.getByRole('button', { name: 'Iniciar simulación' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Semilla'), { target: { value: '22' } });
    await userEvent.click(screen.getByRole('button', { name: 'Restaurar configuración predeterminada' }));
    expect(create).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Dormidos')).toHaveValue(10);
    expect(screen.getByLabelText('Semilla')).toHaveValue(null);
    expect(screen.getByText('Total de zombies: 41')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar simulación' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]![0]).not.toHaveProperty('seed');
    expect(create.mock.calls[0]![0].config).toMatchObject({ round: 'round3', zombie_counts: { walker: 20, runner: 8, horde: 3, sleeper: 10 } });
  });

  it('copia la semilla efectiva de una ejecución recuperada sin reiniciarla', async () => {
    restoreSession();
    const { create } = setup();
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    await screen.findByLabelText('Tu simulación');
    fireEvent.click(screen.getByText('Configuración e información técnica'));
    await user.click(screen.getByRole('button', { name: 'Copiar seed' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('20261026'));
    expect(create).not.toHaveBeenCalled();
  });

  it('un doble clic crea una sola ejecución con clave idempotente y guarda sólo credenciales propias en sessionStorage', async () => {
    const { create } = setup();
    let finish!: (value: ReturnType<typeof created>) => void;
    create.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const button = await screen.findByRole('button', { name: 'Iniciar simulación' });
    await userEvent.dblClick(button);
    expect(create).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    await act(async () => finish(created()));
    await screen.findByLabelText('Tu simulación');
    const saved = JSON.parse(sessionStorage.getItem(simulationStorageKey)!);
    expect(saved).toMatchObject({ simulation_id: 'private-simulation-id', access_token: 'opaque-private-test-token' });
    expect(localStorage.length).toBe(0);
    expect(window.location.href).not.toContain(saved.access_token);
    expect(screen.queryByRole('button', { name: 'Reiniciar' })).not.toBeInTheDocument();
  });

  it('recupera al actualizar sin crear y continúa consultando con credencial privada', async () => {
    restoreSession();
    const { create } = setup();
    await screen.findByLabelText('Tu simulación');
    expect(create).not.toHaveBeenCalled();
    expect(api.simulationState).toHaveBeenCalledWith('private-simulation-id', 'opaque-private-test-token', expect.anything());
    expect(screen.queryByRole('button', { name: 'Iniciar simulación' })).not.toBeInTheDocument();
  });

  it('consulta cada dos segundos y evita acumular solicitudes lentas', async () => {
    vi.useFakeTimers();
    restoreSession();
    setup();
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByLabelText('Tu simulación')).toBeInTheDocument();
    const state = vi.mocked(api.simulationState);
    let finish!: (value: SimulationState) => void;
    state.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    const count = state.mock.calls.length;
    expect(count).toBeGreaterThan(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    expect(state).toHaveBeenCalledTimes(count);
    await act(async () => finish(managedState()));
  });

  it('pausa, reanuda y cancela según estados devueltos por Go y muestra resultados', async () => {
    restoreSession();
    const { control } = setup();
    const pause = await screen.findByRole('button', { name: 'Pausar' });
    await waitFor(() => expect(pause).toBeEnabled());
    await userEvent.click(pause);
    expect(await screen.findByText('Pausada')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pausar' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(await screen.findByText('En ejecución')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(await screen.findByRole('heading', { name: 'Resultados de simulación' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continuar' })).not.toBeInTheDocument();
    expect(control.mock.calls.map(call => call[2])).toEqual(['pause', 'resume', 'cancel']);
  });

  it('reinicia una ejecución terminal con nueva ID y la credencial de su predecesora', async () => {
    restoreSession();
    const { restart, create } = setup({ state: managedState(undefined, { status: 'COMPLETED' }) });
    const button = await screen.findByRole('button', { name: 'Reiniciar' });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    await waitFor(() => expect(restart).toHaveBeenCalledWith('private-simulation-id', 'opaque-private-test-token', expect.any(String)));
    await waitFor(() => expect(sessionStorage.getItem(simulationStorageKey)).toContain('second-independent-id'));
    expect(create).not.toHaveBeenCalled();
  });

  it.each([404, 410])('limpia credenciales si la sesión desaparece o caduca (%s)', async status => {
    restoreSession();
    const { create } = setup();
    vi.mocked(api.simulationState).mockRejectedValue(new ApiError('Sesión perdida.', 'SESSION_GONE', status));
    expect(await screen.findByText(/Tu simulación ya no está disponible/)).toBeInTheDocument();
    expect(sessionStorage.getItem(simulationStorageKey)).toBeNull();
    expect(screen.getByRole('button', { name: 'Iniciar simulación' })).toBeEnabled();
    expect(create).not.toHaveBeenCalled();
  });

  it('conserva el último snapshot durante la desconexión y reintenta sin crear', async () => {
    restoreSession();
    const { client, create } = setup();
    await screen.findByLabelText('Tu simulación');
    vi.mocked(api.simulationState).mockRejectedValue(new ApiError('Sin red.', 'BACKEND_UNAVAILABLE'));
    await act(async () => { await client.invalidateQueries({ queryKey: ['simulation-session'] }); });
    expect(await screen.findByText(/Sin conexión. Conservamos el último estado/)).toBeInTheDocument();
    expect(screen.getByLabelText('Tu simulación')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pausar' })).toBeDisabled();
    expect(sessionStorage.getItem(simulationStorageKey)).not.toBeNull();
    expect(create).not.toHaveBeenCalled();
    vi.mocked(api.simulationState).mockResolvedValue(managedState());
    await userEvent.click(screen.getByRole('button', { name: /Intentar de nuevo/ }));
    await waitFor(() => expect(screen.queryByText(/Sin conexión. Conservamos/)).not.toBeInTheDocument());
  });

  it('conserva la sesión y la selección cuando falla una actualización de capacidades en segundo plano', async () => {
    restoreSession();
    const { client, create } = setup();
    const current = await screen.findByLabelText('Tu simulación');
    await openAgents();
    const search = screen.getByRole('searchbox', { name: 'Buscar por ID' });
    await userEvent.type(search, 'S-0001');
    vi.mocked(api.simulationCapabilities).mockRejectedValue(new ApiError('No hay red.', 'BACKEND_UNAVAILABLE'));
    await act(async () => { await client.invalidateQueries({ queryKey: ['simulation-capabilities'] }); });
    expect(await screen.findByText(/No pudimos actualizar los escenarios y límites/)).toBeInTheDocument();
    expect(screen.getByLabelText('Tu simulación')).toBe(current);
    expect(screen.getByRole('searchbox', { name: 'Buscar por ID' })).toBe(search);
    expect(search).toHaveValue('S-0001');
    expect(sessionStorage.getItem(simulationStorageKey)).not.toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('limpia errores anteriores de control al recuperar un reinicio exitoso', async () => {
    restoreSession();
    const { control, restart } = setup();
    const pause = await screen.findByRole('button', { name: 'Pausar' });
    control.mockRejectedValueOnce(new ApiError('Transición tardía.', 'INVALID_TRANSITION', 409));
    vi.mocked(api.simulationState).mockResolvedValue(managedState(undefined, { status: 'COMPLETED' }));
    await userEvent.click(pause);
    expect(await screen.findByText('Transición tardía.')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Reiniciar' });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    await waitFor(() => expect(restart).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(sessionStorage.getItem(simulationStorageKey)).toContain('second-independent-id'));
    expect(screen.queryByText('Transición tardía.')).not.toBeInTheDocument();
  });

  it('limpia errores de mutación al abandonar un resultado para configurar otra simulación', async () => {
    restoreSession();
    const { restart } = setup({ state: managedState(undefined, { status: 'COMPLETED' }) });
    restart.mockRejectedValueOnce(new ApiError('Sin cupo para reiniciar.', 'CAPACITY_EXHAUSTED', 503));
    const button = await screen.findByRole('button', { name: 'Reiniciar' });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    expect(await screen.findByText('Sin cupo para reiniciar.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Nueva configuración' }));
    expect(await screen.findByRole('button', { name: 'Iniciar simulación' })).toBeEnabled();
    expect(screen.queryByText('Sin cupo para reiniciar.')).not.toBeInTheDocument();
    expect(sessionStorage.getItem(simulationStorageKey)).toBeNull();
  });

  it('expone capacidad agotada y reutiliza clave idempotente al reintentar la misma configuración', async () => {
    const { create } = setup();
    create.mockRejectedValueOnce(new ApiError('Sin cupo.', 'CAPACITY_EXHAUSTED', 503));
    await userEvent.click(await screen.findByRole('button', { name: 'Iniciar simulación' }));
    expect(await screen.findByText(/Capacidad de ejecución agotada/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar simulación' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[0]![1]).toBe(create.mock.calls[1]![1]);
  });

  it('recupera una sesión anterior de inundación sin crear otra y distingue exposición y referencia', async () => {
    const flood = managedFlood();
    restoreSession();
    const { create } = setup({ state: flood });
    vi.spyOn(api, 'incidents').mockResolvedValue({ incidents: [], total: 0, limit: 100, offset: 0, has_more: false });
    vi.spyOn(api, 'referenceStatus').mockResolvedValue({ schema_version: 1, mode: 'disabled', availability: 'disabled', refreshing: false, provider_status: 'offline', message: 'Referencia deshabilitada.', feature_count: 0, vertex_count: 0, metrics: { queries: 0, provider_errors: 0, cache_hits: 0, cache_misses: 0, last_query_ms: 0, total_query_ms: 0, response_bytes: 0, last_refresh_ms: 0 } });
    expect(create).not.toHaveBeenCalled();
    await screen.findByRole('img', { name: /Red urbana de inundación/ });
    await openAgents();
    expect(screen.getByRole('rowheader', { name: 'F-1' })).toBeInTheDocument();
    expect(document.querySelector('[data-agent-id="F-1"]')).toBeInTheDocument();
    expect(screen.getByTitle('2 rutas recalculadas')).toBeInTheDocument();
    expect(screen.getByText(/Las declaraciones ciudadanas y la referencia territorial/)).toBeInTheDocument();
    expect(document.querySelectorAll('.escape-zombie')).toHaveLength(0);
  });

  it('respeta disponibilidad real de inundación y FULL_MANTA publicada por el backend', async () => {
    setup({ unavailableFlood: true, disabledFull: true });
    await screen.findByRole('button', { name: 'Iniciar simulación' });
    expect(screen.queryByLabelText('Amenaza')).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Inundación urbana/ })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Avanzada experimental.*No disponible/ })).toBeDisabled();
  });
});
