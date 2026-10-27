import { readFileSync } from 'node:fs';
import type { Graph, SimulationCapabilities, SimulationCreated, SimulationState, WorldSnapshot, SimulationResults } from '@corodev/contracts';
import { config } from '../lib/config';
import { simulationStorageKey } from '../services/simulation';

export const graph = JSON.parse(readFileSync('../../packages/contracts/examples/graph.json', 'utf8')) as Graph;
export const world = JSON.parse(readFileSync('../../packages/contracts/examples/world.json', 'utf8')) as WorldSnapshot;
export const capabilities: SimulationCapabilities = {
  scenarios: [{ id: 'zombie_outbreak', name: 'Brote zombie', available: true, synthetic: true }, { id: 'urban_flood', name: 'Inundación urbana', available: true, synthetic: true }],
  graph_profiles: [{ id: 'BASE', name: 'BASE', available: true, graph_version: graph.version, nodes: 300, edges: 383 }, { id: 'FULL_MANTA', name: 'FULL_MANTA', available: true, graph_version: 'master', nodes: 9179, edges: 13452 }],
  defaults: { scenario: 'zombie_outbreak', graph_profile: 'BASE', seed: 20261026, max_ticks: 150, tick_interval_ms: 2000, survivors: 20, round: 'round1' },
  limits: { max_active: 2, max_full_active: 1, max_retained: 10, max_memory_bytes: 100000000, min_tick_interval_ms: 1000, max_tick_interval_ms: 5000, min_ticks: 30, max_ticks: 3000, official_max_ticks: 150, max_survivors: 200 },
  rounds: [{ id: 'round1', name: 'Ronda 1', survivors: 20, turns: 150 }, { id: 'round2', name: 'Ronda 2', survivors: 80, turns: 150 }],
};
export function managedState(snapshot: WorldSnapshot = world, overrides: Partial<SimulationState> = {}): SimulationState {
  return { simulation_id: 'private-simulation-id', status: 'RUNNING', tick: snapshot.turn, max_ticks: 150, state_version: snapshot.world_version, scenario: 'zombie_outbreak', graph_profile: 'BASE', graph_version: snapshot.graph_version, seed: 20261026, tick_interval_ms: 2000, created_at: '2026-10-27T10:00:00Z', started_at: '2026-10-27T10:00:00Z', updated_at: '2026-10-27T10:00:02Z', expires_at: '2026-10-27T10:15:00Z', config: { mode: 'experimental', zombie_policy: 'classic_random', evacuation_algorithm: 'legacy_current', survivors: 20, round: 'round1', refuge_ids: graph.shelters.map(shelter => shelter.id) }, snapshot, ...overrides };
}
export function created(state = managedState()): SimulationCreated {
  const { snapshot: _snapshot, scenario_state: _scenario, ...metadata } = state;
  return { ...metadata, access_token: 'opaque-private-test-token' };
}
export function results(state: SimulationState): SimulationResults {
  return { ...state, results: { initial_survivors: 20, evacuated: 12, bitten: 3, active: 5, survival_rate: .85, refuges_used: 2 } };
}
export function restoreSession(id = 'private-simulation-id') {
  sessionStorage.setItem(simulationStorageKey, JSON.stringify({ simulation_id: id, access_token: 'opaque-private-test-token', endpoint: config.worldApiBaseUrl }));
}
export const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
export const errorResponse = (status: number, message: string) => json({ error: { code: 'TEST_ERROR', message, requestId: 'request-test', details: [] } }, status);
export function managedFlood(): SimulationState {
  const base = managedState();
  return { ...base, scenario: 'urban_flood', scenario_state: {
    scenario_type: 'urban_flood', simulation_step: base.tick, world_version: base.state_version, graph_version: graph.version,
    simulation_time: 3, simulation_duration: 150, time_step: 1, rainfall: .8,
    flood_zones: [{ id: 'synthetic', center: graph.nodes[0]!, radius_m: 100, intensity: .8 }],
    road_conditions: [], shelter_conditions: graph.shelters.map(shelter => ({ shelter_id: shelter.id, state: 'available', risk_score: 0, updated_at_simulation_step: base.tick })),
    agents: [{ id: 'F-1', current_node: graph.nodes[0]!.id, target_shelter_id: graph.shelters[0]!.id, state: 'waiting', behavior: 'preventive', planned_route: [] }],
    evacuation_metrics: { total_agents: 1, evacuated_agents: 0, isolated_agents: 0, waiting_agents: 1, average_evacuation_time: 0, blocked_edges: 0, caution_edges: 0, shelters_at_capacity: 0, reroute_count: 2, simulation_total_duration: 3 },
    performance: { simulation_step_latency_ms: 1, simulation_total_duration_ms: 3 },
    data_provenance: { graph_source: graph.source, model: 'synthetic-test', elevation_source: 'unavailable', disclaimer: 'Modelo sintético; no es pronóstico.' },
  } };
}
