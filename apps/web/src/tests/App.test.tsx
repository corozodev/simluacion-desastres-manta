import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../app/App';

const item = { id: 'item-001', title: 'Registro de prueba', description: 'Descripción del registro', status: 'active', createdAt: '2026-10-27T12:00:00Z' };
const health = { status: 'ok', service: 'corodev-mock-api', version: '0.1.0' };
const page = (data: unknown[] = [item]) => ({ data, pagination: { page: 1, pageSize: 6, total: data.length } });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

function renderApp(route = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[route]}><AppRoutes /></MemoryRouter></QueryClientProvider>);
}

function mockApi(items: unknown = page()) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async input => String(input).endsWith('/health') ? json(health) : json(items));
}

afterEach(() => { vi.restoreAllMocks(); });

describe('cliente web', () => {
  it('renderiza AppShell, navegación y datos obtenidos de HTTP', async () => {
    mockApi();
    renderApp();
    expect(screen.getByRole('navigation')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Hola, CoroDev/ })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /Registro de prueba/ })).toHaveAttribute('href', '/items/item-001');
    expect(screen.getByRole('link', { name: 'Resumen' })).toHaveAttribute('aria-current', 'page');
  });

  it('muestra un estado de carga mientras se espera HTTP', () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>(() => {}));
    renderApp('/items');
    expect(screen.getByRole('status')).toHaveTextContent('Cargando elementos');
  });

  it('muestra estado vacío y mantiene búsqueda accesible', async () => {
    mockApi(page([]));
    renderApp('/items');
    expect(await screen.findByRole('heading', { name: 'Todavía no hay elementos' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Buscar elementos' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Página siguiente' })).toBeDisabled();
  });

  it('busca con debounce y reinicia la página al cambiar la búsqueda', async () => {
    const fetchMock = mockApi();
    renderApp('/items?page=2');
    await screen.findByRole('link', { name: /Registro de prueba/ });
    await userEvent.type(screen.getByRole('searchbox'), 'nube');
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('page=1&pageSize=6&q=nube'))).toBe(true));
  });

  it('valida campos antes de enviar el formulario', async () => {
    const fetchMock = mockApi();
    renderApp('/demo');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar demo' }));
    expect(screen.getByText('Escribe un título para continuar.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Título' })).toHaveFocus();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('bloquea envíos duplicados y muestra la confirmación real', async () => {
    let complete: ((response: Response) => void) | undefined;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (init?.method === 'POST') return new Promise<Response>(resolve => { complete = resolve; });
      return json(String(input).endsWith('/health') ? health : page());
    });
    renderApp('/demo');
    await userEvent.type(screen.getByRole('textbox', { name: 'Título' }), 'Mi idea');
    const submit = screen.getByRole('button', { name: 'Enviar demo' });
    const form = submit.closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByRole('button', { name: /Enviando/ })).toBeDisabled());
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    complete?.(json({ submissionId: 'submission-test-1', status: 'accepted', message: 'Envío recibido.' }, 202));
    expect(await screen.findByRole('heading', { name: 'Tu idea dio el primer paso.' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('submission-test-1');
    await userEvent.click(screen.getByRole('button', { name: 'Crear otro envío' }));
    expect(screen.getByRole('textbox', { name: 'Título' })).toHaveValue('');
  });

  it('muestra errores HTTP y conserva el request ID', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => String(input).endsWith('/health') ? json(health) : json({ error: { code: 'INTERNAL_ERROR', message: 'Error controlado del servidor.', requestId: 'req-error-test', details: [] } }, 500));
    renderApp('/items');
    expect(await screen.findByRole('alert')).toHaveTextContent('Error controlado del servidor.');
    expect(screen.getByText('Request ID: req-error-test')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Intentar de nuevo/ })).toBeInTheDocument();
  });

  it('muestra detalle inexistente sin ofrecer un reintento inútil', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => String(input).endsWith('/health') ? json(health) : json({ error: { code: 'NOT_FOUND', message: 'Elemento no encontrado.', requestId: 'req-not-found', details: [] } }, 404));
    renderApp('/items/not-found');
    expect(await screen.findByRole('heading', { name: 'Este elemento no existe' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver a elementos' })).toHaveAttribute('href', '/items');
    expect(screen.queryByRole('button', { name: /Intentar de nuevo/ })).not.toBeInTheDocument();
  });
});
