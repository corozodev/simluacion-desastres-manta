import type { Point, View } from './model';
// Use the rendered SVG matrix, including responsive meet/letterboxing and zoom.
export function mapPointer(svg: SVGSVGElement, client: Point, view: View): Point {
  const matrix = svg.getScreenCTM?.();
  if (matrix && svg.createSVGPoint) {
    const p = svg.createSVGPoint(); p.x = client.x; p.y = client.y;
    const result = p.matrixTransform(matrix.inverse());
    return { x: result.x, y: result.y };
  }
  const rect = svg.getBoundingClientRect();
  return { x: view.x + (client.x - rect.left) / (rect.width || 900) * view.width, y: view.y + (client.y - rect.top) / (rect.height || 480) * view.height };
}
