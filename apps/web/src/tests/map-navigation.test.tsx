import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Graph, Incident } from '@corodev/contracts';
import { WorldMap } from '../features/WorldMap';
import { FloodMap } from '../features/flood/FloodMap';
import { mapProjection, mapTiles } from '../features/visualization/projection';
import { config } from '../lib/config';
import { graph, world } from './simulation-fixtures';

const originalTiles = config.osmTilesEnabled;
afterEach(() => { config.osmTilesEnabled = originalTiles; vi.restoreAllMocks(); });
const incident = { incident_id: 'report-map', incident_type: 'fallen_tree', source_type: 'citizen', verification_status: 'pending', latitude: graph.nodes[0]!.lat, longitude: graph.nodes[0]!.lng, description: '<script>texto no confiable</script>', event_time: '2026-10-27T12:36:00Z', expires_at: '2026-10-28T12:36:00Z', severity_reported: 'moderate', road_passability_reported: 'blocked' } as Incident;

describe('cámara y mapa compartidos', () => {
  it.each(['manta-v2', 'manta-master'])('encuadra la red operativa real sin cambiar coordenadas ni rutas: %s', name => {
    const network = JSON.parse(readFileSync(`../../services/evacuation/data/${name}.json`, 'utf8')) as Graph;
    const before = JSON.stringify(network);
    const projection = mapProjection(network);
    const points = network.nodes.map(projection.point);
    const width = Math.max(...points.map(point => point.x)) - Math.min(...points.map(point => point.x));
    const height = Math.max(...points.map(point => point.y)) - Math.min(...points.map(point => point.y));
    expect(width).toBeGreaterThan(700);
    expect(height).toBeGreaterThan(300);
    expect(points.every(point => point.x >= 24 && point.x <= 876 && point.y >= 24 && point.y <= 456)).toBe(true);
    expect(JSON.stringify(network)).toBe(before);
  });

  it('alinea las teselas OSM y las coordenadas del grafo en la misma proyección Mercator', () => {
    config.osmTilesEnabled = true;
    const projection = mapProjection(graph);
    const tiles = mapTiles(projection, { x: 0, y: 0, width: 900, height: 480 });
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.length).toBeLessThanOrEqual(32);
    for (const tile of tiles) {
      const [z, x, y] = tile.key.split('/').map(Number);
      const normalized = projection.inverse({ x: tile.x, y: tile.y });
      expect(normalized.x).toBeCloseTo(x! / 2 ** z!, 10);
      expect(normalized.y).toBeCloseTo(y! / 2 ** z!, 10);
      expect(tile.size).toBeCloseTo(projection.scale / 2 ** z!, 10);
    }
    for (const node of graph.nodes) {
      const normalized = projection.inverse(projection.point(node));
      expect(normalized.x * 360 - 180).toBeCloseTo(node.lng, 9);
      expect(Math.atan(Math.sinh(Math.PI * (1 - 2 * normalized.y))) * 180 / Math.PI).toBeCloseTo(node.lat, 9);
    }
  });

  it.each(['zombie', 'flood'])('usa Ctrl+rueda, doble clic, teclado y restablecimiento sin capturar el scroll normal: %s', kind => {
    config.osmTilesEnabled = false;
    render(kind === 'zombie' ? <WorldMap graph={graph} /> : <FloodMap graph={graph} shelters={graph.shelters} candidates={[]} selectedAgentId="" onSelectAgent={() => undefined} onPickPosition={() => undefined} />);
    const map = screen.getByRole('img');
    const initial = map.getAttribute('viewBox');
    const scroll = new WheelEvent('wheel', { deltaY: -100, clientX: 250, clientY: 180, bubbles: true, cancelable: true });
    fireEvent(map, scroll);
    expect(scroll.defaultPrevented).toBe(false);
    expect(map.getAttribute('viewBox')).toBe(initial);
    const zoom = new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, clientX: 250, clientY: 180, bubbles: true, cancelable: true });
    fireEvent(map, zoom);
    expect(zoom.defaultPrevented).toBe(true);
    expect(map.getAttribute('viewBox')).not.toBe(initial);
    fireEvent.click(screen.getByRole('button', { name: 'Restablecer vista' }));
    expect(map.getAttribute('viewBox')).toBe(initial);
    fireEvent.doubleClick(map, { clientX: 300, clientY: 250 });
    expect(map.getAttribute('viewBox')).not.toBe(initial);
    fireEvent.keyDown(map, { key: '0' });
    expect(map.getAttribute('viewBox')).toBe(initial);
    fireEvent.keyDown(map, { key: 'ArrowRight' });
    expect(map.getAttribute('viewBox')).not.toBe(initial);
    expect(screen.queryByRole('button', { name: /Acercar|Alejar|Mover mapa/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '© OpenStreetMap contributors' })).toBeInTheDocument();
  });

  it.each(['zombie', 'flood'])('retira iconos de teselas fallidas y conserva calles y controles: %s', scenario => {
    config.osmTilesEnabled = true;
    if (scenario === 'zombie') render(<WorldMap graph={graph} />);
    else render(<FloodMap graph={graph} shelters={graph.shelters} candidates={[]} selectedAgentId="" onSelectAgent={() => undefined} onPickPosition={() => undefined} />);
    const tile = document.querySelector('[data-layer="osm-base"] image')!;
    expect(tile).not.toBeNull();
    fireEvent.error(tile);
    expect(tile).toHaveAttribute('visibility', 'hidden');
    expect(screen.getByText(/conservamos la red vectorial|La red vectorial OpenStreetMap y los controles siguen activos/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restablecer vista' })).toBeEnabled();
    expect(document.querySelector('.escape-road, path[data-road-state]')).not.toBeNull();
    fireEvent.load(tile);
    expect(tile).not.toHaveAttribute('visibility');
  });

  it('conserva el cursor geográfico al hacer zoom y elige posiciones reales; Escape cancela', () => {
    config.osmTilesEnabled = false;
    const pick = vi.fn(), cancel = vi.fn();
    render(<WorldMap graph={graph} pickingPosition onPickPosition={pick} onCancelPick={cancel} />);
    const map = screen.getByRole('img');
    fireEvent(map, new WheelEvent('wheel', { ctrlKey: true, deltaY: -200, clientX: 450, clientY: 240, bubbles: true, cancelable: true }));
    fireEvent.click(map, { clientX: 450, clientY: 240 });
    const projected = mapProjection(graph).point(pick.mock.calls[0]![0]);
    expect(projected.x).toBeCloseTo(450, 4);
    expect(projected.y).toBeCloseTo(240, 4);
    fireEvent.keyDown(map, { key: 'Escape' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each(['zombie', 'flood'])('permite elegir un refugio con teclado sobre el centro geográfico visible: %s', scenario => {
    config.osmTilesEnabled = false;
    const pick = vi.fn();
    render(scenario === 'zombie' ? <WorldMap graph={graph} pickingPosition onPickPosition={pick} /> : <FloodMap graph={graph} shelters={graph.shelters} candidates={[]} selectedAgentId="" onSelectAgent={() => undefined} pickingCandidate={0} onPickPosition={pick} />);
    const map = screen.getByRole('img');
    fireEvent.keyDown(map, { key: 'ArrowRight' });
    fireEvent.keyDown(map, { key: '+' });
    const view = map.getAttribute('viewBox')!.split(' ').map(Number);
    fireEvent.keyDown(map, { key: 'Enter' });
    expect(pick).toHaveBeenCalledOnce();
    const point = mapProjection(graph).point(pick.mock.calls[0]![0]);
    expect(point.x).toBeCloseTo(view[0]! + view[2]! / 2, 5);
    expect(point.y).toBeCloseTo(view[1]! + view[3]! / 2, 5);
  });

  it('arrastra y pellizca sin convertir el gesto en una selección de refugio', () => {
    config.osmTilesEnabled = false;
    const pick = vi.fn();
    render(<WorldMap graph={graph} pickingPosition onPickPosition={pick} />);
    const map = screen.getByRole('img');
    const pointer = (type: string, id: number, x: number, y: number) => {
      const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
      Object.defineProperty(event, 'pointerId', { value: id });
      fireEvent(map, event);
    };
    const initial = map.getAttribute('viewBox');
    pointer('pointerdown', 1, 200, 200);
    pointer('pointermove', 1, 250, 220);
    pointer('pointerup', 1, 250, 220);
    expect(map.getAttribute('viewBox')).not.toBe(initial);
    fireEvent.click(map, { clientX: 250, clientY: 220 });
    expect(pick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Restablecer vista' }));
    pointer('pointerdown', 1, 300, 240);
    pointer('pointerdown', 2, 600, 240);
    pointer('pointermove', 2, 750, 240);
    expect(Number(map.getAttribute('viewBox')!.split(' ')[2])).toBeLessThan(900);
    pointer('pointerup', 1, 300, 240);
    pointer('pointerup', 2, 750, 240);
    fireEvent.click(map, { clientX: 750, clientY: 240 });
    expect(pick).not.toHaveBeenCalled();
  });

  it('mantiene capas plegadas y retira sus símbolos de la leyenda al apagarlas', () => {
    config.osmTilesEnabled = false;
    render(<WorldMap graph={graph} />);
    expect(screen.getByText('Capas', { selector: 'summary' }).parentElement).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('Capas', { selector: 'summary' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Refugios' }));
    expect(screen.queryByText('■ Refugio ficticio')).not.toBeInTheDocument();
    expect(document.querySelector('[data-shelter-id]')).not.toBeInTheDocument();
  });

  it('conserva renderer, cámara y capas al pasar de exploración a ejecución con HUD', () => {
    config.osmTilesEnabled = false;
    const { rerender } = render(<WorldMap graph={graph} hud={<span>Preparado</span>} />);
    const map = screen.getByRole('img');
    fireEvent.keyDown(map, { key: '+' });
    fireEvent.keyDown(map, { key: 'ArrowRight' });
    const camera = map.getAttribute('viewBox');
    fireEvent.click(screen.getByText('Capas', { selector: 'summary' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Zonas de aparición' }));
    rerender(<WorldMap graph={graph} world={world} hud={<span>Turno 4/150</span>} />);
    expect(screen.getByRole('img')).toBe(map);
    expect(map).toHaveAttribute('viewBox', camera);
    expect(screen.getByRole('checkbox', { name: 'Zonas de aparición' })).not.toBeChecked();
    expect(screen.getByText('Turno 4/150')).toBeInTheDocument();
  });

  it('los controles HTML del HUD no disparan selección ni zoom cartográfico', () => {
    config.osmTilesEnabled = false;
    const select = vi.fn(), action = vi.fn();
    render(<WorldMap graph={graph} pickingPosition onPickPosition={select} panel={<button onClick={action}>Refugios y agentes</button>} metrics={<button>Métricas</button>} />);
    const map = screen.getByRole('img'), camera = map.getAttribute('viewBox');
    const panel = screen.getByRole('button', { name: 'Refugios y agentes' });
    fireEvent.pointerDown(panel, { button: 0, clientX: 200, clientY: 200 });
    fireEvent.click(panel);
    const zoom = new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, bubbles: true, cancelable: true });
    fireEvent(panel, zoom);
    expect(action).toHaveBeenCalledOnce();
    expect(select).not.toHaveBeenCalled();
    expect(zoom.defaultPrevented).toBe(false);
    expect(map).toHaveAttribute('viewBox', camera);
  });

  it('localiza el refugio seleccionado una vez y conserva cámara ante nuevos snapshots', () => {
    config.osmTilesEnabled = false;
    const select = vi.fn();
    const { rerender } = render(<WorldMap graph={graph} world={world} selectedShelterId="R-2" onSelectShelter={select} />);
    const map = screen.getByRole('img');
    const view = map.getAttribute('viewBox')!.split(' ').map(Number), expected = mapProjection(graph).nodes.get('N-0001')!;
    expect(view[0]! + view[2]! / 2).toBeCloseTo(expected.x);
    expect(view[1]! + view[3]! / 2).toBeCloseTo(expected.y);
    fireEvent.keyDown(map, { key: 'ArrowRight' });
    const moved = map.getAttribute('viewBox');
    rerender(<WorldMap graph={graph} world={{ ...world, turn: world.turn + 1 }} selectedShelterId="R-2" onSelectShelter={select} />);
    expect(map).toHaveAttribute('viewBox', moved);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Localizar refugio R-1' }), { key: 'Enter' });
    expect(select).toHaveBeenCalledWith('R-1');
    expect(map.querySelector('[data-shelter-id="R-2"]')).toHaveClass('map-shelter-selected');
  });

  it('abre un popup seguro desde el marcador y mantiene las fuentes diferenciadas', () => {
    config.osmTilesEnabled = false;
    const select = vi.fn(), inspect = vi.fn();
    render(<FloodMap graph={graph} shelters={graph.shelters} candidates={[]} selectedAgentId="" onSelectAgent={() => undefined} onPickPosition={() => undefined} incidents={[incident]} onSelectIncident={select} onOpenIncident={inspect} />);
    const marker = screen.getByRole('button', { name: /Seleccionar incidente en mapa report-map/ });
    fireEvent.keyDown(marker, { key: 'Enter' });
    const popup = screen.getByRole('region', { name: 'Reporte en mapa: Árbol caído' });
    expect(popup).toHaveTextContent('<script>texto no confiable</script>');
    expect(popup.querySelector('script')).toBeNull();
    expect(popup).toHaveTextContent('Bloqueada');
    expect(popup).toHaveTextContent('Moderada');
    expect(popup).toHaveTextContent('Pendiente de verificación');
    expect(select).toHaveBeenCalledWith(incident.incident_id);
    fireEvent.click(screen.getByRole('button', { name: 'Detalles y evaluación experimental' }));
    expect(inspect).toHaveBeenCalledWith(incident.incident_id);
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar reporte del mapa' }));
    expect(screen.queryByRole('region', { name: /Reporte en mapa/ })).not.toBeInTheDocument();
  });
});
