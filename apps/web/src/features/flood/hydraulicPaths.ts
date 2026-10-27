import type { GeoPoint, ScenarioSnapshot } from '@corodev/contracts';

type Hydraulic = NonNullable<ScenarioSnapshot['hydraulic']>;
type Point = { x: number; y: number };
export const hydraulicDepthLabels = ['Profundidad 0,01–0,10 m', 'Profundidad >0,10–0,30 m', 'Profundidad >0,30 m'] as const;

/** A regular descriptor avoids transmitting one polygon per wet cell per turn. */
export function hydraulicDepthPaths(hydraulic: Hydraulic | undefined, point: (value: GeoPoint) => Point): string[] {
  const paths: string[][] = [[], [], []];
  if (!hydraulic) return paths.map(items => items.join(''));
  const { grid, depths_m: depths } = hydraulic;
  for (let index = 0; index < depths.length; index++) {
    const depth = depths[index]!;
    if (depth < .01) continue;
    const row = Math.floor(index / grid.cols), col = index % grid.cols;
    const southwest = { lat: grid.origin.lat + row * grid.lat_step, lng: grid.origin.lng + col * grid.lng_step };
    const a = point(southwest);
    const b = point({ lat: southwest.lat + grid.lat_step, lng: southwest.lng + grid.lng_step });
    const band = depth <= .1 ? 0 : depth <= .3 ? 1 : 2;
    paths[band]!.push(`M${a.x.toFixed(2)},${a.y.toFixed(2)}H${b.x.toFixed(2)}V${b.y.toFixed(2)}H${a.x.toFixed(2)}Z`);
  }
  return paths.map(items => items.join(''));
}
