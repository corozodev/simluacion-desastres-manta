import type { GeoPoint, Graph, ScenarioSnapshot, WorldSnapshot, Zombie } from '@corodev/contracts';

export type Point = { x: number; y: number };
export type View = Point & { width: number; height: number };
export type ZombieVariant = Zombie['type'];
export type VisualEntity = { key: string; id: string; kind: 'survivor' | 'zombie'; node: string; state: string; path?: string[]; horde?: boolean; zombieType?: ZombieVariant; event?: string };
export const zombieVariant = (entity: VisualEntity): ZombieVariant => entity.zombieType ?? (entity.horde ? 'horde' : 'walker');
export type Observation = { id: string; graphVersion: string; scenario: string; tick: number; running: boolean; connected: boolean; interval: number; entities: VisualEntity[] };
export const visualLimits = { maxAnimated: 120, maxIndividual: 240, frameMs: 250, maxInterpolationMs: 1200, staleMs: 5000 } as const;

export function entitiesFromWorld(world?: WorldSnapshot): VisualEntity[] {
  return [...(world?.survivors ?? []).filter(s => !s.vehicle_id).map(s => ({ key: `survivor:${s.id}`, id: s.id, kind: 'survivor' as const, node: s.current_node, state: s.status, event: world?.events.some(event => event.entity_id === s.id && event.type === 'bitten' && event.turn === world.turn) ? 'bitten' : undefined })),
    ...(world?.zombies ?? []).filter(z => z.type !== 'sleeper' || z.awake).map(z => ({ key: `zombie:${z.id}`, id: z.id, kind: 'zombie' as const, node: z.current_node, state: z.movement_state, path: z.path, horde: z.type === 'horde', zombieType: z.type === 'sleeper' ? 'walker' as const : z.type }))];
}
export function entitiesFromFlood(scenario?: ScenarioSnapshot): VisualEntity[] {
  return (scenario?.agents ?? []).map(a => ({ key: `survivor:${a.id}`, id: a.id, kind: 'survivor', node: a.current_node, state: a.state }));
}
export function compatible(a: Observation | undefined, b: Observation) {
  return Boolean(a && a.id && a.id === b.id && a.graphVersion === b.graphVersion && a.scenario === b.scenario && b.tick === a.tick + 1 && a.running && b.running && a.connected && b.connected);
}
export function geometryIndex(graph: Graph, project: (point: GeoPoint) => Point) {
  const nodes = new Map(graph.nodes.map(n => [n.id, project(n)]));
  const edges = new Map<string, Point[] | null>();
  const addEdge = (key: string, path: Point[]) => {
    if (!edges.has(key)) edges.set(key, path);
    else if (JSON.stringify(edges.get(key)) !== JSON.stringify(path)) edges.set(key, null);
  };
  for (const e of graph.edges) {
    const from = nodes.get(e.from), to = nodes.get(e.to);
    if (!from || !to) continue;
    const points = e.geometry?.length ? e.geometry.map(project) : [from, to];
    // Anchor the polyline to real graph endpoints, never connect unknown nodes.
    const path = [from, ...points, to];
    addEdge(`${e.from}\0${e.to}`, path);
    if (!e.directed) addEdge(`${e.to}\0${e.from}`, [...path].reverse());
  }
  return { nodes, edges };
}
export function entityPath(previous: VisualEntity | undefined, current: VisualEntity, index: ReturnType<typeof geometryIndex>): Point[] {
  if (!previous || previous.key !== current.key || previous.node === current.node || ['bitten', 'evacuated', 'waiting', 'isolated', 'resting'].includes(current.state)) return [];
  const route = current.kind === 'zombie' ? current.path : [previous.node, current.node];
  if (!route || route.length < 2 || route[0] !== previous.node || route.at(-1) !== current.node) return [];
  const path: Point[] = [];
  for (let i = 1; i < route.length; i++) {
    const segment = index.edges.get(`${route[i - 1]}\0${route[i]}`);
    if (!segment) return [];
    path.push(...segment);
  }
  return path;
}
export function samplePath(path: Point[], progress: number): Point | undefined {
  if (!path.length) return undefined;
  const lengths = path.slice(1).map((p, i) => Math.hypot(p.x - path[i]!.x, p.y - path[i]!.y));
  let distance = lengths.reduce((a, b) => a + b, 0) * Math.max(0, Math.min(1, progress));
  for (let i = 0; i < lengths.length; i++) {
    const length = lengths[i]!;
    if (distance <= length && length > 0) { const a = path[i]!, b = path[i + 1]!; return { x: a.x + (b.x - a.x) * distance / length, y: a.y + (b.y - a.y) * distance / length }; }
    distance -= length;
  }
  return path.at(-1);
}
export function direction(path: Point[]): 'north' | 'south' | 'east' | 'west' {
  const a = path[0], b = path.at(-1);
  if (!a || !b) return 'south';
  const dx = b.x - a.x, dy = b.y - a.y;
  return Math.abs(dx) > Math.abs(dy) ? dx > 0 ? 'east' : 'west' : dy < 0 ? 'north' : 'south';
}
export type DisplayEntity = { key: string; point: Point; members: VisualEntity[]; kind: VisualEntity['kind']; state: string };
export function levelOfDetail(entities: VisualEntity[], nodes: Map<string, Point>, view: View, clustering: boolean, selected = '', maxIndividual: number = visualLimits.maxIndividual): DisplayEntity[] {
  const unit = view.width / 900, padding = 32 * unit;
  const visible = entities.flatMap(entity => {
    const p = nodes.get(entity.node);
    return p && p.x >= view.x - padding && p.x <= view.x + view.width + padding && p.y >= view.y - padding && p.y <= view.y + view.height + padding ? [{ entity, point: p }] : [];
  });
  const close = view.width <= 420, cell = (view.width >= 750 ? 44 : 28) * unit;
  const aggregate = clustering && !close || visible.length > maxIndividual;
  const buckets = new Map<string, DisplayEntity>();
  for (const { entity, point } of visible) {
    // Keep kinds and final states distinct; selected entities remain discoverable.
    const kind = entity.kind === 'zombie' ? zombieVariant(entity) : entity.kind;
    const key = entity.id === selected ? entity.key : aggregate ? `${kind}:${entity.state}:${Math.floor(point.x / cell)}:${Math.floor(point.y / cell)}` : clustering ? `${kind}:${entity.state}:${entity.node}` : entity.key;
    const bucket = buckets.get(key);
    if (bucket) bucket.members.push(entity);
    else buckets.set(key, { key, point, members: [entity], kind: entity.kind, state: entity.state });
  }
  // Cluster marker sits at an actual observed member node, never an invented location.
  return [...buckets.values()].sort((a, b) => Number(a.members[0]?.id === selected) - Number(b.members[0]?.id === selected));
}
