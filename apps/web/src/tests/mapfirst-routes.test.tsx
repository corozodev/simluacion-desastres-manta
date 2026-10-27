import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { Escape } from '../features/Escape';
import { api } from '../services/api';
import { capabilities, created, graph, managedState, restoreSession, world } from './simulation-fixtures';

const clients: QueryClient[] = [];
afterEach(() => { clients.splice(0).forEach(client => client.clear()); vi.restoreAllMocks(); });
function setup(restore = true) {
  const snapshot = structuredClone(world);
  snapshot.zombies = []; snapshot.blocked_edges = [];
  snapshot.survivors = [
    { id: 'S-0001', current_node: 'N-0000', status: 'active', target_shelter_id: 'R-2', planned_route: ['N-0000', 'N-0001'] },
    { id: 'S-0002', current_node: 'N-0002', status: 'active', target_shelter_id: 'R-4', planned_route: ['N-0002', 'N-0003'] },
  ];
  if (restore) restoreSession();
  vi.spyOn(api, 'graph').mockResolvedValue(graph);
  vi.spyOn(api, 'simulationCapabilities').mockResolvedValue(capabilities);
  vi.spyOn(api, 'simulationState').mockResolvedValue(managedState(snapshot));
  const create = vi.spyOn(api, 'createSimulation').mockResolvedValue(created(managedState(snapshot)));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); clients.push(client);
  render(<QueryClientProvider client={client}><Escape /></QueryClientProvider>);
  return { create, snapshot };
}

it('busca, cambia y oculta la ruta real sin columnas ni bloques técnicos', async () => {
  const { snapshot } = setup();
  const map = await screen.findByRole('img', { name: /Red de evacuación/ });
  await screen.findByLabelText('Tu simulación');
  await userEvent.click(screen.getByRole('button', { name: 'Refugios y agentes' }));
  await userEvent.click(screen.getByRole('tab', { name: /^Supervivientes/ }));
  const panel = screen.getByRole('tabpanel', { name: /^Supervivientes/ });
  expect(within(panel).getAllByRole('columnheader').map(item => item.textContent)).toEqual(['Superviviente', 'Estado', 'Refugio', 'Acción']);
  const search = within(panel).getByRole('searchbox', { name: 'Buscar por ID' });
  await userEvent.type(search, 'S-0001');
  expect(within(panel).queryByRole('rowheader', { name: 'S-0002' })).not.toBeInTheDocument();
  await userEvent.click(within(panel).getByRole('button', { name: 'Ver ruta de S-0001' }));
  expect(within(panel).getByRole('rowheader', { name: 'S-0001' }).closest('tr')).toHaveAttribute('aria-selected', 'true');
  expect(within(panel).getByText('S-0001 · Ruta resaltada en el mapa')).toBeInTheDocument();
  const first = map.querySelector('.escape-planned-route')!.getAttribute('points');
  await userEvent.click(within(panel).getByRole('button', { name: 'Ocultar ruta' }));
  expect(search).toHaveValue('S-0001');
  expect(map.querySelector('.escape-planned-route')).toBeNull();
  await userEvent.clear(search);
  await userEvent.click(within(panel).getByRole('button', { name: 'Ver ruta de S-0002' }));
  expect(map.querySelector('.escape-planned-route')!.getAttribute('points')).not.toBe(first);
  expect(within(panel).getByRole('rowheader', { name: 'S-0002' }).closest('tr')).toHaveAttribute('aria-selected', 'true');
  expect(panel).not.toHaveTextContent(/N-000[0-3]|Posición:|Siguiente movimiento:|Zona de origen:|Ruta publicada:/);
  expect(snapshot.survivors[0]!.planned_route).toEqual(['N-0000', 'N-0001']);
});

it('utiliza el mismo renderer y cámara al pasar de exploración a ejecución', async () => {
  const { create } = setup(false);
  const map = await screen.findByRole('img', { name: /Red de evacuación/ });
  fireEvent.keyDown(map, { key: '+' });
  fireEvent.keyDown(map, { key: 'ArrowRight' });
  const camera = map.getAttribute('viewBox');
  await userEvent.click(screen.getByRole('button', { name: 'Iniciar simulación' }));
  await screen.findByLabelText('Tu simulación');
  expect(screen.getByRole('img', { name: /Red de evacuación/ })).toBe(map);
  expect(map).toHaveAttribute('viewBox', camera!);
  expect(document.querySelectorAll('.map-stage > svg')).toHaveLength(1);
  await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ tick_interval_ms: 2000 }), expect.any(String)));
  expect(screen.queryByRole('heading', { name: 'Tu simulación' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('Tu simulación')).not.toHaveTextContent(/private-simulation-id|manta-v|versión/);
});
