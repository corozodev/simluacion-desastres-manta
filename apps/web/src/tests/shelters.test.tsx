import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Escape } from '../features/Escape';
import { snapShelter, useShelterDraft } from '../features/ShelterEditor';
import { mapProjection } from '../features/visualization/projection';
import { api } from '../services/api';
import { capabilities, created, graph, managedState } from './simulation-fixtures';

const extended = structuredClone(graph);
extended.nodes.push({ id: 'NEW-NODE', lat: .0012, lng: .0012 });
extended.edges.push({ id: 'NEW-ROAD', from: 'N-0003', to: 'NEW-NODE', distance_m: 30, speed_mps: 1.4, road_type: 'residential', directed: false, blocked: false });
const clients: QueryClient[] = [];
afterEach(() => { clients.splice(0).forEach(client => client.clear()); vi.restoreAllMocks(); });
function setup() {
  vi.spyOn(api, 'simulationCapabilities').mockResolvedValue(capabilities);
  vi.spyOn(api, 'graph').mockResolvedValue(extended);
  vi.spyOn(api, 'simulationState').mockResolvedValue(managedState());
  const start = vi.spyOn(api, 'createSimulation').mockResolvedValue(created());
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); clients.push(client);
  render(<QueryClientProvider client={client}><Escape /></QueryClientProvider>);
  return start;
}

describe('refugios seleccionados sobre el grafo real', () => {
  it('rechaza distancia, duplicados y acceso dirigido; ignora aristas bloqueadas', () => {
    expect(snapShelter(extended, { lat: 1, lng: 1 }, []).error).toMatch(/500 m/);
    expect(snapShelter(extended, extended.nodes[0]!, [extended.nodes[0]!.id]).error).toMatch(/otro refugio/);
    const directed = structuredClone(extended);
    directed.edges = directed.edges.map(edge => ({ ...edge, directed: true }));
    // NEW-NODE is a one-way sink; it cannot reach the selected first node.
    expect(snapShelter(directed, directed.nodes[0]!, []).error).toMatch(/accesible/);
    const disconnected = structuredClone(extended);
    disconnected.edges.at(-1)!.blocked = true;
    expect(snapShelter(disconnected, extended.nodes.at(-1)!, []).node?.id).not.toBe('NEW-NODE');
  });

  it('previsualiza y cancela con Escape; confirmar envía el nodo real en el request', async () => {
    const start = setup();
    const map = await screen.findByRole('img', { name: /Red de evacuación/ });
    await userEvent.click(screen.getByRole('button', { name: 'Refugios y agentes' }));
    await userEvent.click(screen.getByText(/Refugios ·/));
    const edit = screen.getByRole('button', { name: 'Editar ubicación de R-1' });
    await userEvent.click(edit);
    const location = mapProjection(extended).point(extended.nodes.at(-1)!);
    fireEvent.click(map, { clientX: location.x, clientY: location.y });
    expect(screen.getByRole('button', { name: 'Confirmar ubicación' })).toBeEnabled();
    expect(map.querySelector('[data-layer="shelter-preview"]')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Confirmar ubicación' })).not.toBeInTheDocument();
    expect(map.querySelector('[data-layer="shelter-preview"]')).not.toBeInTheDocument();
    expect(start).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Refugios y agentes' }));
    await userEvent.click(screen.getByText(/Refugios ·/));
    await userEvent.click(screen.getByRole('button', { name: 'Editar ubicación de R-1' }));
    fireEvent.click(map, { clientX: location.x, clientY: location.y });
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar ubicación' }));
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar simulación' }));
    await waitFor(() => expect(start).toHaveBeenCalledWith(expect.objectContaining({ scenario: 'zombie_outbreak', tick_interval_ms: 2000, config: expect.objectContaining({ custom_shelters: expect.arrayContaining([{ id: 'R-1', node_id: 'NEW-NODE', capacity: 50 }]) }) }), expect.any(String)));
  });

  it('invalida la propuesta cuando cambia la versión geográfica y mantiene plazas coherentes', () => {
    const { result, rerender } = renderHook(({ network }) => useShelterDraft(network), { initialProps: { network: extended } });
    act(() => result.current.capacity('R-1', 12));
    expect(result.current.shelters[0]).toMatchObject({ capacity: 12, occupancy: 0, reserved: 0, available: 12 });
    act(() => result.current.pick('R-1'));
    act(() => result.current.select(extended.nodes.at(-1)!));
    expect(result.current.proposal?.node).toBeDefined();
    rerender({ network: { ...extended, version: 'replacement-topology' } });
    expect(result.current.custom).toBeUndefined();
    expect(result.current.picking).toBeUndefined();
    expect(result.current.proposal).toBeUndefined();
    expect(result.current.shelters[0]?.capacity).toBe(50);
  });

  it('valida capacidad y restaura originales sin crear trabajo', async () => {
    const start = setup();
    await screen.findByRole('img', { name: /Red de evacuación/ });
    await userEvent.click(screen.getByRole('button', { name: 'Refugios y agentes' }));
    await userEvent.click(screen.getByText(/Refugios ·/));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Capacidad de R-1' }), { target: { value: '0' } });
    expect(screen.getByRole('button', { name: 'Iniciar simulación' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Restaurar refugios originales' }));
    expect(screen.getByRole('button', { name: 'Iniciar simulación' })).toBeEnabled();
    expect(screen.getByRole('spinbutton', { name: 'Capacidad de R-1' })).toHaveValue(50);
    expect(start).not.toHaveBeenCalled();
  });
});
