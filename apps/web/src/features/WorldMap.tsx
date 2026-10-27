import { useEffect, useMemo, useState } from 'react';
import type { GeoPoint, Graph, RunnerForecast, Shelter, Survivor, WorldSnapshot } from '@corodev/contracts';
import { mapProjection, mapTiles } from './visualization/projection';
import { AnimatedEntities } from './visualization/AnimatedEntities';
import { useVisualization, VisualizationControls } from './visualization/useVisualization';
import { observeWorld } from './visualization/observation';
import type { VisualLifecycle } from './visualization/observation';
import { useMapCamera } from './maps/useMapCamera';
import { MapAttribution, MapTools, MapSource, MapWorkspaceOverlay } from './maps/MapTools';
import type { MapWorkspaceSlots } from './maps/MapTools';
import { mapPointer } from './visualization/pointer';

export function routeGeometry(graph: Graph, survivor: Survivor): GeoPoint[] {
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const route = survivor.planned_route[0] === survivor.current_node ? survivor.planned_route : [survivor.current_node, ...survivor.planned_route];
  const coordinates: GeoPoint[] = [];
  for (let i = 1; i < route.length; i++) {
    const from = route[i - 1]!, to = route[i]!;
    const edge = graph.edges.find(candidate => candidate.from === from && candidate.to === to || !candidate.directed && candidate.from === to && candidate.to === from);
    if (!edge) return [];
    const geometry = edge.geometry?.length ? [...edge.geometry] : [nodes.get(edge.from)!, nodes.get(edge.to)!];
    if (edge.from !== from) geometry.reverse();
    coordinates.push(...geometry.filter((point): point is GeoPoint => Boolean(point)));
  }
  return coordinates;
}

export function routeWarnings(graph: Graph, world: WorldSnapshot, survivor: Survivor): string[] {
  const warnings: string[] = [];
  const route = [survivor.current_node, ...survivor.planned_route.filter(node => node !== survivor.current_node)];
  const blocked = new Set(world.blocked_edges);
  if (route.some((node, i) => i > 0 && !graph.edges.some(edge => !edge.blocked && !blocked.has(edge.id) && (edge.from === route[i - 1] && edge.to === node || !edge.directed && edge.to === route[i - 1] && edge.from === node)))) warnings.push('La ruta publicada incluye un tramo que ya no está disponible.');
  const routeNodes = new Set(route);
  if (world.zombies.some(zombie => routeNodes.has(zombie.current_node) || zombie.type === 'horde' && graph.edges.some(edge => edge.from === zombie.current_node && routeNodes.has(edge.to) || edge.to === zombie.current_node && routeNodes.has(edge.from)))) warnings.push('Hay amenazas visibles sobre la ruta o en la zona de una horda.');
  return warnings;
}

export interface WorldMapProps extends MapWorkspaceSlots {
  graph: Graph;
  world?: WorldSnapshot;
  forecast?: RunnerForecast;
  selected?: Survivor;
  lifecycle?: VisualLifecycle;
  onSelect?: (id: string) => void;
  shelters?: Shelter[];
  pickingPosition?: boolean;
  previewPosition?: GeoPoint;
  onPickPosition?: (point: GeoPoint) => void;
  onCancelPick?: () => void;
}
type WorldLayer = 'roads' | 'survivors' | 'zombies' | 'shelters' | 'routes' | 'origins' | 'fleet' | 'forecast';
const layerLabels: Record<WorldLayer, string> = { roads: 'Grafo vial', survivors: 'Supervivientes', zombies: 'Zombis visibles', shelters: 'Refugios', routes: 'Ruta seleccionada', origins: 'Zonas de aparición', fleet: 'Camionetas de rescate', forecast: 'Mostrar predicción de corredores' };

export function WorldMap({ graph, world, forecast, selected, lifecycle, onSelect, shelters, pickingPosition = false, previewPosition, onPickPosition, onCancelPick, hud, panel, metrics, selectedShelterId, onSelectShelter }: WorldMapProps) {
  const observation = useMemo(() => observeWorld(world, lifecycle), [world, lifecycle]);
  const controls = useVisualization(observation);
  const camera = useMapCamera(graph.version, onCancelPick);
  const { view } = camera;
  const [layers, setLayers] = useState<Record<WorldLayer, boolean>>({ roads: true, survivors: true, zombies: true, shelters: true, routes: true, origins: true, fleet: true, forecast: false });
  const [tileUnavailable, setTileUnavailable] = useState(false);
  const projection = useMemo(() => mapProjection(graph), [graph]);
  useEffect(() => {
    if (!selectedShelterId) return;
    const shelter = (shelters ?? world?.shelters ?? graph.shelters).find(item => item.id === selectedShelterId);
    const point = shelter && projection.nodes.get(shelter.node_id);
    if (point) camera.focus(point);
  }, [selectedShelterId, graph.version]);
  const tiles = useMemo(() => mapTiles(projection, view), [projection, view]);
  const visibleObservation = useMemo(() => observation && ({ ...observation, entities: observation.entities.filter(entity => entity.kind === 'survivor' ? layers.survivors : layers.zombies) }), [observation, layers.survivors, layers.zombies]);
  const forecastNodes = useMemo(() => forecast && forecast.turn === world?.turn ? [...forecast.node_risks].filter(item => item.one_turn_probability > 0).sort((a, b) => b.one_turn_probability - a.one_turn_probability || a.node_id.localeCompare(b.node_id)).slice(0, 64) : [], [forecast, world?.turn]);
  const points = (coordinates: GeoPoint[]) => coordinates.map(coordinate => { const p = projection.point(coordinate); return `${p.x},${p.y}`; }).join(' ');
  const blockedKey = (world?.blocked_edges ?? []).join(',');
  const roads = useMemo(() => {
    const blocked = new Set(blockedKey.split(','));
    const geometryPoints = (coordinates: GeoPoint[]) => coordinates.map(coordinate => { const p = projection.point(coordinate); return `${p.x},${p.y}`; }).join(' ');
    const paths: Record<string, string[]> = { open: [], blocked: [] };
    for (const edge of graph.edges) {
      const a = projection.nodes.get(edge.from), b = projection.nodes.get(edge.to);
      const geometry = edge.geometry?.length ? geometryPoints(edge.geometry) : a && b ? `${a.x},${a.y} ${b.x},${b.y}` : '';
      if (geometry) paths[edge.blocked || blocked.has(edge.id) ? 'blocked' : 'open']!.push(`M${geometry.split(' ').join('L')}`);
    }
    return <g data-layer="roads"><path d={paths.open!.join('')} className="escape-road"><title>Calles de la red OpenStreetMap</title></path><path d={paths.blocked!.join('')} className="escape-road escape-road-blocked"><title>Vías cerradas de la simulación</title></path></g>;
  }, [graph, projection, blockedKey]);
  const preview = previewPosition && projection.point(previewPosition);
  const pickAt = (point: { x: number; y: number }) => {
    const normalized = projection.inverse(point);
    onPickPosition?.({ lng: normalized.x * 360 - 180, lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * normalized.y))) * 180 / Math.PI });
  };
  return <figure className="escape-map map-workspace">
    {hud && <div className="map-workspace-hud" data-map-ui>{hud}</div>}
    <MapTools onReset={camera.reset} scale={900 / view.width}><details className="map-disclosure"><summary>Capas</summary><div className="map-layer-panel"><fieldset><legend>Mapa y evacuación</legend>{(Object.keys(layerLabels) as WorldLayer[]).map(layer => <label key={layer}><input type="checkbox" checked={layers[layer]} onChange={event => setLayers(previous => ({ ...previous, [layer]: event.target.checked }))} />{layerLabels[layer]}</label>)}</fieldset></div></details><details className="map-disclosure"><summary>Visualización</summary><div className="map-layer-panel"><VisualizationControls controls={controls} /></div></details></MapTools>
    {pickingPosition && <p className="map-pick-instruction" role="status">Selecciona una ubicación para el refugio. Elige con clic; Enter selecciona el centro de la vista. Escape cancela.</p>}
    <div className={`map-stage ${pickingPosition ? 'map-picking' : ''}`}><svg ref={camera.svg} viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`} role="img" tabIndex={0} aria-labelledby="escape-map-title escape-map-description" {...camera.bindings} onKeyDown={event => {
      if (pickingPosition && event.key === 'Enter' && event.target === event.currentTarget) { event.preventDefault(); pickAt({ x: view.x + view.width / 2, y: view.y + view.height / 2 }); }
      else camera.bindings.onKeyDown(event);
    }} onClick={event => {
      if (camera.consumeClick() || !pickingPosition) return;
      pickAt(mapPointer(event.currentTarget, { x: event.clientX, y: event.clientY }, view));
    }}>
      <title id="escape-map-title">Red de evacuación y posiciones observables</title><desc id="escape-map-description">Calles reales de OpenStreetMap y posiciones publicadas. Arrastra para desplazar, Ctrl y rueda o pellizca para zoom. También puedes usar flechas, +, − y 0; Enter elige el centro al editar un refugio. La navegación se extiende fuera de las zonas de origen.</desc>
      <g data-layer="osm-base" aria-hidden="true">{tiles.map(tile => <image key={tile.key} href={tile.url} x={tile.x} y={tile.y} width={tile.size + .1} height={tile.size + .1} className="flood-osm-tile" onError={event => { event.currentTarget.setAttribute('visibility', 'hidden'); setTileUnavailable(true); }} onLoad={event => event.currentTarget.removeAttribute('visibility')} />)}</g>
      {layers.origins && !!graph.coverage?.length && <polygon points={points(graph.coverage)} className="escape-coverage"><title>Envolvente de referencia urbana; no es el límite oficial ni representa todas las calles</title></polygon>}
      {layers.origins && (graph.spawn_zones ?? []).map(zone => <g key={zone.id}><polygon points={points(zone.geometry)} className="escape-spawn-zone"><title>{zone.name} · zona de aparición · {zone.source}</title></polygon>{zone.geometry[0] && <text x={projection.point(zone.geometry[0]).x} y={projection.point(zone.geometry[0]).y - 8} className="escape-zone-label">{zone.name}</text>}</g>)}
      {layers.roads && roads}
      {layers.forecast && forecastNodes.map(item => {
        const point = projection.nodes.get(item.node_id);
        return point ? <circle key={item.node_id} data-forecast-node={item.node_id} cx={point.x} cy={point.y} r={9} className="escape-runner-forecast" opacity={.2 + .6 * item.one_turn_probability}><title>{`Predicción del modelo, no calibrada · ${item.node_id} · próximo turno: ${(item.one_turn_probability * 100).toFixed(1)}% · dos turnos: ${(item.two_turn_probability * 100).toFixed(1)}%`}</title></circle> : null;
      })}
      <g pointerEvents={pickingPosition ? 'none' : undefined}><AnimatedEntities graph={graph} observation={visibleObservation} project={projection.point} view={view} active={controls.active} clustering={controls.clustering} selected={selected?.id} onSelect={pickingPosition ? undefined : onSelect} /></g>
      {layers.fleet && world?.fleet?.map(vehicle => {
        const point = projection.nodes.get(vehicle.current_node);
        return point ? <g key={vehicle.id} data-vehicle-id={vehicle.id} transform={`translate(${point.x},${point.y})`}><title>{`Camioneta ${vehicle.id} · ${vehicle.passenger_ids.length}/${vehicle.capacity} pasajeros · ${vehicle.state}${vehicle.target_shelter_id ? ` · destino ${vehicle.target_shelter_id}` : ''}`}</title><rect className="escape-rescue-vehicle" x={-9} y={-6} width={18} height={12} rx={3} /><text className="escape-rescue-label" y={3}>{vehicle.passenger_ids.length}/{vehicle.capacity}</text></g> : null;
      })}
      {layers.routes && selected && <polyline points={points(routeGeometry(graph, selected))} className="escape-planned-route"><title>Ruta publicada de {selected.id}</title></polyline>}
      {layers.shelters && (shelters ?? world?.shelters ?? graph.shelters).map(shelter => {
        const point = projection.nodes.get(shelter.node_id);
        return point ? <g key={shelter.id} data-shelter-id={shelter.id} className={selectedShelterId === shelter.id ? 'map-shelter-selected' : undefined} role={onSelectShelter && !pickingPosition ? 'button' : undefined} tabIndex={onSelectShelter && !pickingPosition ? 0 : undefined} aria-label={onSelectShelter && !pickingPosition ? `Localizar refugio ${shelter.id}` : undefined} aria-pressed={onSelectShelter && !pickingPosition ? selectedShelterId === shelter.id : undefined} onPointerDown={event => { if (!pickingPosition) event.stopPropagation(); }} onClick={event => { if (!pickingPosition) { event.stopPropagation(); onSelectShelter?.(shelter.id); } }} onKeyDown={event => { if (!pickingPosition && ['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); onSelectShelter?.(shelter.id); } }}><rect x={point.x - 6} y={point.y - 6} width="12" height="12" rx="2" className="escape-shelter"><title>Refugio ficticio {shelter.id} · {shelter.occupancy}/{shelter.capacity} ocupadas · {shelter.reserved} reservadas · {shelter.available} disponibles</title></rect><text x={point.x + 10} y={point.y + 4} className="escape-map-label">{shelter.id}</text></g> : null;
      })}
      {preview && <circle data-layer="shelter-preview" cx={preview.x} cy={preview.y} r={10} className="map-preview"><title>Ubicación provisional pendiente de confirmar</title></circle>}
    </svg><MapAttribution /><MapWorkspaceOverlay panel={panel} metrics={metrics} /></div>
    <figcaption>{layers.survivors && <span className="escape-legend-survivor">● Superviviente</span>}{layers.zombies && <span className="escape-legend-zombie">● Zombi visible</span>}{layers.shelters && <span className="escape-legend-shelter">■ Refugio ficticio</span>}{layers.origins && <span>▱ Zonas de aparición · ┄ Referencia urbana</span>}{layers.routes && <span>— Ruta seleccionada</span>}{layers.roads && <span>Rojo: vía bloqueada</span>}{layers.fleet && !!world?.fleet?.length && <span>▣ Camioneta · pasajeros/capacidad</span>}{layers.forecast && <span>◌ Predicción del modelo, no calibrada · hasta 64 nodos</span>}</figcaption>
    {tileUnavailable && <p role="status" className="map-source-note">Fondo no disponible; conservamos la red vectorial OpenStreetMap.</p>}<MapSource graph={graph} />
  </figure>;
}
