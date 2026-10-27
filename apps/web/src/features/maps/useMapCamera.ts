import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react';
import { mapPointer } from '../visualization/pointer';
import type { Point, View } from '../visualization/model';

export const initialMapView: View = { x: 0, y: 0, width: 900, height: 480 };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

// A camera observes only SVG coordinates. It never fetches geography or changes
// simulation state; the same interactions serve each scenario and renderer.
export function useMapCamera(graphVersion: string, onCancel?: () => void) {
  const svg = useRef<SVGSVGElement>(null);
  const [view, setView] = useState(initialMapView);
  const current = useRef(view);
  current.current = view;
  const aspect = useRef(900 / 480);
  const pointers = useRef(new Map<number, Point>());
  const origin = useRef<Point | undefined>(undefined);
  const moved = useRef(false);
  const cancel = useRef(onCancel);
  cancel.current = onCancel;
  const fit = (): View => {
    const width = Math.max(900, 480 * aspect.current), height = width / aspect.current;
    return { x: (900 - width) / 2, y: (480 - height) / 2, width, height };
  };
  const reset = () => { pointers.current.clear(); moved.current = false; setView(fit()); };
  const zoomAt = (factor: number, anchor?: Point) => setView(previous => {
    const width = Math.max(90, Math.min(3600, previous.width * factor));
    const ratio = width / previous.width;
    const target = anchor ?? { x: previous.x + previous.width / 2, y: previous.y + previous.height / 2 };
    return { x: target.x - (target.x - previous.x) * ratio, y: target.y - (target.y - previous.y) * ratio, width, height: previous.height * ratio };
  });
  useEffect(() => { reset(); }, [graphVersion]);
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      zoomAt(Math.exp(Math.max(-1, Math.min(1, event.deltaY * .002))), mapPointer(element, { x: event.clientX, y: event.clientY }, current.current));
    };
    const resize = () => {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const nextAspect = rect.width / rect.height;
      if (Math.abs(nextAspect - aspect.current) < .001) return;
      const oldFit = fit();
      const atInitial = Math.abs(current.current.width - oldFit.width) < .1 && Math.abs(current.current.x - oldFit.x) < .1 && Math.abs(current.current.y - oldFit.y) < .1;
      aspect.current = nextAspect;
      if (atInitial) setView(fit());
      else setView(previous => ({ ...previous, y: previous.y + (previous.height - previous.width / nextAspect) / 2, height: previous.width / nextAspect }));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(resize);
    observer?.observe(element);
    resize();
    return () => { element.removeEventListener('wheel', wheel); observer?.disconnect(); pointers.current.clear(); };
  }, []);
  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    const point = { x: event.clientX, y: event.clientY };
    if (!pointers.current.size) { origin.current = point; moved.current = false; }
    pointers.current.set(event.pointerId, point);
    if (pointers.current.size > 1) moved.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    const point = { x: event.clientX, y: event.clientY };
    const before = [...pointers.current.values()];
    pointers.current.set(event.pointerId, point);
    const after = [...pointers.current.values()];
    if (origin.current && distance(point, origin.current) > 4) moved.current = true;
    if (!moved.current) return;
    const from = mapPointer(event.currentTarget, before.length >= 2 ? midpoint(before[0]!, before[1]!) : previous, current.current);
    const to = mapPointer(event.currentTarget, after.length >= 2 ? midpoint(after[0]!, after[1]!) : point, current.current);
    if (before.length >= 2 && after.length >= 2) {
      const oldDistance = distance(before[0]!, before[1]!), newDistance = distance(after[0]!, after[1]!);
      if (oldDistance > 0 && newDistance > 0) setView(previousView => {
        const width = Math.max(90, Math.min(3600, previousView.width * oldDistance / newDistance)), ratio = width / previousView.width;
        return { x: from.x - (to.x - previousView.x) * ratio, y: from.y - (to.y - previousView.y) * ratio, width, height: previousView.height * ratio };
      });
      return;
    }
    setView(value => ({ ...value, x: value.x - to.x + from.x, y: value.y - to.y + from.y }));
  };
  const release = (event: PointerEvent<SVGSVGElement>) => { pointers.current.delete(event.pointerId); };
  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.target !== event.currentTarget && event.key !== 'Escape') return;
    const directions: Record<string, [number, number]> = { ArrowLeft: [-.15, 0], ArrowRight: [.15, 0], ArrowUp: [0, -.15], ArrowDown: [0, .15] };
    const delta = directions[event.key];
    if (delta) { event.preventDefault(); setView(previous => ({ ...previous, x: previous.x + delta[0] * previous.width, y: previous.y + delta[1] * previous.height })); }
    else if (['+', '=', '-', '0'].includes(event.key)) { event.preventDefault(); if (event.key === '0') reset(); else zoomAt(event.key === '-' ? 1 / .75 : .75); }
    else if (event.key === 'Escape') cancel.current?.();
  };
  const focus = (point: Point) => setView(previous => ({ ...previous, x: point.x - previous.width / 2, y: point.y - previous.height / 2 }));
  return { svg, view, reset, focus, consumeClick: () => { const consumed = moved.current; moved.current = false; return consumed; },
    bindings: { onPointerDown, onPointerMove, onPointerUp: release, onPointerCancel: release, onKeyDown,
      onDoubleClick: (event: MouseEvent<SVGSVGElement>) => { event.preventDefault(); zoomAt(.6, mapPointer(event.currentTarget, { x: event.clientX, y: event.clientY }, current.current)); } },
  };
}
