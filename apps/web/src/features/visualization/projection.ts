import type { GeoPoint, Graph } from '@corodev/contracts';
import { config } from '../../lib/config';
import type { Point, View } from './model';
function mercator(p: GeoPoint): Point {
  return { x: (p.lng + 180) / 360, y: (1 - Math.asinh(Math.tan(Math.max(-85.05112878, Math.min(85.05112878, p.lat)) * Math.PI / 180)) / Math.PI) / 2 };
}
export function mapProjection(graph: Graph) {
  // Fit the network used by this scenario. The wider urban reference envelope
  // and origin polygons remain geographic overlays, accessible by panning;
  // they must not shrink the 300-node operational network at the initial zoom.
  const coordinates = [...graph.nodes, ...graph.edges.flatMap(e => e.geometry ?? [])].map(mercator);
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const p of coordinates) { left = Math.min(left, p.x); right = Math.max(right, p.x); top = Math.min(top, p.y); bottom = Math.max(bottom, p.y); }
  const scale = Math.min(850 / Math.max(right - left, 1e-8), 430 / Math.max(bottom - top, 1e-8));
  const offset = { x: (900 - (right - left) * scale) / 2, y: (480 - (bottom - top) * scale) / 2 };
  const normalized = (p: Point): Point => ({ x: offset.x + (p.x - left) * scale, y: offset.y + (p.y - top) * scale });
  const point = (p: GeoPoint) => normalized(mercator(p));
  const inverse = (p: Point): Point => ({ x: (p.x - offset.x) / scale + left, y: (p.y - offset.y) / scale + top });
  return { point, normalized, inverse, scale, nodes: new Map(graph.nodes.map(n => [n.id, point(n)])) };
}
export function mapTiles(model: ReturnType<typeof mapProjection>, view: View) {
  if (!config.osmTilesEnabled) return [];
  const zoom = Math.max(10, Math.min(18, Math.round(Math.log2(model.scale * 900 / view.width / 256))));
  const count = 2 ** zoom, first = model.inverse(view), last = model.inverse({ x: view.x + view.width, y: view.y + view.height });
  const tiles: { key: string; url: string; x: number; y: number; size: number }[] = [];
  for (let x = Math.max(0, Math.floor(first.x * count)); x <= Math.min(count - 1, Math.floor(last.x * count)); x++) {
    for (let y = Math.max(0, Math.floor(first.y * count)); y <= Math.min(count - 1, Math.floor(last.y * count)); y++) {
      if (tiles.length >= 32) return tiles;
      const p = model.normalized({ x: x / count, y: y / count });
      tiles.push({ key: `${zoom}/${x}/${y}`, url: config.osmTileUrlTemplate.replace('{z}', String(zoom)).replace('{x}', String(x)).replace('{y}', String(y)), ...p, size: model.scale / count });
    }
  }
  return tiles;
}
