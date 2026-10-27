import { useMemo, useRef, useState } from 'react';
import type { GeoPoint, Graph, GraphEdge, LabCandidate, LabCandidateValidation, ScenarioSnapshot, Shelter } from '@corodev/contracts';
import { Button } from '../../components/ui';
import { config } from '../../lib/config';

type Point = { x: number; y: number };
type RoadState = 'passable' | 'caution' | 'blocked';
type Layer = 'exposure' | 'passable' | 'caution' | 'blocked' | 'routes' | 'agents' | 'shelters' | 'incidents';
const initialView = { x: 0, y: 0, width: 900, height: 480 };
const layerLabels: Record<Layer, string> = { exposure: 'Exposición a inundación', passable: 'Calles transitables', caution: 'Calles con precaución', blocked: 'Calles bloqueadas', routes: 'Rutas de evacuación', agents: 'Agentes', shelters: 'Refugios', incidents: 'Incidentes (Fase 4C)' };

function mercator(point: GeoPoint): Point {
  const latitude = Math.max(-85.05112878, Math.min(85.05112878, point.lat)) * Math.PI / 180;
  return { x: (point.lng + 180) / 360, y: (1 - Math.asinh(Math.tan(latitude)) / Math.PI) / 2 };
}
function geographic(point: Point): GeoPoint {
  return { lng: point.x * 360 - 180, lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * point.y))) * 180 / Math.PI };
}
function distanceToSegment(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
const pairKey = (from: string, to: string) => `${from}\0${to}`;

export interface FloodMapProps {
  graph: Graph;
  scenario?: ScenarioSnapshot;
  shelters: Shelter[];
  candidates: LabCandidate[];
  validation?: LabCandidateValidation;
  selectedAgentId: string;
  onSelectAgent: (id: string) => void;
  pickingCandidate?: number;
  onPickPosition: (point: GeoPoint) => void;
}

// Native SVG retains the existing map's pan/zoom behavior. Street geometry is
// indexed once and batched into at most three paths, including the master graph.
export function FloodMap({ graph, scenario, shelters, candidates, validation, selectedAgentId, onSelectAgent, pickingCandidate, onPickPosition }: FloodMapProps) {
  const [view, setView] = useState(initialView);
  const [layers, setLayers] = useState<Record<Layer, boolean>>({ exposure: true, passable: true, caution: true, blocked: true, routes: true, agents: true, shelters: true, incidents: true });
  const [selectedEdgeId, setSelectedEdgeId] = useState('');
  const [tileUnavailable, setTileUnavailable] = useState(false);
  const drag = useRef<{ start: Point; previous: Point } | null>(null);
  const moved = useRef(false);
  const model = useMemo(() => {
    const positions = new Map(graph.nodes.map(node => [node.id, node]));
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    for (const node of graph.nodes) {
      const p = mercator(node);
      left = Math.min(left, p.x); right = Math.max(right, p.x); top = Math.min(top, p.y); bottom = Math.max(bottom, p.y);
    }
    const scale = Math.min(850 / Math.max(right - left, 1e-8), 430 / Math.max(bottom - top, 1e-8));
    const offset = { x: (900 - (right - left) * scale) / 2, y: (480 - (bottom - top) * scale) / 2 };
    const normalized = (p: Point): Point => ({ x: offset.x + (p.x - left) * scale, y: offset.y + (p.y - top) * scale });
    const point = (p: GeoPoint) => normalized(mercator(p));
    const inverse = (p: Point) => geographic({ x: (p.x - offset.x) / scale + left, y: (p.y - offset.y) / scale + top });
    const nodes = new Map(graph.nodes.map(node => [node.id, point(node)]));
    const byPair = new Map<string, { points: Point[]; reverse: boolean }>();
    const grid = new Map<string, { id: string; a: Point; b: Point }[]>();
    const roads = graph.edges.map(edge => {
      const coordinates = edge.geometry?.length ? edge.geometry : [positions.get(edge.from)!, positions.get(edge.to)!];
      const points = coordinates.filter(Boolean).map(point);
      byPair.set(pairKey(edge.from, edge.to), { points, reverse: false });
      if (!edge.directed) byPair.set(pairKey(edge.to, edge.from), { points, reverse: true });
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]!, b = points[i]!;
        for (let x = Math.floor(Math.min(a.x, b.x) / 32); x <= Math.floor(Math.max(a.x, b.x) / 32); x++) {
          for (let y = Math.floor(Math.min(a.y, b.y) / 32); y <= Math.floor(Math.max(a.y, b.y) / 32); y++) {
            const key = `${x}:${y}`, bucket = grid.get(key) ?? [];
            bucket.push({ id: edge.id, a, b }); grid.set(key, bucket);
          }
        }
      }
      return { edge, path: points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join('') };
    });
    return { point, inverse, normalized, scale, nodes, byPair, roads, grid, edges: new Map(graph.edges.map(edge => [edge.id, edge])) };
  }, [graph]);
  const conditions = useMemo(() => new Map(scenario?.road_conditions.map(road => [road.edge_id, road]) ?? []), [scenario?.road_conditions]);
  const shelterConditions = useMemo(() => new Map(scenario?.shelter_conditions.map(shelter => [shelter.shelter_id, shelter]) ?? []), [scenario?.shelter_conditions]);
  const roadPaths = useMemo(() => {
    const paths: Record<RoadState, string[]> = { passable: [], caution: [], blocked: [] };
    for (const road of model.roads) {
      const state: RoadState = road.edge.blocked ? 'blocked' : conditions.get(road.edge.id)?.state ?? 'passable';
      paths[state].push(road.path);
    }
    return { passable: paths.passable.join(''), caution: paths.caution.join(''), blocked: paths.blocked.join('') };
  }, [model, conditions]);
  const routePath = useMemo(() => {
    const agent = scenario?.agents.find(item => item.id === selectedAgentId);
    if (!agent) return '';
    const paths: string[] = [];
    for (let i = 1; i < agent.planned_route.length; i++) {
      const edge = model.byPair.get(pairKey(agent.planned_route[i - 1]!, agent.planned_route[i]!));
      if (!edge) continue;
      const points = edge.reverse ? [...edge.points].reverse() : edge.points;
      paths.push(points.map((p, index) => `${index ? 'L' : 'M'}${p.x},${p.y}`).join(''));
    }
    return paths.join('');
  }, [model, scenario?.agents, selectedAgentId]);
  const tiles = useMemo(() => {
    if (!config.osmTilesEnabled) return [];
    const zoom = Math.max(10, Math.min(18, Math.round(Math.log2(model.scale * 900 / view.width / 256))));
    const count = 2 ** zoom;
    const first = mercator(model.inverse({ x: view.x, y: view.y })), last = mercator(model.inverse({ x: view.x + view.width, y: view.y + view.height }));
    const result: { key: string; url: string; x: number; y: number; size: number }[] = [];
    for (let x = Math.max(0, Math.floor(first.x * count)); x <= Math.min(count - 1, Math.floor(last.x * count)); x++) {
      for (let y = Math.max(0, Math.floor(first.y * count)); y <= Math.min(count - 1, Math.floor(last.y * count)); y++) {
        if (result.length >= 32) return result;
        const p = model.normalized({ x: x / count, y: y / count });
        result.push({ key: `${zoom}/${x}/${y}`, url: config.osmTileUrlTemplate.replace('{z}', String(zoom)).replace('{x}', String(x)).replace('{y}', String(y)), x: p.x, y: p.y, size: model.scale / count });
      }
    }
    return result;
  }, [model, view]);
  const zoom = (factor: number) => setView(previous => {
    const width = Math.max(112.5, Math.min(1800, previous.width * factor));
    return { x: previous.x + (previous.width - width) / 2, y: previous.y + (previous.height - width * 480 / 900) / 2, width, height: width * 480 / 900 };
  });
  const pan = (dx: number, dy: number) => setView(previous => ({ ...previous, x: previous.x + dx * previous.width, y: previous.y + dy * previous.height }));
  const selectAt = (position: Point) => {
    if (pickingCandidate !== undefined) { onPickPosition(model.inverse(position)); return; }
    const radius = 10 * view.width / 900;
    let nearest = '', distance = radius;
    for (let x = Math.floor((position.x - radius) / 32); x <= Math.floor((position.x + radius) / 32); x++) {
      for (let y = Math.floor((position.y - radius) / 32); y <= Math.floor((position.y + radius) / 32); y++) {
        for (const segment of model.grid.get(`${x}:${y}`) ?? []) {
          const candidate = distanceToSegment(position, segment.a, segment.b);
          if (candidate < distance) { nearest = segment.id; distance = candidate; }
        }
      }
    }
    setSelectedEdgeId(nearest);
  };
  const selectedEdge = model.edges.get(selectedEdgeId);
  const edgeSuggestions = useMemo(() => {
    const result: GraphEdge[] = [];
    for (const edge of graph.edges) {
      if (edge.id.toLowerCase().includes(selectedEdgeId.toLowerCase())) result.push(edge);
      if (result.length === 12) break;
    }
    return result;
  }, [graph.edges, selectedEdgeId]);
  const selectedCondition = selectedEdge ? conditions.get(selectedEdge.id) : undefined;
  return <div className="flood-map-panel">
    <fieldset className="flood-layers"><legend>Capas cartográficas</legend>{(Object.keys(layerLabels) as Layer[]).map(layer => <label key={layer}><input type="checkbox" checked={layers[layer]} onChange={event => setLayers(previous => ({ ...previous, [layer]: event.target.checked }))} />{layerLabels[layer]}</label>)}</fieldset>
    {pickingCandidate !== undefined && <p className="flood-pick-notice" role="status">Haz clic en el mapa para reemplazar el candidato {pickingCandidate + 1}. También puedes introducir coordenadas en el formulario.</p>}
    <figure className="escape-map flood-map"><div className="escape-map-controls" role="group" aria-label="Controles del mapa de inundación">
      <Button variant="secondary" aria-label="Acercar mapa de inundación" onClick={() => zoom(.75)}>+</Button><Button variant="secondary" aria-label="Alejar mapa de inundación" onClick={() => zoom(1 / .75)}>−</Button><Button variant="secondary" onClick={() => setView(initialView)}>Restablecer mapa de inundación</Button>
      <Button variant="secondary" aria-label="Mover mapa de inundación al oeste" onClick={() => pan(-.15, 0)}>←</Button><Button variant="secondary" aria-label="Mover mapa de inundación al norte" onClick={() => pan(0, -.15)}>↑</Button><Button variant="secondary" aria-label="Mover mapa de inundación al sur" onClick={() => pan(0, .15)}>↓</Button><Button variant="secondary" aria-label="Mover mapa de inundación al este" onClick={() => pan(.15, 0)}>→</Button><output aria-label="Escala del mapa de inundación">{(900 / view.width).toFixed(1)}×</output>
    </div><svg data-testid="flood-map" viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`} preserveAspectRatio="none" role="img" tabIndex={0} aria-labelledby="flood-map-title flood-map-description"
      onKeyDown={event => { const directions: Record<string, [number, number]> = { ArrowLeft: [-.15, 0], ArrowRight: [.15, 0], ArrowUp: [0, -.15], ArrowDown: [0, .15] }; if (directions[event.key]) { event.preventDefault(); pan(...directions[event.key]!); } else if (['+', '=', '-', '0'].includes(event.key)) { event.preventDefault(); if (event.key === '0') setView(initialView); else zoom(event.key === '-' ? 1 / .75 : .75); } }}
      onPointerDown={event => { if (event.button !== 0) return; const p = { x: event.clientX, y: event.clientY }; drag.current = { start: p, previous: p }; moved.current = false; event.currentTarget.setPointerCapture?.(event.pointerId); }}
      onPointerMove={event => { if (!drag.current) return; const rect = event.currentTarget.getBoundingClientRect(); const p = { x: event.clientX, y: event.clientY }, previous = drag.current.previous; if (Math.hypot(p.x - drag.current.start.x, p.y - drag.current.start.y) > 4) moved.current = true; drag.current.previous = p; if (moved.current) setView(current => ({ ...current, x: current.x - (p.x - previous.x) * current.width / (rect.width || 900), y: current.y - (p.y - previous.y) * current.height / (rect.height || 480) })); }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
      onClick={event => { if (moved.current) { moved.current = false; return; } const rect = event.currentTarget.getBoundingClientRect(); selectAt({ x: view.x + (event.clientX - rect.left) / (rect.width || 900) * view.width, y: view.y + (event.clientY - rect.top) / (rect.height || 480) * view.height }); }}>
      <title id="flood-map-title">Red urbana de inundación simulada</title><desc id="flood-map-description">Geometría OpenStreetMap, focos de exposición sintética, calles por estado, agentes, rutas y cuatro refugios de laboratorio. Navega con flechas, +, − y 0. Haz clic para inspeccionar una calle o elegir la ubicación de un candidato.</desc>
      <g data-layer="osm-base" aria-hidden="true">{tiles.map(tile => <image key={tile.key} href={tile.url} x={tile.x} y={tile.y} width={tile.size + .1} height={tile.size + .1} className="flood-osm-tile" onError={() => setTileUnavailable(true)} />)}</g>
      {layers.exposure && <g data-layer="exposure">{scenario?.flood_zones.map(zone => { const center = model.point(zone.center); const north = model.point({ lat: zone.center.lat + zone.radius_m / 111195, lng: zone.center.lng }); const radius = Math.abs(center.y - north.y); return <circle key={zone.id} cx={center.x} cy={center.y} r={radius} fillOpacity={.10 + zone.intensity * .3} className="flood-exposure-zone"><title>{zone.id} · exposición sintética {(zone.intensity * 100).toFixed(1)}%</title></circle>; })}</g>}
      {(['passable', 'caution', 'blocked'] as RoadState[]).map(state => layers[state] && <path key={state} d={roadPaths[state]} data-road-state={state} className={`flood-roads flood-roads-${state}`} aria-label={`${layerLabels[state]} de la red OSM`} />)}
      {layers.routes && routePath && <path data-layer="routes" d={routePath} className="flood-route"><title>Ruta publicada de {selectedAgentId}</title></path>}
      {selectedEdge && <path d={model.roads.find(road => road.edge.id === selectedEdge.id)?.path} className="flood-selected-road" />}
      {layers.agents && <g data-layer="agents">{scenario?.agents.map(agent => { const point = model.nodes.get(agent.current_node); return point ? <circle key={agent.id} data-agent-id={agent.id} cx={point.x} cy={point.y} r={agent.id === selectedAgentId ? 6 : 3} className={`flood-agent flood-agent-${agent.state}`} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onSelectAgent(agent.id); }}><title>{agent.id} · {agent.state}</title></circle> : null; })}</g>}
      {layers.shelters && <g data-layer="shelters">{shelters.map(shelter => { const point = model.nodes.get(shelter.node_id); const condition = shelterConditions.get(shelter.id); return point ? <g key={shelter.id}><rect x={point.x - 6} y={point.y - 6} width={12} height={12} rx={2} className={`flood-shelter flood-shelter-${condition?.state ?? 'available'}`}><title>{shelter.id} · {condition?.state ?? 'available'} · {shelter.occupancy}/{shelter.capacity} ocupadas · {shelter.reserved} reservadas</title></rect><text x={point.x + 9} y={point.y + 4} className="escape-map-label">{shelter.id}</text></g> : null; })}
        {candidates.map((candidate, index) => { if (!Number.isFinite(candidate.lat) || !Number.isFinite(candidate.lng)) return null; const check = validation?.candidates.find(item => item.id === candidate.id); const point = model.point(candidate); return <g key={candidate.id} data-candidate={candidate.id}><circle cx={point.x} cy={point.y} r={8} className={`flood-candidate ${check?.valid === false ? 'flood-candidate-invalid' : ''}`} /><text x={point.x - 3} y={point.y + 3} className="flood-candidate-label">{index + 1}</text><title>Candidato {index + 1}: {candidate.label} · {check?.message ?? 'Pendiente de validar'}</title></g>; })}</g>}
      {layers.incidents && <g data-layer="incidents"><title>Incidentes preparados para Fase 4C; no hay incidentes publicados.</title></g>}
    </svg><figcaption className="flood-legend"><span className="flood-legend-exposure">● Exposición sintética</span><span className="flood-legend-passable">— Transitable</span><span className="flood-legend-caution">— Precaución</span><span className="flood-legend-blocked">┄ Bloqueada</span><span className="flood-legend-shelter">■ Refugio candidato</span><span>○ Ubicación propuesta</span><span>— Ruta del agente seleccionado</span></figcaption>
      <p className="flood-map-attribution"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a> · Base vectorial OSM · {graph.nodes.length.toLocaleString('es-EC')} intersecciones / {graph.edges.length.toLocaleString('es-EC')} aristas</p>
      {tileUnavailable && <p className="muted" role="status">Las teselas de fondo no están disponibles. La red vectorial OpenStreetMap y los controles siguen activos.</p>}
    </figure>
    <div className="flood-edge-inspector"><label>Inspeccionar arista<input type="search" aria-label="Inspeccionar arista" list="flood-road-results" placeholder="ID de calle o clic en el mapa" value={selectedEdgeId} onChange={event => setSelectedEdgeId(event.target.value)} /><datalist id="flood-road-results">{edgeSuggestions.map(edge => <option key={edge.id} value={edge.id} />)}</datalist></label>{selectedEdge && <EdgeDetails edge={selectedEdge} condition={selectedCondition} />}</div>
  </div>;
}

function EdgeDetails({ edge, condition }: { edge: GraphEdge; condition?: ScenarioSnapshot['road_conditions'][number] }) {
  const states = { passable: 'Transitable', caution: 'Precaución', blocked: 'Bloqueada' };
  const state = edge.blocked ? 'blocked' : condition?.state ?? 'passable';
  return <dl className="flood-edge-details" aria-label={`Detalle de arista ${edge.id}`}><div><dt>Arista</dt><dd>{edge.id}</dd></div><div><dt>Estado</dt><dd>{states[state]}</dd></div><div><dt>Riesgo sintético</dt><dd>{(condition?.risk_score ?? 0).toFixed(3)}</dd></div><div><dt>Origen</dt><dd>{condition?.risk_source ?? (edge.blocked ? 'base_graph' : 'Geometría OSM; sin restricción de inundación')}</dd></div><div><dt>Actualizada en paso</dt><dd>{condition?.updated_at_simulation_step ?? 0}</dd></div><div><dt>Tramo</dt><dd>{edge.from} → {edge.to} · {Math.round(edge.distance_m)} m</dd></div></dl>;
}
