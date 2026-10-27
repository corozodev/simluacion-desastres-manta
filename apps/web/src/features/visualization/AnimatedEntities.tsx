import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { GeoPoint, Graph } from '@corodev/contracts';
import catalog from '../../../../../packages/visualization/catalog.json';
import { compatible, direction, entityPath, geometryIndex, levelOfDetail, samplePath, visualLimits } from './model';
import type { Observation, Point, View } from './model';

export { catalog };
// One RAF per map: positions update at at most 30 Hz; all atlas frames at 4 Hz.
// The callback never calls an API or changes observable simulation data.
export function startVisualClock(update: (elapsed: number) => void, duration: number, hz = 30) {
  let request = 0, last = -Infinity;
  const start = performance.now();
  const frame = (now: number) => {
    const elapsed = now - start;
    if (now - last >= 1000 / hz || elapsed >= duration) { update(Math.min(elapsed, duration)); last = now; }
    if (elapsed < duration) request = requestAnimationFrame(frame);
  };
  request = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(request);
}

export function AnimatedEntities({ graph, observation, project, view, active, clustering, selected = '', onSelect, water = false, waterPoints = [], maxAnimated = visualLimits.maxAnimated, maxIndividual = visualLimits.maxIndividual }: {
  graph: Graph; observation?: Observation; project: (point: GeoPoint) => Point; view: View; active: boolean; clustering: boolean; selected?: string; onSelect?: (id: string) => void; water?: boolean; waterPoints?: Point[]; maxAnimated?: number; maxIndividual?: number;
}) {
  const id = useId().replace(/:/g, '');
  const root = useRef<SVGGElement>(null);
  const previous = useRef<Observation | undefined>(undefined);
  const received = useRef({ key: '', at: 0 });
  const [mapWidth, setMapWidth] = useState(900);
  useEffect(() => {
    const svg = root.current?.ownerSVGElement;
    if (!svg) return;
    const resize = () => setMapWidth(svg.getBoundingClientRect().width || 900);
    resize();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(resize);
    observer?.observe(svg);
    return () => observer?.disconnect();
  }, []);
  const [failed, setFailed] = useState<string[]>([]);
  const index = useMemo(() => geometryIndex(graph, project), [graph, project]);
  const display = useMemo(() => levelOfDetail(observation?.graphVersion === graph.version ? observation.entities : [], index.nodes, view, clustering, selected, maxIndividual), [observation, graph.version, index, view, clustering, selected, maxIndividual]);
  const visibleWater = useMemo(() => water && view.width <= 420 && !failed.includes('ripples') ? waterPoints.filter(p => p.x >= view.x && p.x <= view.x + view.width && p.y >= view.y && p.y <= view.y + view.height).slice(0, 24) : [], [water, waterPoints, view, failed]);
  const hasWater = visibleWater.length > 0;
  useEffect(() => {
    const element = root.current;
    if (!element || !observation) { previous.current = undefined; received.current = { key: '', at: 0 }; return; }
    const key = `${observation.id}:${observation.graphVersion}:${observation.scenario}:${observation.tick}`;
    if (received.current.key !== key) received.current = { key, at: performance.now() };
    const prior = previous.current;
    previous.current = observation;
    const canMove = active && compatible(prior, observation) && observation.graphVersion === graph.version;
    const old = new Map(prior?.entities.map(entity => [entity.key, entity]) ?? []);
    const duration = Math.max(1, Math.min(visualLimits.maxInterpolationMs, observation.interval * .8));
    const tracks: { element: SVGGElement; sprite: SVGUseElement | null; path: Point[]; symbol: string }[] = [];
    const groups = element.querySelectorAll<SVGGElement>('[data-display-key]');
    let animated = 0;
    groups.forEach((group, i) => {
      const item = display[i]; if (!item) return;
      group.setAttribute('transform', `translate(${item.point.x},${item.point.y})`);
      const entity = item.members[0]!;
      const path = canMove && item.members.length === 1 && animated < maxAnimated ? entityPath(old.get(entity.key), entity, index) : [];
      const sprite = group.querySelector<SVGUseElement>('[data-sprite]');
      const symbol = `${id}-${item.kind}-${direction(path)}`;
      sprite?.setAttribute('href', `#${symbol}-idle`);
      if (path.length) { group.setAttribute('transform', `translate(${path[0]!.x},${path[0]!.y})`); animated++; tracks.push({ element: group, sprite, path, symbol }); }
    });
    const infections = canMove ? [...element.querySelectorAll<SVGCircleElement>('[data-infection-event]')].filter(circle => old.get(circle.getAttribute('data-infection-event') ?? '')?.state === 'active') : [];
    const atlasFrames = element.querySelectorAll<SVGImageElement>('[data-walk-frame]');
    const ripples = element.querySelectorAll<SVGImageElement>('[data-water-frame]');
    const resetFrames = () => { atlasFrames.forEach(image => image.setAttribute('x', '0')); ripples.forEach(image => image.setAttribute('x', '0')); };
    resetFrames();
    if (!active || (!tracks.length && !hasWater && !infections.length)) return;
    const freshFor = Math.max(0, visualLimits.staleMs - (performance.now() - received.current.at));
    if (!freshFor) return;
    let lastFrame = -1;
    const stop = startVisualClock(elapsed => {
      const progress = Math.min(1, elapsed / duration);
      const frame = Math.floor(elapsed / visualLimits.frameMs) % 4;
      if (frame !== lastFrame) {
        if (tracks.length) atlasFrames.forEach(image => image.setAttribute('x', String(-frame * 64)));
        if (hasWater) ripples.forEach(image => image.setAttribute('x', String(-frame * 32)));
        lastFrame = frame;
      }
      for (const track of tracks) {
        const p = samplePath(track.path, progress)!;
        track.element.setAttribute('transform', `translate(${p.x},${p.y})`);
        track.sprite?.setAttribute('href', `#${track.symbol}-${progress < 1 ? 'walk' : 'idle'}`);
      }
      infections.forEach(circle => { circle.setAttribute('r', String(11 + Math.min(1, elapsed / 600) * 7)); circle.setAttribute('opacity', String(Math.max(0, 1 - elapsed / 600))); });
      element.setAttribute('data-animation-frame', String(frame));
    }, hasWater ? freshFor : Math.min(Math.max(duration, infections.length ? 600 : 0), freshFor), tracks.length ? 30 : 4);
    return stop;
  }, [observation, index, graph.version, display, active, hasWater, maxAnimated, id, failed]);
  const unit = view.width / mapWidth;
  return <g ref={root} data-layer="animated-entities" data-animation-active={active} data-rendered-entities={display.length}>
    <defs>{catalog.assets.filter(asset => asset.entity !== 'water-decoration').flatMap(asset => asset.directions.flatMap((dir, row) => ['idle', 'walk'].map(state => <symbol key={`${asset.id}-${dir}-${state}`} id={`${id}-${asset.id}-${dir}-${state}`} viewBox="0 0 64 64" overflow="hidden"><image href={`/visualization/${asset.file}`} width={256} height={256} x={0} y={-row * 64} data-walk-frame={state === 'walk' ? true : undefined} onError={() => setFailed(previous => previous.includes(asset.id) ? previous : [...previous, asset.id])} /></symbol>)))}
      <symbol id={`${id}-ripples`} viewBox="0 0 32 32" overflow="hidden"><image href="/visualization/ripples.png" width={128} height={32} data-water-frame onError={() => setFailed(previous => previous.includes('ripples') ? previous : [...previous, 'ripples'])} /></symbol>
    </defs>
    {display.map(item => {
      const entity = item.members[0]!, cluster = item.members.length > 1;
      const status = ({ active: 'Activo', moving: 'En movimiento', chasing: 'Persiguiendo', resting: 'Quieto', waiting: 'Esperando', isolated: 'Aislado', evacuated: 'Refugio alcanzado', bitten: 'Mordido' } as Record<string, string>)[entity.state] ?? entity.state;
      const label = cluster ? `${item.members.length} ${item.kind === 'zombie' ? 'amenazas visibles' : 'sobrevivientes'} · ${status}` : `${entity.id} · ${status}${entity.horde ? ' · 1 horda (integrantes no publicados)' : ''}`;
      return <g key={item.key} data-display-key={item.key} data-agent-id={cluster ? undefined : entity.id} data-count={item.members.length} data-state={entity.state} className={`visual-entity escape-${item.kind} visual-${entity.state}`} transform={`translate(${item.point.x},${item.point.y})`} role={onSelect && !cluster ? 'button' : undefined} tabIndex={onSelect && !cluster ? 0 : undefined} aria-label={label} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); if (!cluster) onSelect?.(entity.id); }} onKeyDown={event => { if (['Enter', ' '].includes(event.key) && !cluster && onSelect) { event.preventDefault(); event.stopPropagation(); onSelect(entity.id); } }}>
        <title>{label}</title><g transform={`scale(${unit})`}>
          {!cluster && entity.event === 'bitten' && <circle data-infection-event={entity.key} r={11} fill="none" stroke="var(--color-warning)" opacity={0} />}
          <circle r={cluster ? 13 : entity.id === selected ? 15 : 10} className={`visual-halo visual-halo-${item.kind}`} />
          {cluster ? <text className="visual-count" textAnchor="middle" dy=".35em">{item.members.length}</text> : <>
            {failed.includes(item.kind) ? <g data-fallback={item.kind} className={`visual-fallback visual-fallback-${item.kind}`}><circle cy={-6} r={4} /><path d="M-6,7V0Q0,-5 6,0V7M-3,6V12M3,6V12" /></g> : <use data-sprite href={`#${id}-${item.kind}-south-idle`} x={-14} y={item.kind === 'survivor' ? -28 : -14} width={28} height={28} />}
            {['bitten', 'evacuated', 'isolated', 'waiting'].includes(entity.state) && <text className="visual-state" x={10} y={-9}>{({ bitten: '×', evacuated: '✓', isolated: '!', waiting: 'Ⅱ' } as Record<string, string>)[entity.state]}</text>}
            {entity.horde && <text className="visual-state" x={10} y={-9}>H</text>}
          </>}
        </g>
      </g>;
    })}
    {/* Decorations are tied to real affected segments, with no invented water area. */}
    {hasWater && <g pointerEvents="none" aria-hidden="true" data-water-ripples>{visibleWater.map((p, i) => <use key={i} href={`#${id}-ripples`} x={p.x - 10 * unit} y={p.y - 10 * unit} width={20 * unit} height={20 * unit} />)}</g>}
  </g>;
}
