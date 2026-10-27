import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    expect(screen.getByRole('link', { name: 'Escape de Manta' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('navigation').querySelectorAll('a')).toHaveLength(1);
    expect(requests.mock.calls.every(([url]) => ['/grafo', '/v1/simulations/capabilities'].includes(new URL(String(url)).pathname))).toBe(true);
    expect(screen.getAllByText('API evacuación conectada').length).toBeGreaterThan(0);
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
    expect(screen.getAllByText('API evacuación sin conexión').length).toBeGreaterThan(0);
  });
});
