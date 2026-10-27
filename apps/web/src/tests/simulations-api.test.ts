import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../services/api';
import { capabilities, created, errorResponse, json, managedFlood, managedState, results } from './simulation-fixtures';

afterEach(() => vi.restoreAllMocks());

describe('adaptador HTTP privado de simulaciones', () => {
  it('descubre capacidades sin enviar credenciales ni crear trabajo', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(capabilities));
    await expect(api.simulationCapabilities()).resolves.toEqual(capabilities);
    expect(String(fetch.mock.calls[0]![0])).toMatch(/\/v1\/simulations\/capabilities$/);
    expect(fetch.mock.calls[0]![1]?.headers).not.toHaveProperty('Authorization');
    expect(fetch.mock.calls[0]![1]?.method).toBeUndefined();
  });
  it('envía clave idempotente sólo en creación y reinicio; autorización Bearer en todas las rutas privadas', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(created()));
    await api.createSimulation({ scenario: 'zombie_outbreak', graph_profile: 'BASE', seed: 1, max_ticks: 150, tick_interval_ms: 2000 }, 'test-key');
    expect(fetch.mock.calls[0]![1]).toMatchObject({ method: 'POST', headers: { 'Idempotency-Key': 'test-key' } });
    fetch.mockImplementation(async () => json(managedState()));
    await api.simulationState('private-id', 'opaque-token');
    await api.controlSimulation('private-id', 'opaque-token', 'pause');
    fetch.mockResolvedValue(json(results(managedState(undefined, { status: 'COMPLETED' }))));
    await api.simulationResults('private-id', 'opaque-token');
    fetch.mockResolvedValue(json(created()));
    await api.restartSimulation('private-id', 'opaque-token', 'restart-key');
    for (const [url, init] of fetch.mock.calls.slice(1)) {
      expect(String(url)).not.toContain('opaque-token');
      expect(new URL(String(url)).search).toBe('');
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer opaque-token' });
      expect(init?.credentials).toBeUndefined();
      expect(init?.headers).not.toHaveProperty('X-CSRF-Token');
    }
    expect(fetch.mock.calls[4]![1]?.headers).toMatchObject({ 'Idempotency-Key': 'restart-key' });
  });
  it.each([400, 401, 403, 404, 409, 410, 429, 503])('conserva errores estructurados y request ID (%s)', async status => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(errorResponse(status, 'Error controlado.'));
    await expect(api.simulationState('private-id', 'opaque-token')).rejects.toMatchObject({ status, message: 'Error controlado.', requestId: 'request-test' });
  });
  it('rechaza snapshots sin topología coherente y creación sin credencial privada', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(managedState(undefined, { graph_version: 'wrong-graph' })));
    await expect(api.simulationState('private-id', 'opaque-token')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    fetch.mockResolvedValue(json(managedState()));
    await expect(api.createSimulation({ scenario: 'zombie_outbreak', graph_profile: 'BASE', seed: 1, max_ticks: 150, tick_interval_ms: 2000 }, 'key')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('valida inundaciones con refugios seleccionados y exige el snapshot real de su motor', async () => {
    const flood = managedFlood();
    flood.scenario_state!.shelter_conditions = flood.scenario_state!.shelter_conditions.slice(0, 1);
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(flood));
    await expect(api.simulationState('private-id', 'opaque-token')).resolves.toMatchObject({ scenario: 'urban_flood' });
    fetch.mockResolvedValue(json({ ...flood, scenario_state: undefined }));
    await expect(api.simulationState('private-id', 'opaque-token')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('rechaza capacidades vehiculares y predicciones inválidas, conservando el contrato sin extensiones', async () => {
    const state = managedState();
    const vehicle = { id: 'V-1', current_node: 'n-1', path: ['n-1'], passenger_ids: ['a', 'b', 'c', 'd', 'e'], target_survivor_id: '', target_shelter_id: '', state: 'transporting', capacity: 4 };
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ ...state, snapshot: { ...state.snapshot, fleet: [vehicle] } }));
    await expect(api.simulationState('private-id', 'opaque-token')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    fetch.mockResolvedValue(json({ ...state, runner_forecast: { turn: state.tick, horizon: 2, node_risks: [{ node_id: 'n-1', one_turn_probability: 1.1, two_turn_probability: .2 }], edge_risks: [] } }));
    await expect(api.simulationState('private-id', 'opaque-token')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    fetch.mockResolvedValue(json(state));
    await expect(api.simulationState('private-id', 'opaque-token')).resolves.toMatchObject({ simulation_id: state.simulation_id });
  });

});

describe('observación pública sin credenciales', () => {
  it('consulta la referencia compartida, reutiliza ETag y acepta 304 sin crear una sesión', async () => {
    const state = managedState();
    const published = { scenario: 'zombie_outbreak', availability: 'available', simulation: state };
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify(published), { headers: { ETag: 'W/"published-test-v1"' } })).mockResolvedValueOnce(new Response(null, { status: 304 }));
    await expect(api.publishedSimulation('zombie_outbreak')).resolves.toEqual(published);
    await expect(api.publishedSimulation('zombie_outbreak')).resolves.toEqual(published);
    expect(fetch.mock.calls[1]![1]?.headers).toMatchObject({ 'If-None-Match': 'W/"published-test-v1"' });
    for (const [url, init] of fetch.mock.calls) {
      expect(new URL(String(url)).pathname).toBe('/v1/simulations/published/zombie_outbreak');
      expect(init?.method).toBeUndefined(); expect(init?.credentials).toBe('omit');
      expect(init?.headers).not.toHaveProperty('Authorization');
      expect(init?.headers).not.toHaveProperty('x-api-key');
    }
  });
  it('rechaza una credencial privada o un escenario distinto en una publicación', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    for (const invalid of [
      { scenario: 'zombie_outbreak', availability: 'available', simulation: { ...managedState(), access_token: 'must-not-be-public' } },
      { scenario: 'urban_flood', availability: 'available', simulation: managedState() },
      { scenario: 'zombie_outbreak', availability: 'none', simulation: managedState() },
    ]) {
      fetch.mockResolvedValueOnce(json(invalid));
      await expect(api.publishedSimulation('zombie_outbreak')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    }
  });
});
