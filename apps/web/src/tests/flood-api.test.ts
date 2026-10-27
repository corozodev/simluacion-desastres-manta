import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Graph, LabComparison, LabRunConfig, LabState, ScenarioSnapshot } from '@corodev/contracts';
import { api } from '../services/api';
import { config, readConfig } from '../lib/config';
import { hydraulicFixture } from './hydraulic-fixture';

const graph = JSON.parse(readFileSync('../../packages/contracts/examples/graph.json', 'utf8')) as Graph;
const originalConfig = { ...config };
const candidates = graph.shelters.map(shelter => {
  const node = graph.nodes.find(node => node.id === shelter.node_id)!;
  return { id: shelter.id, label: `Candidato ${shelter.id}`, lat: node.lat, lng: node.lng, capacity: shelter.capacity };
});
const runConfig: LabRunConfig = { mode: 'competition', seed: 42, rainfall_profile: 'storm', hydraulic_model: 'rainfall_runoff_2d', rainfall_intensity: .8, simulation_duration: 150, evacuation_behavior: 'preventive', agents: 1, interval_ms: 500, shelters: candidates };
const metrics = { total_agents: 1, evacuated_agents: 0, isolated_agents: 0, waiting_agents: 1, average_evacuation_time: 0, blocked_edges: 1, caution_edges: 0, shelters_at_capacity: 0, reroute_count: 0, simulation_total_duration: 3 };
const scenario: ScenarioSnapshot = {
  scenario_type: 'urban_flood', simulation_step: 3, world_version: 7, graph_version: graph.version,
  simulation_time: 3, simulation_duration: 150, time_step: 1, rainfall: .8,
  flood_zones: [{ id: 'test-synthetic-zone', center: { lat: graph.nodes[0]!.lat, lng: graph.nodes[0]!.lng }, radius_m: 150, intensity: .4 }],
  road_conditions: [{ edge_id: graph.edges[0]!.id, state: 'blocked', risk_score: .8, risk_source: 'synthetic_urban_flood', cost_multiplier: 1, updated_at_simulation_step: 3 }],
  shelter_conditions: graph.shelters.map(shelter => ({ shelter_id: shelter.id, state: 'available', risk_score: 0, updated_at_simulation_step: 3 })),
  agents: [{ id: 'S-0001', current_node: graph.nodes[0]!.id, state: 'waiting', behavior: 'preventive', target_shelter_id: '', planned_route: [graph.nodes[0]!.id] }],
  evacuation_metrics: metrics, performance: { simulation_step_latency_ms: 1, simulation_total_duration_ms: 3 },
  data_provenance: { graph_source: graph.source, model: 'synthetic-test', elevation_source: 'unavailable', disclaimer: 'Simulación de prueba con parámetros sintéticos.' },
};
const state: LabState = {
  run_id: 'a'.repeat(32), state: 'paused', mode: 'competition', graph_version: graph.version, config: runConfig, scenario,
  shelters: graph.shelters, timeline: [{ step: 3, simulation_time: 3, evacuation_metrics: metrics, step_latency_ms: 1 }],
  origins: [{ id: 'S-0001', node_id: graph.nodes[0]!.id, lat: graph.nodes[0]!.lat, lng: graph.nodes[0]!.lng, snap_distance_m: 0 }],
};
function response(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status }); }
function comparison(): LabComparison {
  return { id: 'comparison-1', state: 'finished', progress: 2, message: 'Comparación medida.', results: ['original', 'custom'].map(strategy => ({ strategy: strategy as 'original' | 'custom', mode: 'competition', seed: 42, graph_version: graph.version, total_agents: 1, evacuated_percentage: 0, evacuation_metrics: metrics, step_latency_ms: 1, origins_hash: 'same-origins', config_hash: 'same-controls' })) };
}

afterEach(() => { vi.restoreAllMocks(); Object.assign(config, originalConfig); });

describe('contrato HTTP del laboratorio de inundación', () => {
  it('valida profundidad, dimensiones y balance antes de aceptar una malla hidráulica', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const hydraulic = hydraulicFixture();
    fetch.mockResolvedValueOnce(response({ ...state, scenario: { ...scenario, hydraulic } }));
    await expect(api.floodState()).resolves.toHaveProperty('scenario.hydraulic.mass_balance.residual_m3', 0);
    for (const invalid of [
      { ...hydraulic, depths_m: [-.01, 0, 0, 0] },
      { ...hydraulic, depths_m: [0] },
      { ...hydraulic, grid: { ...hydraulic.grid, rows: 4096, cols: 4096 } },
      { ...hydraulic, mass_balance: { ...hydraulic.mass_balance, stored_m3: -1 } },
    ]) {
      fetch.mockResolvedValueOnce(response({ ...state, scenario: { ...scenario, hydraulic: invalid } }));
      await expect(api.floodState()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    }
  });

  it('usa una URL propia para flood sin cambiar el origen zombie ni enviar claves de movimiento', async () => {
    config.worldApiBaseUrl = 'http://127.0.0.1:8080';
    config.floodApiBaseUrl = 'http://127.0.0.1:8082';
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => response(state));
    await expect(api.floodState()).resolves.toMatchObject({ run_id: state.run_id, scenario: { scenario_type: 'urban_flood' } });
    expect(fetch.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8082/lab/state');
    expect(fetch.mock.calls[0]?.[1]?.credentials).toBeUndefined();
    expect(fetch.mock.calls[0]?.[1]?.headers).not.toHaveProperty('x-api-key');
    expect(config.worldApiBaseUrl).toBe('http://127.0.0.1:8080');
  });

  it('controla tormentas sin cookies, operador ni CSRF y conserva las validaciones de negocio', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => response(state));
    await api.startFlood(runConfig, state.run_id);
    await api.floodAction('pause', state.run_id);
    await api.floodAction('speed', state.run_id, 250);
    await api.compareFlood(runConfig, state.run_id);
    expect(fetch.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual(['/lab/runs', '/lab/actions', '/lab/actions', '/lab/comparisons']);
    for (const [, init] of fetch.mock.calls) {
      expect(init).toMatchObject({ method: 'POST', credentials: 'omit' });
      expect(init?.headers).not.toHaveProperty('X-CSRF-Token');
      expect(init?.headers).not.toHaveProperty('x-api-key');
    }
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({ config: runConfig, expected_run_id: state.run_id });
    expect(JSON.parse(String(fetch.mock.calls[2]?.[1]?.body))).toEqual({ action: 'speed', expected_run_id: state.run_id, interval_ms: 250 });
    expect(localStorage.length + sessionStorage.length).toBe(0);
  });

  it('mantiene identidad de ejecución en el grafo y separa la previsualización del motor', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => response(graph));
    await api.floodGraph(undefined, { runId: 'active-run' });
    await api.floodGraph(undefined, { mode: 'full' });
    expect(new URL(String(fetch.mock.calls[0]?.[0])).search).toBe('?run_id=active-run');
    expect(new URL(String(fetch.mock.calls[1]?.[0])).search).toBe('?mode=full');
    expect(fetch.mock.calls.every(([, init]) => init?.method === undefined)).toBe(true);
  });

  it('acepta una validación negativa explicada sin convertirla en una asignación imposible', async () => {
    const validated = candidates.map(candidate => ({ ...candidate, node_id: '', snapped_lat: 0, snapped_lng: 0, snap_distance_m: 999, valid: false, message: 'El punto supera la distancia máxima de ajuste.' }));
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ valid: false, candidates: validated }));
    const result = await api.validateFloodCandidates('competition', candidates);
    expect(result.valid).toBe(false);
    expect(result.candidates[0]?.message).toContain('distancia máxima');
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({ mode: 'competition', candidates });
  });

  it('rechaza coordenadas, exposición o cantidades que romperían la visualización', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    for (const invalid of [
      { ...state, scenario: { ...scenario, flood_zones: [{ ...scenario.flood_zones[0], intensity: 1.1 }] } },
      { ...state, scenario: { ...scenario, agents: [] } },
      { ...state, graph_version: 'different-graph' },
      { ...state, config: { ...runConfig, shelters: candidates.slice(0, 3) } },
    ]) {
      fetch.mockResolvedValueOnce(response(invalid));
      await expect(api.floodState()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    }
  });

  it('valida A/B con el mismo denominador, semilla, origen y parámetros', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ ...state, comparison: comparison() }));
    await expect(api.floodState()).resolves.toHaveProperty('comparison.state', 'finished');
    for (const field of ['origins_hash', 'config_hash', 'seed'] as const) {
      const mismatch = comparison();
      Object.assign(mismatch.results[1]!, { [field]: field === 'seed' ? 43 : 'mismatch' });
      fetch.mockResolvedValueOnce(response({ ...state, comparison: mismatch }));
      await expect(api.floodState()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    }
    const denominator = comparison();
    denominator.results[1]!.evacuated_percentage = 50;
    fetch.mockResolvedValueOnce(response({ ...state, comparison: denominator }));
    await expect(api.floodState()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('propaga fallos de la API con request ID para reintentos y explicación de conflictos', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ error: { code: 'RUN_CHANGED', message: 'La ejecución cambió.', requestId: 'flood-conflict', details: [] } }, 409));
    await expect(api.floodAction('pause', state.run_id)).rejects.toMatchObject({ status: 409, code: 'RUN_CHANGED', requestId: 'flood-conflict' });
  });
});

describe('configuración pública del laboratorio', () => {
  it('acepta origen local explícito y mantiene los raster OSM deshabilitados para QA', () => {
    const configured = readConfig({ VITE_FLOOD_API_BASE_URL: 'http://127.0.0.1:8082/', VITE_OSM_TILES_ENABLED: 'false' });
    expect(configured.floodApiBaseUrl).toBe('http://127.0.0.1:8082');
    expect(configured.osmTilesEnabled).toBe(false);
    expect(configured.worldApiBaseUrl).toBe('https://api.sistemamanta.lexinnovate.com');
  });

  it('rechaza URLs flood con credenciales sin reflejar el secreto y conserva el cliente zombie', () => {
    const configured = readConfig({ VITE_FLOOD_API_BASE_URL: 'https://user:private-value@example.com?token=private-value' });
    expect(configured.floodError).toBeDefined();
    expect(JSON.stringify(configured)).not.toContain('private-value');
    expect(configured.floodApiBaseUrl).toBe('');
    expect(configured.worldApiBaseUrl).toBe('https://api.sistemamanta.lexinnovate.com');
  });
});
