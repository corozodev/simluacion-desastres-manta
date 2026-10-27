import { useEffect, useMemo, useState } from 'react';
import type { GeoPoint, Graph, GraphEdge, Incident, LabCandidate, LabCandidateValidation, ScenarioSnapshot, Shelter, ReferenceCollection } from '@corodev/contracts';
import { Button } from '../../components/ui';
import { mapProjection, mapTiles } from '../visualization/projection';
import { useMapCamera } from '../maps/useMapCamera';
import { MapAttribution, MapTools, MapSource, MapWorkspaceOverlay } from '../maps/MapTools';
import type { MapWorkspaceSlots } from '../maps/MapTools';
import { mapPointer } from '../visualization/pointer';
import { AnimatedEntities } from '../visualization/AnimatedEntities';
import { useVisualization, VisualizationControls } from '../visualization/useVisualization';
import { observeFlood } from '../visualization/observation';
import type { VisualLifecycle } from '../visualization/observation';
import { incidentDate, incidentSourceLabels, incidentStatusGlyphs, incidentStatusLabels, incidentTypeGlyphs, incidentTypeLabels } from './incidentPresentation';

type Point = { x: number; y: number };
type RoadState = 'passable' | 'caution' | 'blocked';
type Layer = 'exposure' | 'passable' | 'caution' | 'blocked' | 'routes' | 'agents' | 'shelters' | 'incidents';
const layerLabels: Record<Layer, string> = { exposure: 'Exposición a inundación', passable: 'Calles transitables', caution: 'Calles con precaución', blocked: 'Calles bloqueadas', routes: 'Rutas de evacuación', agents: 'Agentes', shelters: 'Refugios', incidents: 'Novedades georreferenciadas' };

function distanceToSegment(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
const pairKey = (from: string, to: string) => `${from}\0${to}`;

export interface FloodMapProps extends MapWorkspaceSlots {
  lifecycle?: VisualLifecycle;
  referenceAvailable?: boolean;
  graph: Graph;
  scenario?: ScenarioSnapshot;
  shelters: Shelter[];
  candidates: LabCandidate[];
  validation?: LabCandidateValidation;
  selectedAgentId: string;
  onSelectAgent: (id: string) => void;
  pickingCandidate?: number;
  onCancelPick?: () => void;
  previewPosition?: GeoPoint;
  onOpenIncident?: (id: string) => void;
  onPickPosition: (point: GeoPoint) => void;
  incidents?: Incident[];
  selectedIncidentId?: string;
  onSelectIncident?: (id: string) => void;
  reference?: ReferenceCollection;
  showReference?: boolean;
  onShowReference?: (show: boolean) => void;
}

// Native SVG retains the existing map's pan/zoom behavior. Street geometry is
// indexed once and batched into at most three paths, including the master graph.
export function FloodMap({ graph, scenario, shelters, candidates, validation, selectedAgentId, onSelectAgent, pickingCandidate, onPickPosition, onCancelPick, previewPosition, onOpenIncident, incidents = [], selectedIncidentId, onSelectIncident, reference, showReference = false, onShowReference, lifecycle, referenceAvailable = Boolean(reference), hud, panel, metrics, selectedShelterId, onSelectShelter }: FloodMapProps) {
  const observation = useMemo(() => observeFlood(scenario, lifecycle), [scenario, lifecycle]);
  const controls = useVisualization(observation);
  const camera = useMapCamera(graph.version, onCancelPick);
  const { view } = camera;
  const projection = useMemo(() => mapProjection(graph), [graph]);
  useEffect(() => {
    if (!selectedShelterId) return;
    const shelter = shelters.find(item => item.id === selectedShelterId);
    const point = shelter && projection.nodes.get(shelter.node_id);
    if (point) camera.focus(point);
  }, [selectedShelterId, graph.version]);
  const [popupId, setPopupId] = useState(selectedIncidentId ?? '');
  useEffect(() => { setPopupId(selectedIncidentId ?? ''); }, [selectedIncidentId]);
  const [layers, setLayers] = useState<Record<Layer, boolean>>({ exposure: true, passable: true, caution: true, blocked: true, routes: true, agents: true, shelters: true, incidents: true });
  const [selectedEdgeId, setSelectedEdgeId] = useState('');
  const [tileUnavailable, setTileUnavailable] = useState(false);
  const model = useMemo(() => {
    const positions = new Map(graph.nodes.map(node => [node.id, node]));
    const point = projection.point;
    const inverse = (p: Point): GeoPoint => { const normalized = projection.inverse(p); return { lng: normalized.x * 360 - 180, lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * normalized.y))) * 180 / Math.PI }; };
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
      return { edge, points, path: points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join('') };
    });
    return { point, inverse, nodes, byPair, roads, grid, edges: new Map(graph.edges.map(edge => [edge.id, edge])) };
  }, [graph, projection]);
  const referencePaths = useMemo(() => reference?.features.map(feature => ({ id: feature.id, category: feature.properties.susceptibility, path: feature.geometry.coordinates.map(polygon => polygon.map(ring => ring.map((coordinate, i) => { const p = model.point({ lng: coordinate[0]!, lat: coordinate[1]! }); return `${i ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`; }).join('') + 'Z').join('')).join('') })) ?? [], [reference, model]);
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
  const waterPoints = useMemo(() => model.roads.filter(road => (conditions.get(road.edge.id)?.risk_score ?? 0) > 0).flatMap(road => { return road.points.length ? [road.points[Math.floor(road.points.length / 2)]!] : []; }), [model, conditions]);
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
  const tiles = useMemo(() => mapTiles(projection, view), [projection, view]);
  const selectIncident = (id: string) => { if (pickingCandidate !== undefined) return; setPopupId(id); onSelectIncident?.(id); };
  const popup = pickingCandidate === undefined && layers.incidents ? incidents.find(incident => incident.incident_id === popupId) : undefined;
  const closePopup = () => {
    [...(camera.svg.current?.querySelectorAll<SVGGElement>('[data-incident-id]') ?? [])].find(marker => marker.dataset.incidentId === popupId)?.focus();
    setPopupId('');
  };
  const preview = previewPosition && model.point(previewPosition);
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
  return <div className="flood-map-panel map-workspace">
    {hud && <div className="map-workspace-hud" data-map-ui>{hud}</div>}
    <MapTools onReset={camera.reset} scale={900 / view.width}><details className="map-disclosure"><summary>Capas</summary><div className="map-layer-panel"><fieldset><legend>Territorio y estado de vías</legend>{(['exposure', 'passable', 'caution', 'blocked'] as Layer[]).map(layer => <label key={layer}><input type="checkbox" checked={layers[layer]} disabled={layer === 'exposure' && !scenario} onChange={event => setLayers(previous => ({ ...previous, [layer]: event.target.checked }))} />{layerLabels[layer]}</label>)}</fieldset><fieldset><legend>Evacuación y reportes</legend>{(['routes', 'agents', 'shelters', 'incidents'] as Layer[]).map(layer => <label key={layer}><input type="checkbox" checked={layers[layer]} disabled={layer === 'incidents' && !incidents.length} onChange={event => setLayers(previous => ({ ...previous, [layer]: event.target.checked }))} />{layerLabels[layer]}</label>)}</fieldset><fieldset><legend>Fuentes oficiales</legend><label><input type="checkbox" checked={showReference} disabled={!onShowReference || !referenceAvailable} onChange={event => onShowReference?.(event.target.checked)} />Susceptibilidad oficial a inundaciones</label></fieldset></div></details><details className="map-disclosure"><summary>Visualización</summary><div className="map-layer-panel"><VisualizationControls controls={controls} /></div></details></MapTools>
    {pickingCandidate !== undefined && <p className="map-pick-instruction" role="status">Selecciona la ubicación del refugio {pickingCandidate + 1}. Elige con clic; Enter selecciona el centro de la vista. Escape cancela.</p>}
    <figure className="escape-map flood-map"><div className={`map-stage ${pickingCandidate !== undefined ? 'map-picking' : ''}`}><svg ref={camera.svg} data-testid="flood-map" viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`} preserveAspectRatio="xMidYMid meet" role="img" tabIndex={0} aria-labelledby="flood-map-title flood-map-description" {...camera.bindings} onKeyDown={event => {
      if (pickingCandidate !== undefined && event.key === 'Enter' && event.target === event.currentTarget) { event.preventDefault(); selectAt({ x: view.x + view.width / 2, y: view.y + view.height / 2 }); }
      else camera.bindings.onKeyDown(event);
    }}
      onClick={event => { if (camera.consumeClick()) return; selectAt(mapPointer(event.currentTarget, { x: event.clientX, y: event.clientY }, view)); }}>
      <title id="flood-map-title">Red urbana de inundación simulada</title><desc id="flood-map-description">Geometría OpenStreetMap, focos de exposición sintética, calles por estado, agentes, rutas y cuatro refugios de laboratorio. Arrastra, usa Ctrl y rueda, doble clic o pellizca para zoom; también flechas, +, − y 0. Enter elige el centro al editar un refugio. Haz clic para inspeccionar una calle o elegir la ubicación de un candidato.</desc>
      <g data-layer="osm-base" aria-hidden="true">{tiles.map(tile => <image key={tile.key} href={tile.url} x={tile.x} y={tile.y} width={tile.size + .1} height={tile.size + .1} className="flood-osm-tile" onError={event => { event.currentTarget.setAttribute('visibility', 'hidden'); setTileUnavailable(true); }} onLoad={event => event.currentTarget.removeAttribute('visibility')} />)}</g>
      {showReference && <g data-layer="official-susceptibility" pointerEvents="none">{referencePaths.map(feature => <path key={feature.id} data-reference-id={feature.id} d={feature.path} fillRule="evenodd" className={`flood-reference-polygon reference-${feature.category}`}><title>Susceptibilidad estructural {feature.category} · SNGR / CONAGE 2024 · no es inundación actual</title></path>)}</g>}
      {layers.exposure && <g data-layer="exposure">{scenario?.flood_zones.map(zone => { const center = model.point(zone.center); const north = model.point({ lat: zone.center.lat + zone.radius_m / 111195, lng: zone.center.lng }); const radius = Math.abs(center.y - north.y); return <circle key={zone.id} cx={center.x} cy={center.y} r={radius} fillOpacity={.10 + zone.intensity * .3} className={`flood-exposure-zone flood-index-${zone.intensity <= .33 ? 'low' : zone.intensity <= .66 ? 'medium' : 'high'}`}><title>{zone.id} · foco de exposición sintética; no extensión de agua · índice {(zone.intensity * 100).toFixed(1)}%</title></circle>; })}</g>}
      {(['passable', 'caution', 'blocked'] as RoadState[]).map(state => layers[state] && <path key={state} d={roadPaths[state]} data-road-state={state} className={`flood-roads flood-roads-${state}`} aria-label={`${layerLabels[state]} de la red OSM`} />)}
      <g pointerEvents={pickingCandidate !== undefined ? 'none' : undefined}><AnimatedEntities graph={graph} observation={layers.agents ? observation : observation && { ...observation, entities: [] }} project={model.point} view={view} active={controls.active} clustering={controls.clustering} selected={selectedAgentId} onSelect={pickingCandidate !== undefined ? undefined : onSelectAgent} water={layers.exposure && waterPoints.length > 0} waterPoints={waterPoints} /></g>
      {layers.routes && routePath && <path data-layer="routes" d={routePath} className="flood-route"><title>Ruta publicada de {selectedAgentId}</title></path>}
      {selectedEdge && <path d={model.roads.find(road => road.edge.id === selectedEdge.id)?.path} className="flood-selected-road" />}
      {layers.shelters && <g data-layer="shelters">{shelters.map(shelter => { const point = model.nodes.get(shelter.node_id); const condition = shelterConditions.get(shelter.id); return point ? <g key={shelter.id} data-shelter-id={shelter.id} className={selectedShelterId === shelter.id ? 'map-shelter-selected' : undefined} role={onSelectShelter && pickingCandidate === undefined ? 'button' : undefined} tabIndex={onSelectShelter && pickingCandidate === undefined ? 0 : undefined} aria-label={onSelectShelter && pickingCandidate === undefined ? `Localizar refugio ${shelter.id}` : undefined} aria-pressed={onSelectShelter && pickingCandidate === undefined ? selectedShelterId === shelter.id : undefined} onPointerDown={event => { if (pickingCandidate === undefined) event.stopPropagation(); }} onClick={event => { if (pickingCandidate === undefined) { event.stopPropagation(); onSelectShelter?.(shelter.id); } }} onKeyDown={event => { if (pickingCandidate === undefined && ['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); onSelectShelter?.(shelter.id); } }}><rect x={point.x - 6} y={point.y - 6} width={12} height={12} rx={2} className={`flood-shelter flood-shelter-${condition?.state ?? 'available'}`}><title>{shelter.id} · {condition?.state ?? 'available'} · {shelter.occupancy}/{shelter.capacity} ocupadas · {shelter.reserved} reservadas</title></rect><text x={point.x + 9} y={point.y + 4} className="escape-map-label">{shelter.id}</text></g> : null; })}
        {candidates.map((candidate, index) => { if (!Number.isFinite(candidate.lat) || !Number.isFinite(candidate.lng)) return null; const check = validation?.candidates.find(item => item.id === candidate.id); const point = model.point(check?.valid ? { lat: check.snapped_lat, lng: check.snapped_lng } : candidate); const proposed = model.point(candidate); return <g key={candidate.id} data-candidate={candidate.id}>{check?.valid && check.snap_distance_m > 0 && <line x1={proposed.x} y1={proposed.y} x2={point.x} y2={point.y} className="map-snap-connector" />}<circle cx={point.x} cy={point.y} r={8} className={`flood-candidate ${check?.valid === false ? 'flood-candidate-invalid' : ''}`} /><text x={point.x - 3} y={point.y + 3} className="flood-candidate-label">{index + 1}</text><title>Candidato {index + 1}: {candidate.label} · {check?.message ?? 'Pendiente de validar'}</title></g>; })}</g>}
      {layers.incidents && <g data-layer="incidents">{incidents.map(incident => {
        const point = model.point({ lat: incident.latitude, lng: incident.longitude });
        const label = `${incidentTypeLabels[incident.incident_type]} · ${incidentStatusLabels[incident.verification_status]} · ${incidentSourceLabels[incident.source_type]}`;
        return <g key={incident.incident_id} data-incident-id={incident.incident_id} data-incident-status={incident.verification_status} data-incident-source={incident.source_type} role="button" tabIndex={pickingCandidate !== undefined ? -1 : 0} pointerEvents={pickingCandidate !== undefined ? 'none' : undefined} aria-label={`Seleccionar incidente en mapa ${incident.incident_id}: ${label}`} aria-pressed={popupId === incident.incident_id} className={`flood-incident-marker flood-incident-${incident.verification_status} ${incident.source_type === 'synthetic' ? 'flood-incident-marker-synthetic' : incident.source_type === 'official' ? 'flood-incident-marker-official' : ''} ${popupId === incident.incident_id ? 'flood-incident-marker-selected' : ''}`} transform={`translate(${point.x},${point.y})`} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); selectIncident(incident.incident_id); }} onKeyDown={event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); selectIncident(incident.incident_id); } }}>
          <title>{label} · {incident.description} · fecha {incidentDate(incident.event_time)} · vigencia {incidentDate(incident.expires_at)} · ubicación aproximada; no modifica esta simulación</title>{incident.source_type === 'synthetic' ? <path d="M0,-10L10,0L0,10L-10,0Z" /> : incident.source_type === 'official' ? <path d="M-5,-9L5,-9L10,0L5,9L-5,9L-10,0Z" /> : <circle r={9} />}<text textAnchor="middle" dy=".35em" aria-hidden="true">{incidentStatusGlyphs[incident.verification_status]}</text><text x={12} y={-9} className="incident-type-glyph" aria-hidden="true">{incidentTypeGlyphs[incident.incident_type]}</text>
        </g>;
      })}</g>}
      {preview && <circle data-layer="shelter-preview" cx={preview.x} cy={preview.y} r={10} className="map-preview flood-candidate-preview"><title>Ubicación provisional pendiente de confirmar</title></circle>}
    </svg><MapAttribution /><MapWorkspaceOverlay panel={panel} metrics={metrics} />{popup && <section className="map-popup" aria-label={`Reporte en mapa: ${incidentTypeLabels[popup.incident_type]}`} onKeyDown={event => { if (event.key === 'Escape') closePopup(); }}>
      <Button variant="ghost" className="map-popup-close" aria-label="Cerrar reporte del mapa" onClick={closePopup}>×</Button><h3>{incidentTypeLabels[popup.incident_type]}</h3><time dateTime={popup.event_time}>{incidentDate(popup.event_time)}</time><p>{popup.description}</p><dl><div><dt>Transitabilidad</dt><dd>{{ passable: 'Transitable', restricted: 'Restringida', blocked: 'Bloqueada', unknown: 'Desconocida' }[popup.road_passability_reported] ?? 'Desconocida'}</dd></div><div><dt>Severidad</dt><dd>{{ low: 'Baja', moderate: 'Moderada', high: 'Alta', unknown: 'Desconocida' }[popup.severity_reported] ?? 'Desconocida'}</dd></div><div><dt>Estado</dt><dd>{incidentStatusLabels[popup.verification_status]}</dd></div></dl><p className="muted">{incidentSourceLabels[popup.source_type]} · ubicación aproximada. {popup.source_type === 'synthetic' ? 'Dato sintético; no es una observación real.' : popup.source_type === 'citizen' && popup.verification_status === 'pending' ? 'Pendiente de verificación; no confirma una condición vial.' : ''}</p>{onOpenIncident && <Button variant="secondary" onClick={() => onOpenIncident(popup.incident_id)}>Detalles y evaluación experimental</Button>}
    </section>}</div><figcaption className="flood-legend">{layers.exposure && <span className="flood-legend-exposure">● Exposición sintética</span>}{layers.passable && <span className="flood-legend-passable">— Transitable</span>}{layers.caution && <span className="flood-legend-caution">— Precaución</span>}{layers.blocked && <span className="flood-legend-blocked">┄ Bloqueada</span>}{layers.shelters && <span className="flood-legend-shelter">■ Refugio candidato · ○ Propuesta</span>}{layers.agents && <span>● Agentes</span>}{layers.routes && <span>— Ruta seleccionada</span>}{layers.incidents && incidents.length > 0 && <span>? Pendiente · + Corroborado · ✓ Verificado · × Rechazado · ⌛ Caducado · ○ Ciudadano · ⬡ Oficial · ◇ Sintético</span>}{showReference && <span>▧ Susceptibilidad oficial; no es inundación actual</span>}</figcaption>
      {layers.exposure && <div className="visual-legend" aria-label="Leyenda del índice sintético"><span className="flood-index-low">Índice 0–0,33</span><span className="flood-index-medium">Índice &gt;0,33–0,66</span><span className="flood-index-high">Índice &gt;0,66–1</span></div>}
      <MapSource graph={graph} flood />
      {tileUnavailable && <p className="map-source-note" role="status">Las teselas de fondo no están disponibles. La red vectorial OpenStreetMap y los controles siguen activos.</p>}
    </figure>
    <details className="flood-edge-inspector" open={Boolean(selectedEdge)}><summary>Inspeccionar vía</summary><label>Inspeccionar arista<input type="search" aria-label="Inspeccionar arista" list="flood-road-results" placeholder="ID de calle o clic en el mapa" value={selectedEdgeId} onChange={event => setSelectedEdgeId(event.target.value)} /><datalist id="flood-road-results">{edgeSuggestions.map(edge => <option key={edge.id} value={edge.id} />)}</datalist></label>{selectedEdge && <EdgeDetails edge={selectedEdge} condition={selectedCondition} />}</details>
  </div>;
}

function EdgeDetails({ edge, condition }: { edge: GraphEdge; condition?: ScenarioSnapshot['road_conditions'][number] }) {
  const states = { passable: 'Transitable', caution: 'Precaución', blocked: 'Bloqueada' };
  const state = edge.blocked ? 'blocked' : condition?.state ?? 'passable';
  return <dl className="flood-edge-details" aria-label={`Detalle de arista ${edge.id}`}><div><dt>Arista</dt><dd>{edge.id}</dd></div><div><dt>Estado</dt><dd>{states[state]}</dd></div><div><dt>Riesgo sintético</dt><dd>{(condition?.risk_score ?? 0).toFixed(3)}</dd></div><div><dt>Origen</dt><dd>{condition?.risk_source ?? (edge.blocked ? 'base_graph' : 'Geometría OSM; sin restricción de inundación')}</dd></div><div><dt>Actualizada en paso</dt><dd>{condition?.updated_at_simulation_step ?? 0}</dd></div><div><dt>Tramo</dt><dd>{edge.from} → {edge.to} · {Math.round(edge.distance_m)} m</dd></div></dl>;
}
