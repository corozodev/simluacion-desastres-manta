import { useMemo, useRef, useState } from 'react';
import type { GeoPoint, Graph, Survivor, WorldSnapshot } from '@corodev/contracts';
import { Button } from '../components/ui';
import { mapProjection, mapTiles } from './visualization/projection';
import { AnimatedEntities } from './visualization/AnimatedEntities';
import { useVisualization, VisualizationControls } from './visualization/useVisualization';
import { observeWorld } from './visualization/observation';
import type { VisualLifecycle } from './visualization/observation';

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

const initialView = { x: 0, y: 0, width: 900, height: 480 };

export function WorldMap({ graph, world, selected, lifecycle, onSelect }: { graph: Graph; world?: WorldSnapshot; selected?: Survivor; lifecycle?: VisualLifecycle; onSelect?: (id: string) => void }) {
  const observation = useMemo(() => observeWorld(world, lifecycle), [world, lifecycle]);
  const controls = useVisualization(observation);
  const [view, setView] = useState(initialView);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [tileUnavailable, setTileUnavailable] = useState(false);
  const projection = useMemo(() => mapProjection(graph), [graph]);
  const tiles = useMemo(() => mapTiles(projection, view), [projection, view]);
  const points = (coordinates: GeoPoint[]) => coordinates.map(coordinate => { const p = projection.point(coordinate); return `${p.x},${p.y}`; }).join(' ');
  const zoom = (factor: number) => setView(previous => {
    const width = Math.max(112.5, Math.min(1800, previous.width * factor)), height = width * 480 / 900;
    return { x: previous.x + (previous.width - width) / 2, y: previous.y + (previous.height - height) / 2, width, height };
  });
  const pan = (dx: number, dy: number) => setView(previous => ({ ...previous, x: previous.x + dx * previous.width, y: previous.y + dy * previous.height }));
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
  return <figure className="escape-map"><VisualizationControls controls={controls} /><div className="escape-map-controls" role="group" aria-label="Controles del mapa">
    <Button variant="secondary" onClick={() => zoom(.75)} aria-label="Acercar mapa">+</Button><Button variant="secondary" onClick={() => zoom(1 / .75)} aria-label="Alejar mapa">−</Button><Button variant="secondary" onClick={() => setView(initialView)}>Restablecer mapa</Button>
    <Button variant="secondary" onClick={() => pan(-.15, 0)} aria-label="Mover mapa al oeste">←</Button><Button variant="secondary" onClick={() => pan(0, -.15)} aria-label="Mover mapa al norte">↑</Button><Button variant="secondary" onClick={() => pan(0, .15)} aria-label="Mover mapa al sur">↓</Button><Button variant="secondary" onClick={() => pan(.15, 0)} aria-label="Mover mapa al este">→</Button><Button variant="secondary" disabled={!selected || !projection.nodes.has(selected.current_node)} onClick={() => { const p = selected && projection.nodes.get(selected.current_node); if (p) setView({ x: p.x - 150, y: p.y - 80, width: 300, height: 160 }); }}>Centrar agente</Button><output aria-label="Escala del mapa">{(900 / view.width).toFixed(1)}×</output>
  </div><svg viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`} role="img" tabIndex={0} aria-labelledby="escape-map-title escape-map-description" onKeyDown={event => {
    const movement: Record<string, [number, number]> = { ArrowLeft: [-.15, 0], ArrowRight: [.15, 0], ArrowUp: [0, -.15], ArrowDown: [0, .15] };
    if (movement[event.key]) { event.preventDefault(); pan(...movement[event.key]!); }
    else if (['+', '=', '-','0'].includes(event.key)) { event.preventDefault(); if (event.key === '0') setView(initialView); else zoom(event.key === '-' ? 1 / .75 : .75); }
  }} onPointerDown={event => { if (event.button !== 0) return; drag.current = { x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture?.(event.pointerId); }} onPointerMove={event => {
    if (!drag.current) return;
    const rect = event.currentTarget.getBoundingClientRect(), previous = drag.current;
    drag.current = { x: event.clientX, y: event.clientY };
    setView(current => ({ ...current, x: current.x - (event.clientX - previous.x) * current.width / (rect.width || 900), y: current.y - (event.clientY - previous.y) * current.height / (rect.height || 480) }));
  }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
    <title id="escape-map-title">Red de evacuación y posiciones observables</title><desc id="escape-map-description">Calles reales, envolvente de referencia urbana, zonas de aparición, bloqueos, sobrevivientes y zombies visibles. Arrastra para desplazar; usa flechas, +, − y 0 para navegar. La navegación se extiende fuera de las zonas de origen.</desc>
    <g data-layer="osm-base" aria-hidden="true">{tiles.map(tile => <image key={tile.key} href={tile.url} x={tile.x} y={tile.y} width={tile.size + .1} height={tile.size + .1} className="flood-osm-tile" onError={() => setTileUnavailable(true)} />)}</g>
    {!!graph.coverage?.length && <polygon points={points(graph.coverage)} className="escape-coverage"><title>Envolvente de referencia urbana; no es el límite oficial ni representa todas las calles</title></polygon>}
    {(graph.spawn_zones ?? []).map(zone => <g key={zone.id}><polygon points={points(zone.geometry)} className="escape-spawn-zone"><title>{zone.name} · zona de aparición · {zone.source}</title></polygon>{zone.geometry[0] && <text x={projection.point(zone.geometry[0]).x} y={projection.point(zone.geometry[0]).y - 8} className="escape-zone-label">{zone.name}</text>}</g>)}
    {roads}
    <AnimatedEntities graph={graph} observation={observation} project={projection.point} view={view} active={controls.active} clustering={controls.clustering} selected={selected?.id} onSelect={onSelect} />
    {selected && <polyline points={points(routeGeometry(graph, selected))} className="escape-planned-route"><title>Ruta publicada de {selected.id}</title></polyline>}
    {(world?.shelters ?? graph.shelters).map(shelter => {
      const point = projection.nodes.get(shelter.node_id);
      return point ? <g key={shelter.id}><rect x={point.x - 6} y={point.y - 6} width="12" height="12" rx="2" className="escape-shelter"><title>Refugio ficticio {shelter.id} · {shelter.occupancy}/{shelter.capacity}</title></rect><text x={point.x + 10} y={point.y + 4} className="escape-map-label">{shelter.id}</text></g> : null;
    })}
  </svg><figcaption><span className="escape-legend-survivor">● Sobreviviente</span><span className="escape-legend-zombie">● Zombie visible</span><span className="escape-legend-shelter">■ Refugio ficticio</span><span>▱ Zona de aparición</span><span>┄ Envolvente de referencia urbana</span><span>— Ruta seleccionada · rojo: bloqueo</span></figcaption>
    <p className="visual-notice">Simulación sintética · H: una entidad horda; integrantes no publicados. ✓ Refugio alcanzado · × Mordido. Las rutas simuladas no están certificadas para evacuaciones reales.</p><p className="flood-map-attribution"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a></p>{tileUnavailable && <p role="status" className="muted">Fondo no disponible; conservamos la red vectorial OpenStreetMap.</p>}<p className="muted">{graph.source} · {graph.nodes.length} nodos · {graph.edges.length} aristas</p></figure>;
}
