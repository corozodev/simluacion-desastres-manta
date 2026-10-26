import { useMemo, useRef, useState } from 'react';
import type { GeoPoint, Graph, Survivor, WorldSnapshot } from '@corodev/contracts';
import { Button } from '../components/ui';

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

export function WorldMap({ graph, world, selected }: { graph: Graph; world: WorldSnapshot; selected?: Survivor }) {
  const [view, setView] = useState(initialView);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const projection = useMemo(() => {
    const coordinates = [...graph.nodes, ...(graph.coverage ?? []), ...graph.edges.flatMap(edge => edge.geometry ?? []), ...(graph.spawn_zones ?? []).flatMap(zone => zone.geometry)];
    const left = Math.min(...coordinates.map(point => point.lng)), right = Math.max(...coordinates.map(point => point.lng));
    const bottom = Math.min(...coordinates.map(point => point.lat)), top = Math.max(...coordinates.map(point => point.lat));
    const scale = Math.min(850 / Math.max(right - left, .00001), 430 / Math.max(top - bottom, .00001));
    const offsetX = (900 - (right - left) * scale) / 2, offsetY = (480 - (top - bottom) * scale) / 2;
    const point = (coordinate: GeoPoint) => ({ x: offsetX + (coordinate.lng - left) * scale, y: offsetY + (top - coordinate.lat) * scale });
    return { point, nodes: new Map(graph.nodes.map(node => [node.id, point(node)])) };
  }, [graph]);
  const points = (coordinates: GeoPoint[]) => coordinates.map(coordinate => { const p = projection.point(coordinate); return `${p.x},${p.y}`; }).join(' ');
  const zoom = (factor: number) => setView(previous => {
    const width = Math.max(112.5, Math.min(1800, previous.width * factor)), height = width * 480 / 900;
    return { x: previous.x + (previous.width - width) / 2, y: previous.y + (previous.height - height) / 2, width, height };
  });
  const pan = (dx: number, dy: number) => setView(previous => ({ ...previous, x: previous.x + dx * previous.width, y: previous.y + dy * previous.height }));
  const blocked = new Set(world.blocked_edges);
  return <figure className="escape-map"><div className="escape-map-controls" role="group" aria-label="Controles del mapa">
    <Button variant="secondary" onClick={() => zoom(.75)} aria-label="Acercar mapa">+</Button><Button variant="secondary" onClick={() => zoom(1 / .75)} aria-label="Alejar mapa">−</Button><Button variant="secondary" onClick={() => setView(initialView)}>Restablecer mapa</Button>
    <Button variant="secondary" onClick={() => pan(-.15, 0)} aria-label="Mover mapa al oeste">←</Button><Button variant="secondary" onClick={() => pan(0, -.15)} aria-label="Mover mapa al norte">↑</Button><Button variant="secondary" onClick={() => pan(0, .15)} aria-label="Mover mapa al sur">↓</Button><Button variant="secondary" onClick={() => pan(.15, 0)} aria-label="Mover mapa al este">→</Button><output aria-label="Escala del mapa">{(900 / view.width).toFixed(1)}×</output>
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
    {!!graph.coverage?.length && <polygon points={points(graph.coverage)} className="escape-coverage"><title>Envolvente de referencia urbana; no es el límite oficial ni representa todas las calles</title></polygon>}
    {(graph.spawn_zones ?? []).map(zone => <g key={zone.id}><polygon points={points(zone.geometry)} className="escape-spawn-zone"><title>{zone.name} · zona de aparición · {zone.source}</title></polygon>{zone.geometry[0] && <text x={projection.point(zone.geometry[0]).x} y={projection.point(zone.geometry[0]).y - 8} className="escape-zone-label">{zone.name}</text>}</g>)}
    {graph.edges.map(edge => {
      const a = projection.nodes.get(edge.from), b = projection.nodes.get(edge.to);
      const geometry = edge.geometry?.length ? points(edge.geometry) : a && b ? `${a.x},${a.y} ${b.x},${b.y}` : '';
      return geometry ? <polyline key={edge.id} points={geometry} className={edge.blocked || blocked.has(edge.id) ? 'escape-road escape-road-blocked' : 'escape-road'}><title>{edge.road_type} · {Math.round(edge.distance_m)} m{edge.blocked || blocked.has(edge.id) ? ' · bloqueada' : ''}{edge.bridge ? ' · puente físico' : ''}</title></polyline> : null;
    })}
    {selected && <polyline points={points(routeGeometry(graph, selected))} className="escape-planned-route"><title>Ruta publicada de {selected.id}</title></polyline>}
    {world.survivors.filter(s => s.status === 'active' || s.id === selected?.id).map(survivor => {
      const point = projection.nodes.get(survivor.current_node);
      return point ? <circle key={survivor.id} cx={point.x} cy={point.y} r={survivor.id === selected?.id ? 7 : 3.6} className="escape-survivor"><title>{survivor.id} · {survivor.status}</title></circle> : null;
    })}
    {world.zombies.map(zombie => {
      const point = projection.nodes.get(zombie.current_node);
      return point ? <circle key={zombie.id} cx={point.x} cy={point.y} r={zombie.type === 'horde' ? 7 : 4.3} className="escape-zombie"><title>{zombie.id} · {zombie.type}</title></circle> : null;
    })}
    {world.shelters.map(shelter => {
      const point = projection.nodes.get(shelter.node_id);
      return point ? <g key={shelter.id}><rect x={point.x - 6} y={point.y - 6} width="12" height="12" rx="2" className="escape-shelter"><title>Refugio ficticio {shelter.id} · {shelter.occupancy}/{shelter.capacity}</title></rect><text x={point.x + 10} y={point.y + 4} className="escape-map-label">{shelter.id}</text></g> : null;
    })}
  </svg><figcaption><span className="escape-legend-survivor">● Sobreviviente</span><span className="escape-legend-zombie">● Zombie visible</span><span className="escape-legend-shelter">■ Refugio ficticio</span><span>▱ Zona de aparición</span><span>┄ Envolvente de referencia urbana</span><span>— Ruta seleccionada · rojo: bloqueo</span></figcaption>
    <p className="muted">{graph.source} · {graph.nodes.length} nodos · {graph.edges.length} aristas</p></figure>;
}
