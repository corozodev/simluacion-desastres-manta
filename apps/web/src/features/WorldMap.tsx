import { useMemo, useState } from 'react';
import type { GeoPoint, Graph, Shelter, Survivor, WorldSnapshot } from '@corodev/contracts';
import { mapProjection, mapTiles } from './visualization/projection';
import { AnimatedEntities } from './visualization/AnimatedEntities';
import { useVisualization, VisualizationControls } from './visualization/useVisualization';
import { observeWorld } from './visualization/observation';
import type { VisualLifecycle } from './visualization/observation';
import { useMapCamera } from './maps/useMapCamera';
import { MapAttribution, MapTools } from './maps/MapTools';
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

export interface WorldMapProps {
  graph: Graph;
  world?: WorldSnapshot;
  selected?: Survivor;
  lifecycle?: VisualLifecycle;
  onSelect?: (id: string) => void;
  shelters?: Shelter[];
  pickingPosition?: boolean;
  previewPosition?: GeoPoint;
  onPickPosition?: (point: GeoPoint) => void;
  onCancelPick?: () => void;
}
type WorldLayer = 'roads' | 'survivors' | 'zombies' | 'shelters' | 'routes' | 'origins';
const layerLabels: Record<WorldLayer, string> = { roads: 'Grafo vial', survivors: 'Supervivientes', zombies: 'Zombis visibles', shelters: 'Refugios', routes: 'Ruta seleccionada', origins: 'Zonas de aparición' };

export function WorldMap({ graph, world, selected, lifecycle, onSelect, shelters, pickingPosition = false, previewPosition, onPickPosition, onCancelPick }: WorldMapProps) {
  const observation = useMemo(() => observeWorld(world, lifecycle), [world, lifecycle]);
  const controls = useVisualization(observation);
  const camera = useMapCamera(graph.version, onCancelPick);
  const { view } = camera;
  const [layers, setLayers] = useState<Record<WorldLayer, boolean>>({ roads: true, survivors: true, zombies: true, shelters: true, routes: true, origins: true });
  const [tileUnavailable, setTileUnavailable] = useState(false);
  const projection = useMemo(() => mapProjection(graph), [graph]);
  const tiles = useMemo(() => mapTiles(projection, view), [projection, view]);
  const visibleObservation = useMemo(() => observation && ({ ...observation, entities: observation.entities.filter(entity => entity.kind === 'survivor' ? layers.survivors : layers.zombies) }), [observation, layers.survivors, layers.zombies]);
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
  return <figure className="escape-map">
    <MapTools onReset={camera.reset} scale={900 / view.width}><details className="map-disclosure"><summary>Capas</summary><div className="map-layer-panel"><fieldset><legend>Mapa y evacuación</legend>{(Object.keys(layerLabels) as WorldLayer[]).map(layer => <label key={layer}><input type="checkbox" checked={layers[layer]} onChange={event => setLayers(previous => ({ ...previous, [layer]: event.target.checked }))} />{layerLabels[layer]}</label>)}</fieldset></div></details><details className="map-disclosure"><summary>Visualización</summary><div className="map-layer-panel"><VisualizationControls controls={controls} /></div></details></MapTools>
    {pickingPosition && <p className="map-pick-instruction" role="status">Selecciona una ubicación para el refugio. Se validará sobre el grafo real. Escape cancela.</p>}
    <div className={`map-stage ${pickingPosition ? 'map-picking' : ''}`}><svg ref={camera.svg} viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`} role="img" tabIndex={0} aria-labelledby="escape-map-title escape-map-description" {...camera.bindings} onClick={event => {
      if (camera.consumeClick() || !pickingPosition) return;
      const normalized = projection.inverse(mapPointer(event.currentTarget, { x: event.clientX, y: event.clientY }, view));
      onPickPosition?.({ lng: normalized.x * 360 - 180, lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * normalized.y))) * 180 / Math.PI });
    }}>
      <title id="escape-map-title">Red de evacuación y posiciones observables</title><desc id="escape-map-description">Calles reales de OpenStreetMap y posiciones publicadas. Arrastra para desplazar, Ctrl y rueda o pellizca para zoom. También puedes usar flechas, +, − y 0. La navegación se extiende fuera de las zonas de origen.</desc>
      <g data-layer="osm-base" aria-hidden="true">{tiles.map(tile => <image key={tile.key} href={tile.url} x={tile.x} y={tile.y} width={tile.size + .1} height={tile.size + .1} className="flood-osm-tile" onError={() => setTileUnavailable(true)} />)}</g>
      {layers.origins && !!graph.coverage?.length && <polygon points={points(graph.coverage)} className="escape-coverage"><title>Envolvente de referencia urbana; no es el límite oficial ni representa todas las calles</title></polygon>}
      {layers.origins && (graph.spawn_zones ?? []).map(zone => <g key={zone.id}><polygon points={points(zone.geometry)} className="escape-spawn-zone"><title>{zone.name} · zona de aparición · {zone.source}</title></polygon>{zone.geometry[0] && <text x={projection.point(zone.geometry[0]).x} y={projection.point(zone.geometry[0]).y - 8} className="escape-zone-label">{zone.name}</text>}</g>)}
      {layers.roads && roads}
      <g pointerEvents={pickingPosition ? 'none' : undefined}><AnimatedEntities graph={graph} observation={visibleObservation} project={projection.point} view={view} active={controls.active} clustering={controls.clustering} selected={selected?.id} onSelect={pickingPosition ? undefined : onSelect} /></g>
      {layers.routes && selected && <polyline points={points(routeGeometry(graph, selected))} className="escape-planned-route"><title>Ruta publicada de {selected.id}</title></polyline>}
      {layers.shelters && (shelters ?? world?.shelters ?? graph.shelters).map(shelter => {
        const point = projection.nodes.get(shelter.node_id);
        return point ? <g key={shelter.id} data-shelter-id={shelter.id}><rect x={point.x - 6} y={point.y - 6} width="12" height="12" rx="2" className="escape-shelter"><title>Refugio ficticio {shelter.id} · {shelter.occupancy}/{shelter.capacity} ocupadas · {shelter.reserved} reservadas · {shelter.available} disponibles</title></rect><text x={point.x + 10} y={point.y + 4} className="escape-map-label">{shelter.id}</text></g> : null;
      })}
      {preview && <circle data-layer="shelter-preview" cx={preview.x} cy={preview.y} r={10} className="map-preview"><title>Ubicación provisional pendiente de confirmar</title></circle>}
    </svg><MapAttribution /></div>
    <figcaption>{layers.survivors && <span className="escape-legend-survivor">● Superviviente</span>}{layers.zombies && <span className="escape-legend-zombie">● Zombi visible</span>}{layers.shelters && <span className="escape-legend-shelter">■ Refugio ficticio</span>}{layers.origins && <span>▱ Zonas de aparición · ┄ Referencia urbana</span>}{layers.routes && <span>— Ruta seleccionada</span>}{layers.roads && <span>Rojo: vía bloqueada</span>}</figcaption>
    <p className="visual-notice">Simulación sintética · H: una horda, sin estimar integrantes · ✓ Refugio alcanzado · × Mordido.</p>{tileUnavailable && <p role="status" className="muted">Fondo no disponible; conservamos la red vectorial OpenStreetMap.</p>}<details className="map-footer"><summary>Datos del mapa</summary><p className="muted">{graph.source} · {graph.nodes.length.toLocaleString('es-EC')} intersecciones · {graph.edges.length.toLocaleString('es-EC')} aristas. Geografía real; refugios y escenarios experimentales.</p></details>
  </figure>;
}
