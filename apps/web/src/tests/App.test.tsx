import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { AppShell } from '../components/AppShell';
import { ApiError } from '../services/api';
import { AppRoutes } from '../app/App';
import { capabilities, graph } from './simulation-fixtures';
function renderApp(route = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[route]}><AppRoutes /></MemoryRouter></QueryClientProvider>);
}
afterEach(() => vi.restoreAllMocks());
describe('aplicación de evacuación', () => {
  it('abre Escape como entrada principal y sólo consulta Go', async () => {
    const requests = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => new Response(JSON.stringify(new URL(String(input)).pathname === '/grafo' ? graph : capabilities)));
    renderApp();
    expect(await screen.findByRole('img', { name: /Red de evacuación/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Escape Manta Zombie' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('navigation').querySelectorAll('a')).toHaveLength(2);
    expect(requests.mock.calls.every(([url]) => ['/grafo', '/v1/simulations/capabilities'].includes(new URL(String(url)).pathname))).toBe(true);
    expect(screen.getAllByText('API evacuación conectada')).toHaveLength(1);
  });
  it('redirige enlaces anteriores a Escape sin pedir otros recursos', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => new Response(JSON.stringify(new URL(String(input)).pathname === '/grafo' ? graph : capabilities)));
    renderApp('/ruta-anterior');
    expect(await screen.findByRole('img', { name: /Red de evacuación/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Escape de Manta Zombie' })).toBeInTheDocument();
  });
  it('expone los errores reales de evacuación y conserva su referencia', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => new URL(String(input)).pathname === '/grafo' ? new Response(JSON.stringify(graph)) : new Response(JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Servicio temporalmente desconectado.', requestId: 'req-go', details: [] } }), { status: 503 }));
    renderApp();
    expect(await screen.findByRole('alert')).toHaveTextContent('Servicio temporalmente desconectado.');
    expect(screen.getByText('Request ID: req-go')).toBeInTheDocument();
    expect(screen.getAllByText('API evacuación sin conexión')).toHaveLength(1);
  });
});


describe('shell MantaSim', () => {
  function shell(route = '/escape') {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    client.setQueryData(['simulation-capabilities'], capabilities);
    const view = render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[route]}><Routes><Route element={<AppShell />}><Route path="escape" element={<p>Panel zombi</p>} /><Route path="flood-lab" element={<p>Panel inundación</p>} /></Route></Routes></MemoryRouter></QueryClientProvider>);
    return { client, ...view };
  }
  it('colapsa sin perder enlaces accesibles y expande de nuevo', async () => {
    const view = shell();
    expect(screen.getByRole('link', { name: 'MantaSim, inicio' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Colapsar barra lateral' }));
    expect(view.container.querySelector('.app-shell')).toHaveClass('sidebar-collapsed');
    expect(screen.getByRole('link', { name: 'Escape Manta Inundación' })).toHaveAttribute('title', 'Escape Manta Inundación');
    await userEvent.click(screen.getByRole('button', { name: 'Expandir barra lateral' }));
    expect(view.container.querySelector('.app-shell')).not.toHaveClass('sidebar-collapsed');
  });
  it('navega directamente al laboratorio sin selector de escenarios ni consultas extra', async () => {
    const requests = vi.spyOn(globalThis, 'fetch');
    shell('/flood-lab');
    expect(screen.getByRole('link', { name: 'Escape Manta Inundación' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Escape Manta Zombie' })).not.toHaveAttribute('aria-current');
    expect(screen.queryByRole('combobox', { name: 'Escenarios' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Escape Manta Zombie' }));
    expect(screen.getByText('Panel zombi')).toBeInTheDocument();
    expect(requests).not.toHaveBeenCalled();
    expect(screen.queryByText('Estado observable.')).not.toBeInTheDocument();
  });
  it('cierra el drawer con Escape y devuelve el foco al disparador', async () => {
    shell();
    const toggle = screen.getByRole('button', { name: 'Abrir menú' });
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.body.style.overflow).toBe('hidden');
    await userEvent.keyboard('{Escape}');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveFocus();
    expect(document.body.style.overflow).toBe('');
  });
  it('refleja un fallo de polling como degradación sin duplicar el indicador', async () => {
    const { client } = shell();
    client.setQueryData(['simulation-session', 's1', 'state'], { tick: 2 });
    await client.fetchQuery({ queryKey: ['simulation-session', 's1', 'state'], queryFn: () => Promise.reject(new ApiError('Sin conexión', 'BACKEND_UNAVAILABLE')), retry: false }).catch(() => undefined);
    await waitFor(() => expect(screen.getAllByText('API evacuación degradada')).toHaveLength(1));
    expect(screen.getByRole('button', { name: 'Reintentar conexión de API' })).toBeInTheDocument();
  });
});
