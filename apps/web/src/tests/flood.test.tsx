import { readFileSync } from 'node:fs';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Graph, LabCandidate, ScenarioSnapshot } from '@corodev/contracts';
import { FloodMap } from '../features/flood/FloodMap';
import { config } from '../lib/config';

const osmTilesEnabled = config.osmTilesEnabled;
const fixture: Graph = {
  version: 'synthetic-flood-map-test', source: 'Synthetic component fixture; no real flood conditions',
  nodes: [{ id: 'A', lat: -1, lng: -80 }, { id: 'B', lat: -1, lng: -79.999 }, { id: 'C', lat: -.999, lng: -79.999 }, { id: 'D', lat: -.999, lng: -80 }],
  edges: [['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'A']].map(([from, to], i) => ({ id: `E${i + 1}`, from: from!, to: to!, distance_m: 100, speed_mps: 1.4, road_type: 'residential', blocked: false, directed: false })),
  shelters: ['A', 'B', 'C', 'D'].map((node_id, i) => ({ id: `R${i + 1}`, node_id, capacity: 10, occupancy: 0, reserved: 0, available: 10 })),
};
const candidates: LabCandidate[] = fixture.nodes.map((node, i) => ({ id: `C${i + 1}`, label: `Candidato de prueba ${i + 1}`, lat: node.lat, lng: node.lng, capacity: 10 }));
const scenario: ScenarioSnapshot = {
  scenario_type: 'urban_flood', simulation_step: 8, world_version: 17, graph_version: fixture.version,
  simulation_time: 8, simulation_duration: 150, time_step: 1, rainfall: .8,
  flood_zones: [{ id: 'synthetic-zone', center: { lat: fixture.nodes[0]!.lat, lng: fixture.nodes[0]!.lng }, radius_m: 50, intensity: .8 }],
  road_conditions: [{ edge_id: 'E1', state: 'blocked', risk_score: .8, risk_source: 'synthetic_urban_flood', cost_multiplier: 1, updated_at_simulation_step: 8 }, { edge_id: 'E2', state: 'caution', risk_score: .4, risk_source: 'synthetic_urban_flood', cost_multiplier: 3, updated_at_simulation_step: 8 }],
  shelter_conditions: fixture.shelters.map((shelter, i) => ({ shelter_id: shelter.id, state: i === 0 ? 'exposed' : 'available', risk_score: i === 0 ? .8 : 0, updated_at_simulation_step: 8 })),
  agents: [{ id: 'S1', current_node: 'A', state: 'moving', behavior: 'preventive', target_shelter_id: 'R4', planned_route: ['A', 'D'] }],
  evacuation_metrics: { total_agents: 1, evacuated_agents: 0, isolated_agents: 0, waiting_agents: 0, average_evacuation_time: 0, blocked_edges: 1, caution_edges: 1, shelters_at_capacity: 0, reroute_count: 1, simulation_total_duration: 8 },
  performance: { simulation_step_latency_ms: 1, simulation_total_duration_ms: 8 },
  data_provenance: { graph_source: fixture.source, model: 'synthetic-test', elevation_source: 'unavailable', disclaimer: 'Simulación de prueba con parámetros sintéticos.' },
};

afterEach(() => { vi.restoreAllMocks(); config.osmTilesEnabled = osmTilesEnabled; });
function setup(overrides: Partial<Parameters<typeof FloodMap>[0]> = {}) {
  config.osmTilesEnabled = false;
  const pickPosition = vi.fn<(point: { lat: number; lng: number }) => void>();
  const props = { graph: fixture, scenario, shelters: fixture.shelters, candidates, selectedAgentId: 'S1', onSelectAgent: vi.fn(), onPickPosition: pickPosition, ...overrides };
  render(<FloodMap {...props} />);
  return { ...props, pickPosition };
}

describe('capas y selección del mapa de inundación', () => {
  it('mantiene ocho capas independientes, exposición y rutas publicadas sin representar resultados de muerte', async () => {
    setup();
    const map = screen.getByRole('img', { name: /^Red urbana de inundación simulada/ });
    expect(screen.getAllByRole('checkbox')).toHaveLength(9);
    expect(screen.getByRole('checkbox', { name: 'Susceptibilidad oficial a inundaciones' })).not.toBeChecked();
    expect(map.querySelectorAll('[data-road-state]')).toHaveLength(3);
    expect(map.querySelector('.flood-exposure-zone')).toBeInTheDocument();
    expect(map.querySelector('[data-layer="routes"]')).toBeInTheDocument();
    expect(map.querySelector('.flood-shelter-exposed')).toBeInTheDocument();
    expect(map.querySelectorAll('[data-candidate]')).toHaveLength(4);
    expect(map.querySelector('image')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Calles bloqueadas' }));
    expect(map.querySelector('[data-road-state="blocked"]')).not.toBeInTheDocument();
    expect(map.querySelector('[data-road-state="caution"]')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Exposición a inundación' }));
    expect(map.querySelector('[data-layer="exposure"]')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Rutas de evacuación' }));
    expect(map.querySelector('[data-layer="routes"]')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Agentes' }));
    expect(map.querySelector('[data-layer="agents"]')).not.toBeInTheDocument();
    expect(map.querySelector('[data-layer="shelters"]')).toBeInTheDocument();
    expect(screen.queryByText(/mordido|zombified/i)).not.toBeInTheDocument();
  });

  it('inspecciona una calle con clic y publica riesgo, origen y paso del overlay real', () => {
    setup();
    const map = screen.getByRole('img', { name: /^Red urbana de inundación simulada/ });
    const path = map.querySelector('[data-road-state="blocked"]')!.getAttribute('d')!;
    const segment = /^M([-\d.]+),([-\d.]+)L([-\d.]+),([-\d.]+)/.exec(path)!;
    fireEvent.click(map, { clientX: (Number(segment[1]) + Number(segment[3])) / 2, clientY: (Number(segment[2]) + Number(segment[4])) / 2 });
    const details = screen.getByLabelText('Detalle de arista E1');
    expect(details).toHaveTextContent('Bloqueada');
    expect(details).toHaveTextContent('0.800');
    expect(details).toHaveTextContent('synthetic_urban_flood');
    expect(details).toHaveTextContent('Actualizada en paso8');
  });

  it('permite señalar un candidato en el mapa y navegar por teclado conservando geometría OSM', async () => {
    const props = setup({ pickingCandidate: 1 });
    const map = screen.getByRole('img', { name: /^Red urbana de inundación simulada/ });
    fireEvent.click(map, { clientX: 450, clientY: 240 });
    expect(props.pickPosition).toHaveBeenCalledWith(expect.objectContaining({ lat: expect.any(Number), lng: expect.any(Number) }));
    const point = props.pickPosition.mock.calls[0]![0];
    expect(point.lat).toBeGreaterThan(-1); expect(point.lat).toBeLessThan(-.999);
    expect(point.lng).toBeGreaterThan(-80); expect(point.lng).toBeLessThan(-79.999);
    const view = map.getAttribute('viewBox');
    fireEvent.keyDown(map, { key: 'ArrowRight' });
    expect(map.getAttribute('viewBox')).not.toBe(view);
    await userEvent.click(screen.getByRole('button', { name: 'Restablecer mapa de inundación' }));
    expect(map.getAttribute('viewBox')).toBe(view);
  });

  it('representa el maestro real en tres paths de calles y no crea miles de objetos React', () => {
    const master = JSON.parse(readFileSync('../../services/evacuation/data/manta-master.json', 'utf8')) as Graph;
    setup({ graph: master, scenario: undefined, shelters: master.shelters, candidates: [], selectedAgentId: '' });
    const map = screen.getByRole('img', { name: /^Red urbana de inundación simulada/ });
    expect(master.nodes).toHaveLength(9179); expect(master.edges).toHaveLength(13452);
    expect(map.querySelectorAll('[data-road-state]')).toHaveLength(3);
    expect(map.querySelector('[data-road-state="passable"]')!.getAttribute('d')!.length).toBeGreaterThan(100000);
    expect(map.querySelectorAll('*').length).toBeLessThan(100);
  });
});
