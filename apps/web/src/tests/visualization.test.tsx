import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Graph, Incident } from '@corodev/contracts';
import { AnimatedEntities, catalog, startVisualClock } from '../features/visualization/AnimatedEntities';
import { compatible, direction, entitiesFromFlood, entitiesFromWorld, entityPath, geometryIndex, levelOfDetail, samplePath } from '../features/visualization/model';
import type { Observation, VisualEntity } from '../features/visualization/model';
import { useVisualization, VisualizationControls } from '../features/visualization/useVisualization';
import { observeWorld, sessionLifecycle } from '../features/visualization/observation';
import { ZombieGlyph } from '../features/visualization/ZombieGlyph';
import { FloodMap } from '../features/flood/FloodMap';
import { config } from '../lib/config';
import { hydraulicFixture } from './hydraulic-fixture';
import { graph, managedFlood, managedState, world } from './simulation-fixtures';

const project = (p: { lat: number; lng: number }) => ({ x: p.lng * 10000, y: p.lat * 10000 });
const view = { x: -100, y: -100, width: 300, height: 160 };
const entity: VisualEntity = { key: 'survivor:S1', id: 'S1', kind: 'survivor', node: 'N-0000', state: 'active' };
const observation = (overrides: Partial<Observation> = {}): Observation => ({ id: 'one', graphVersion: graph.version, scenario: 'zombie_outbreak', tick: 1, running: true, connected: true, interval: 2000, entities: [entity], ...overrides });
function layer(value = observation(), active = true, clustering = false) {
  return <svg><AnimatedEntities graph={graph} observation={value} project={project} view={view} active={active} clustering={clustering} /></svg>;
}
function clock() {
  let next = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  vi.spyOn(performance, 'now').mockReturnValue(0);
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => { callbacks.set(++next, callback); return next; });
  vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(id => { callbacks.delete(id); });
  return { callbacks, advance: (at: number) => act(() => { const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach(callback => callback(at)); }) };
}
afterEach(() => vi.restoreAllMocks());

describe('catálogo y datos verificables', () => {
  it('tiene cuatro siluetas distintas y nunca publica un dormido oculto como marcador', () => {
    const data = structuredClone(world);
    data.survivors = [];
    data.zombies = (['walker', 'runner', 'horde', 'sleeper'] as const).map((type, i) => ({ id: `Z${i}`, type, current_node: entity.node, awake: type !== 'sleeper', movement_state: 'resting', path: [entity.node] }));
    expect(entitiesFromWorld(data).map(entity => entity.zombieType)).toEqual(['walker', 'runner', 'horde']);
    const { container, rerender } = render(layer(observation({ entities: entitiesFromWorld(data) }), false));
    expect(container.querySelectorAll('[data-zombie-type]')).toHaveLength(3);
    expect(container.querySelector('[data-agent-id="Z3"]')).not.toBeInTheDocument();
    const silhouettes = [...container.querySelectorAll('[data-zombie-glyph]')].reduce((map, glyph) => map.set(glyph.getAttribute('data-zombie-glyph'), glyph.innerHTML), new Map<string | null, string>());
    expect(silhouettes.size).toBe(4);
    expect(new Set(silhouettes.values()).size).toBe(4);
    expect(container.querySelectorAll('use[data-sprite]')).toHaveLength(3);
    data.zombies[3]!.awake = true;
    rerender(layer(observation({ tick: 2, entities: entitiesFromWorld(data) }), false));
    expect(container.querySelector('[data-agent-id="Z3"]')).toHaveAttribute('data-zombie-type', 'walker');
    expect(container.querySelector('[data-agent-id="Z3"] use')).toHaveAttribute('href', expect.stringContaining('-walker-'));
    rerender(<svg><ZombieGlyph variant="sleeper" /></svg>);
    expect(container.querySelector('[data-zombie-glyph="sleeper"]')).toHaveTextContent('Zz');
  });
  it('verifica hashes, dimensiones PNG, frames, FPS, transparencia, licencia y fallback de cada atlas', () => {
    for (const asset of catalog.assets) {
      const png = readFileSync(`public/visualization/${asset.file}`);
      expect(createHash('sha256').update(png).digest('hex')).toBe(asset.sha256);
      expect(png.readUInt32BE(16)).toBe(asset.frame_width * asset.frames);
      expect(png.readUInt32BE(20)).toBe(asset.frame_height * Math.max(1, asset.directions.length));
      expect([3, 4, 6]).toContain(png[25]); // indexed or alpha PNG; indexed alpha chunk checked below
      if (png[25] === 3) expect(png.includes(Buffer.from('tRNS'))).toBe(true);
      expect(asset.frames).toBe(4); expect(asset.fps).toBe(4);
      expect(asset.anchor.every(v => v >= 0 && v <= 1)).toBe(true);
      expect(asset.license).toBe('CC0-1.0'); expect(asset.source).toMatch(/^https:\/\/opengameart.org\//); expect(asset.fallback).toBeTruthy();
    }
  });
  it('mapea estados reales sin sleepers ocultos ni conversiones decorativas', () => {
    const data = structuredClone(world);
    data.survivors = [{ id: 'S1', current_node: entity.node, status: 'bitten', target_shelter_id: '', planned_route: [] }];
    data.zombies = [{ id: 'hidden', type: 'sleeper', awake: false, current_node: entity.node, movement_state: 'resting', path: [] }, { id: 'horde', type: 'horde', awake: true, current_node: entity.node, movement_state: 'moving', path: [] }];
    expect(entitiesFromWorld(data).map(e => [e.kind, e.state, e.horde])).toEqual([['survivor', 'bitten', undefined], ['zombie', 'moving', true]]);
    expect(entitiesFromFlood(managedFlood().scenario_state)[0]?.state).toBe('waiting');
  });
  it('reserva la transición de mordida a eventos verificables del turno', () => {
    const data = structuredClone(world); data.survivors = [{ id: 'S1', current_node: entity.node, status: 'bitten', target_shelter_id: '', planned_route: [] }];
    expect(entitiesFromWorld(data)[0]?.event).toBeUndefined();
    data.events = [{ turn: data.turn, entity_id: data.survivors[0]!.id, type: 'bitten', edge_id: '', message: '' }];
    expect(entitiesFromWorld(data)[0]?.event).toBe('bitten');
  });
});

describe('recorridos observados', () => {
  it('interpola sólo una arista real con su curva, orientación y extremos', () => {
    const curved = structuredClone(graph);
    curved.edges[0]!.geometry = [{ lat: 0, lng: 0 }, { lat: .0008, lng: .0005 }, { lat: 0, lng: .001 }];
    const index = geometryIndex(curved, project);
    const from = { ...entity, node: curved.edges[0]!.from }, to = { ...entity, node: curved.edges[0]!.to };
    const path = entityPath(from, to, index);
    expect(path).toContainEqual({ x: 5, y: 8 });
    expect(samplePath(path, .5)).toEqual({ x: 5, y: 8 });
    expect(samplePath(path, 2)).toEqual(index.nodes.get(to.node));
    expect(direction(path)).toBe('east');
    expect(entityPath(to, from, index)).toEqual([...path].reverse());
  });
  it('no utiliza planes futuros para salvar huecos, nodos desconocidos o tramos ausentes', () => {
    const index = geometryIndex(graph, project);
    expect(entityPath(entity, { ...entity, node: 'missing' }, index)).toEqual([]);
    expect(entityPath(undefined, entity, index)).toEqual([]);
    expect(entityPath(entity, { ...entity, node: 'N-0001', state: 'evacuated' }, index)).toEqual([]);
    const z = { ...entity, key: 'zombie:Z1', kind: 'zombie' as const, state: 'moving' };
    expect(entityPath(z, { ...z, node: 'N-0001', path: [] }, index)).toEqual([]);
    expect(entityPath(z, { ...z, node: 'N-0001', path: ['wrong', 'N-0001'] }, index)).toEqual([]);
    expect(entityPath(z, { ...z, node: 'N-0001', path: ['N-0000', 'N-0001'] }, index).length).toBeGreaterThan(1);
  });
  it('rechaza aristas paralelas de geometría ambigua', () => {
    const parallel = structuredClone(graph);
    parallel.edges.push({ ...parallel.edges[0]!, id: 'parallel', geometry: [{ lat: 0, lng: 0 }, { lat: .003, lng: .001 }] });
    expect(entityPath(entity, { ...entity, node: 'N-0001' }, geometryIndex(parallel, project))).toEqual([]);
  });
  it('rechaza mundos, sesiones, grafos, escenarios y turnos incompatibles', () => {
    const prior = observation();
    expect(compatible(prior, observation({ tick: 2 }))).toBe(true);
    for (const patch of [{ id: 'two' }, { tick: 3 }, { tick: 1 }, { graphVersion: 'other' }, { scenario: 'urban_flood' }, { running: false }, { connected: false }]) expect(compatible(prior, observation({ tick: 2, ...patch }))).toBe(false);
  });
});

describe('reloj, recursos y ciclo de vida', () => {
  it('sólo RUNNING habilita el reloj y todos los estados finales conservan observación estática', () => {
    for (const status of ['CREATED', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED'] as const) {
      const value = managedState(world, { status });
      const observed = observeWorld(value.snapshot, sessionLifecycle(value, true));
      expect(observed?.running).toBe(status === 'RUNNING');
      expect(observed?.id).toBe(value.simulation_id);
      expect(observed?.tick).toBe(world.turn);
    }
    expect(sessionLifecycle(managedState(), false).connected).toBe(false);
    expect(observeWorld(undefined)).toBeUndefined();
  });
  it('tiene un reloj cancelable y acotado, sin extrapolar al terminar', () => {
    const timer = clock(), update = vi.fn();
    const stop = startVisualClock(update, 1000);
    expect(timer.callbacks.size).toBe(1); timer.advance(500); timer.advance(1500);
    expect(update.mock.calls.map(call => call[0])).toEqual([500, 1000]); expect(timer.callbacks.size).toBe(0); stop();
  });
  it('carga fallida conserva un símbolo SVG accesible', () => {
    const { container } = render(layer());
    const resource = container.querySelector('image[href="/visualization/survivor.png"]')!;
    fireEvent.error(resource);
    expect(container.querySelector('[data-fallback="survivor"]')).toBeInTheDocument();
    expect(container.querySelector('[data-agent-id="S1"]')).toHaveAttribute('aria-label', 'S1 · Activo');
  });
  it('mueve sobre snapshots consecutivos y cancela al pausar, terminar o desmontar', () => {
    const timer = clock(); const { container, rerender, unmount } = render(layer());
    const next = observation({ tick: 2, entities: [{ ...entity, node: 'N-0001' }] });
    rerender(layer(next)); expect(timer.callbacks.size).toBe(1); timer.advance(250);
    expect(container.querySelector('[data-walk-frame]')).toHaveAttribute('x', '-64');
    const position = container.querySelector('[data-agent-id]')!.getAttribute('transform');
    expect(position).not.toBe('translate(10,0)');
    rerender(layer({ ...next, running: false }, false)); expect(timer.callbacks.size).toBe(0);
    const frozen = container.querySelector('[data-agent-id]')!.getAttribute('transform'); timer.advance(700); expect(container.querySelector('[data-agent-id]')).toHaveAttribute('transform', frozen);
    rerender(layer({ ...next, running: true })); expect(timer.callbacks.size).toBe(0); // resume same tick does not replay
    rerender(layer(observation({ tick: 3, entities: [entity] }))); expect(timer.callbacks.size).toBe(1);
    unmount(); expect(timer.callbacks.size).toBe(0);
  });
  it('dos mapas independientes no comparten símbolos, reloj ni entidades', () => {
    const timer = clock();
    const { container, rerender, unmount } = render(<>{layer(observation())}{layer(observation({ id: 'two', entities: [{ ...entity, id: 'S2', key: 's:S2' }] }))}</>);
    const symbols = [...container.querySelectorAll('symbol')].map(s => s.id);
    expect(new Set(symbols).size).toBe(symbols.length);
    rerender(<>{layer(observation({ tick: 2, entities: [{ ...entity, node: 'N-0001' }] }))}{layer(observation({ id: 'two', entities: [{ ...entity, id: 'S2', key: 's:S2' }] }))}</>);
    expect(timer.callbacks.size).toBe(1);
    timer.advance(300);
    expect(container.querySelector('[data-agent-id="S2"]')).toHaveAttribute('transform', 'translate(0,0)');
    unmount(); expect(timer.callbacks.size).toBe(0);
  });
  it('suprime entidades cuando la topología no coincide con el snapshot', () => {
    const { container } = render(layer(observation({ graphVersion: 'other' })));
    expect(container.querySelector('[data-agent-id]')).not.toBeInTheDocument();
  });
  it('limita a 120 entidades animadas con un único reloj y deja el resto estático', () => {
    const timer = clock();
    const many = Array.from({ length: 130 }, (_, i) => ({ ...entity, id: `S${i}`, key: `survivor:S${i}` }));
    const { container, rerender, unmount } = render(layer(observation({ entities: many })));
    rerender(layer(observation({ tick: 2, entities: many.map(e => ({ ...e, node: 'N-0001' })) })));
    expect(timer.callbacks.size).toBe(1); timer.advance(250);
    expect(container.querySelectorAll('use[data-sprite][href$="-walk"]')).toHaveLength(120);
    expect(container.querySelectorAll('use[data-sprite][href$="-idle"]')).toHaveLength(10);
    unmount(); expect(timer.callbacks.size).toBe(0);
  });
  it('sólo anima ondas visibles a zoom cercano y comparte sus cuatro frames', () => {
    const timer = clock(); const empty = observation({ entities: [] });
    const draw = (waterPoints: { x: number; y: number }[], active = true) => <svg><AnimatedEntities graph={graph} observation={empty} project={project} view={view} active={active} clustering water waterPoints={waterPoints} /></svg>;
    const { container, rerender } = render(draw([{ x: 9999, y: 9999 }]));
    expect(timer.callbacks.size).toBe(0);
    rerender(draw([{ x: 10, y: 10 }])); expect(timer.callbacks.size).toBe(1);
    timer.advance(250); expect(container.querySelector('[data-water-frame]')).toHaveAttribute('x', '-32');
    rerender(draw([{ x: 10, y: 10 }], false)); expect(timer.callbacks.size).toBe(0);
  });
  it('el cambio de ID, reinicio, desconexión y saltos de turnos no reproducen el movimiento anterior', () => {
    const timer = clock(); const { rerender } = render(layer());
    rerender(layer(observation({ id: 'two', tick: 2, entities: [{ ...entity, node: 'N-0001' }] })));
    expect(timer.callbacks.size).toBe(0);
    rerender(layer(observation({ id: 'two', tick: 6, entities: [entity] })));
    expect(timer.callbacks.size).toBe(0);
    rerender(layer(observation({ id: 'two', tick: 7, connected: false, entities: [{ ...entity, node: 'N-0001' }] }), false));
    expect(timer.callbacks.size).toBe(0);
  });
  it('las preferencias de movimiento y pestaña oculta detienen efectos y limpian listeners', () => {
    const media = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal('matchMedia', () => media);
    function Controls() { const controls = useVisualization(observation()); return <><VisualizationControls controls={controls} /><output>{String(controls.active)}</output></>; }
    const { unmount } = render(<Controls />);
    expect(screen.getByRole('status')).toHaveTextContent('false');
    expect(screen.getByText(/Movimiento reducido/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Animaciones')); expect(screen.getByLabelText('Animaciones')).not.toBeChecked();
    unmount(); expect(media.removeEventListener).toHaveBeenCalled(); vi.unstubAllGlobals();
  });
});

describe('LOD y separación de fuentes', () => {
  it('conserva tipos de zombi separados incluso al agrupar en el mismo nodo', () => {
    const threats: VisualEntity[] = (['walker', 'runner', 'horde'] as const).flatMap(zombieType => [1, 2].map(i => ({ ...entity, id: `${zombieType}${i}`, key: `${zombieType}${i}`, kind: 'zombie', zombieType })));
    const grouped = levelOfDetail(threats, new Map([[entity.node, { x: 10, y: 10 }]]), { ...view, width: 900 }, true);
    expect(grouped).toHaveLength(3);
    expect(grouped.map(group => group.members.length)).toEqual([2, 2, 2]);
    expect(grouped.every(group => new Set(group.members.map(entity => entity.zombieType)).size === 1)).toBe(true);
  });
  it('agrupa cantidades exactas en nodos observados y filtra fuera del viewport', () => {
    const entities = Array.from({ length: 1000 }, (_, i) => ({ ...entity, id: String(i), key: `s:${i}` }));
    const nodes = new Map([[entity.node, { x: 10, y: 10 }]]);
    const far = levelOfDetail(entities, nodes, { ...view, width: 900 }, true);
    expect(far).toHaveLength(1); expect(far[0]!.members).toHaveLength(1000); expect(far[0]!.point).toEqual(nodes.get(entity.node));
    expect(levelOfDetail(entities.slice(0, 10), nodes, view, true)).toHaveLength(1); // same observed node stays counted at close zoom
    expect(levelOfDetail(entities.slice(0, 10), nodes, view, false)).toHaveLength(10);
    expect(levelOfDetail(entities, nodes, { ...view, x: 2000 }, true)).toHaveLength(0);
    expect(levelOfDetail(entities, nodes, view, false)).toHaveLength(1); // mandatory load reduction above configured budget
  });
  it('una horda no inventa integrantes y los finales no se mezclan con activos', () => {
    const nodes = new Map([[entity.node, { x: 10, y: 10 }]]);
    expect(levelOfDetail([entity, { ...entity, key: 'final', state: 'evacuated' }], nodes, { ...view, width: 900 }, true)).toHaveLength(2);
    const { container } = render(layer(observation({ entities: [{ ...entity, kind: 'zombie', horde: true }] })));
    expect(container.querySelector('[data-agent-id]')).toHaveAttribute('aria-label', expect.stringContaining('1 horda (integrantes no publicados)'));
  });
  it('representa riesgo y restricción desde el contrato y reportes puntuales independientes', () => {
    config.osmTilesEnabled = false;
    const state = managedFlood().scenario_state!;
    state.hydraulic = hydraulicFixture();
    state.road_conditions = [{ edge_id: graph.edges[0]!.id, state: 'caution', risk_score: .9, risk_source: 'synthetic', cost_multiplier: 2, updated_at_simulation_step: 3 }];
    const incident = { incident_id: 'report', incident_type: 'road_closed', source_type: 'citizen', verification_status: 'pending', latitude: graph.nodes[0]!.lat, longitude: graph.nodes[0]!.lng, description: 'Declaración', event_time: '2026-10-27T10:00:00Z', expires_at: '2026-10-28T10:00:00Z' } as Incident;
    const { container } = render(<FloodMap graph={graph as Graph} scenario={state} shelters={graph.shelters} candidates={[]} selectedAgentId="" onSelectAgent={() => undefined} onPickPosition={() => undefined} incidents={[incident]} />);
    expect(container.querySelector('[data-road-state="caution"]')?.getAttribute('d')).toBeTruthy();
    expect(container.querySelector('[data-road-state="blocked"]')?.getAttribute('d')).toBe('');
    expect(container.querySelector('.flood-index-high.flood-water-cell')).toBeInTheDocument();
    expect(container.querySelector('[data-incident-id="report"]')).toHaveAttribute('data-incident-source', 'citizen');
    expect(container.querySelector('[data-incident-id="report"] title')).toHaveTextContent('Pendiente de verificación');
    expect(container.querySelector('[data-incident-id="report"] title')).toHaveTextContent('no modifica esta simulación');
    expect(state.agents).toHaveLength(1);
  });
});
