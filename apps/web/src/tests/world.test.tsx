import { readFileSync } from 'node:fs';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Graph, WorldSnapshot } from '@corodev/contracts';
import { AppRoutes } from '../app/App';
import { api } from '../services/api';
import { config, readConfig } from '../lib/config';
import { routeGeometry } from '../features/WorldMap';

const graph = JSON.parse(readFileSync('../../packages/contracts/examples/graph.json', 'utf8')) as Graph;
const world = JSON.parse(readFileSync('../../packages/contracts/examples/world.json', 'utf8')) as WorldSnapshot;
world.survivors = [{ id: 'S-0001', current_node: 'N-0000', status: 'active', target_shelter_id: '', planned_route: [] }, { id: 'S-0002', current_node: 'N-0001', status: 'evacuated', target_shelter_id: 'R-2', planned_route: [] }];
world.metrics.active = 1;
world.metrics.evacuated = 1;

function renderEscape() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/escape']}><AppRoutes /></MemoryRouter></QueryClientProvider>);
}

afterEach(() => vi.restoreAllMocks());

describe('observación del mundo', () => {
  it('muestra datos HTTP, grafo accesible, refugios y búsqueda de sobrevivientes', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const path = new URL(String(input)).pathname;
      return new Response(JSON.stringify(path === '/estado' ? world : path === '/grafo' ? graph : { status: 'ok', service: 'test', version: '0.1.0' }));
    });
    renderEscape();
    expect(await screen.findByRole('img', { name: /Red de evacuación/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Escape de Manta' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('cell', { name: 'S-0001' })).toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar por ID' }), 'S-0002');
    expect(screen.queryByRole('cell', { name: 'S-0001' })).not.toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Evacuado' })).toBeInTheDocument();
    expect(screen.getByText(/SYNTHETIC CONTRACT EXAMPLE/)).toBeInTheDocument();
  });

  it('rechaza respuestas incompletas y sleepers aún ocultos', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ...world, metrics: {} })));
    await expect(api.world()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ...world, zombies: [{ id: 'hidden', type: 'sleeper', current_node: 'N-0000', awake: false, movement_state: 'resting', path: [] }] })));
    await expect(api.world()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('usa la URL pública de observación sin credenciales y conserva errores de la API', async () => {
    const previous = config.worldApiBaseUrl;
    config.worldApiBaseUrl = 'http://localhost:8080';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Esperando snapshot.', requestId: 'req-world', details: [] } }), { status: 503 }));
    try {
      await expect(api.world()).rejects.toMatchObject({ code: 'UNAVAILABLE', requestId: 'req-world' });
      expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:8080/estado');
      expect(fetchMock.mock.calls[0]?.[1]?.headers).not.toHaveProperty('x-api-key');
    } finally { config.worldApiBaseUrl = previous; }
    expect(readConfig({ VITE_WORLD_API_BASE_URL: 'https://user:private@example.com' }).error).toBeDefined();
  });

  it('representa geometría, zonas, reservas y una ruta seleccionada con controles de mapa accesibles', async () => {
    const urbanGraph = structuredClone(graph), urbanWorld = structuredClone(world);
    urbanGraph.coverage = [{ lat: -.0002, lng: -.0002 }, { lat: -.0002, lng: .002 }, { lat: .002, lng: .002 }, { lat: -.0002, lng: -.0002 }];
    urbanGraph.spawn_zones = [{ id: 'synthetic-zone', name: 'Zona sintética', source: 'Synthetic test only', geometry: urbanGraph.coverage, node_ids: ['N-0000'], weight: 1 }];
    const road = urbanGraph.edges.find(edge => edge.from === 'N-0000' && edge.to === 'N-0001')!;
    road.geometry = [{ lat: 0, lng: 0 }, { lat: .0002, lng: .0005 }, { lat: 0, lng: .001 }];
    urbanWorld.survivors[0] = { ...urbanWorld.survivors[0]!, target_shelter_id: 'R-2', planned_route: ['N-0000', 'N-0001'], spawn_zone_id: 'synthetic-zone' };
    urbanWorld.shelters[1] = { ...urbanWorld.shelters[1]!, reserved: 1, available: urbanWorld.shelters[1]!.capacity - urbanWorld.shelters[1]!.occupancy - 1 };
    const requests = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => new Response(JSON.stringify(new URL(String(input)).pathname === '/estado' ? urbanWorld : urbanGraph)));
    renderEscape();
    const map = await screen.findByRole('img', { name: /Red de evacuación/ });
    const initial = map.getAttribute('viewBox');
    await userEvent.click(screen.getByRole('button', { name: 'Acercar mapa' }));
    expect(map.getAttribute('viewBox')).not.toBe(initial);
    fireEvent.keyDown(map, { key: 'ArrowRight' });
    await userEvent.click(screen.getByRole('button', { name: 'Restablecer mapa' }));
    expect(map.getAttribute('viewBox')).toBe(initial);
    await userEvent.click(screen.getByRole('button', { name: 'Ver ruta de S-0001' }));
    expect(screen.getByText('Refugio asignado: R-2')).toBeInTheDocument();
    expect(screen.getByText('Siguiente movimiento: N-0001')).toBeInTheDocument();
    expect(screen.getByText('Zona de origen: Zona sintética')).toBeInTheDocument();
    expect(screen.getByText(/1 reservadas/)).toBeInTheDocument();
    expect(map.querySelectorAll('.escape-spawn-zone')).toHaveLength(1);
    expect(map.querySelector('.escape-planned-route')?.getAttribute('points')?.split(' ')).toHaveLength(3);
    expect(requests.mock.calls.some(([url]) => new URL(String(url)).pathname === '/health')).toBe(false);
    expect(routeGeometry(urbanGraph, { ...urbanWorld.survivors[0]!, current_node: 'N-0001', planned_route: ['N-0001', 'N-0000'] })).toEqual([...road.geometry].reverse());
  });

  it('recupera la observación al reintentar después de una desconexión', async () => {
    let stateRequests = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      if (new URL(String(input)).pathname === '/estado' && stateRequests++ === 0) return new Response(JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Snapshot temporalmente desconectado.', requestId: 'retry-world', details: [] } }), { status: 503 });
      return new Response(JSON.stringify(new URL(String(input)).pathname === '/estado' ? world : graph));
    });
    renderEscape();
    expect(await screen.findByRole('alert')).toHaveTextContent('Snapshot temporalmente desconectado.');
    await userEvent.click(screen.getByRole('button', { name: /Intentar de nuevo/ }));
    expect(await screen.findByRole('img', { name: /Red de evacuación/ })).toBeInTheDocument();
    expect(stateRequests).toBeGreaterThanOrEqual(2);
  });

  it('rechaza geometrías y reservas que producirían una visualización incoherente', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ...graph, edges: [{ ...graph.edges[0], geometry: [{ lat: 'invalid', lng: 0 }] }] })));
    await expect(api.graph()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ...world, shelters: [{ ...world.shelters[0], reserved: 999, available: 0 }] })));
    await expect(api.world()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
