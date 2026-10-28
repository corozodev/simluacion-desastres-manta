import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Graph, Incident, IncidentList } from '@corodev/contracts';
import { IncidentPanel, type IncidentPanelProps } from '../features/flood/IncidentPanel';
import { FloodMap } from '../features/flood/FloodMap';
import { api, ApiError } from '../services/api';
import { config } from '../lib/config';

const now = new Date().toISOString();
const baseIncident: Incident = {
  schema_version: 1, incident_id: 'incident-citizen-1', incident_type: 'road_closed', latitude: -1, longitude: -80,
  description: 'Calle cerrada observada. <img src=x onerror=alert(1)>', severity_reported: 'moderate', road_passability_reported: 'blocked',
  event_time: now, received_at: now, source_type: 'citizen', verification_status: 'pending',
  evidence_metadata: { attachment_count: 0, storage_status: 'not_supported' }, affected_edge_ids: ['E1'], graph_version: 'test-graph', snap_distance_m: 2,
  location_method: 'manual', location_precision_m: 20, expires_at: new Date(Date.now() + 86400000).toISOString(), updated_at: now,
};
let incident = baseIncident;
let reportSequence = 0;
beforeEach(() => { incident = { ...baseIncident, incident_id: `citizen-${++reportSequence}` }; });
const graph: Graph = {
  version: 'test-graph', source: 'Synthetic test graph', nodes: [{ id: 'A', lat: -1, lng: -80 }, { id: 'B', lat: -.999, lng: -79.999 }],
  edges: [{ id: 'E1', from: 'A', to: 'B', distance_m: 150, speed_mps: 1.4, road_type: 'residential', blocked: false, directed: false }], shelters: [],
};
const permissions = { can_review: true, can_withdraw: true, can_mark_official: true, operator_login_available: true };
const initialTiles = config.osmTilesEnabled;
afterEach(() => { vi.restoreAllMocks(); config.osmTilesEnabled = initialTiles; });
function setup(overrides: Partial<IncidentPanelProps> = {}) {
  const filters = vi.fn(), select = vi.fn(), locate = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const list: IncidentList = { incidents: [incident], total: 1, limit: 200, offset: 0, has_more: false };
  client.setQueryData(['incidents', 'list', {}], list);
  client.setQueryData(['mobile', 'incidents'], list);
  render(<QueryClientProvider client={client}><IncidentPanel list={list} loading={false} error={null} onRetry={vi.fn()} filters={{ type: '', status: '', age: '24' }} onFilters={filters} selectedId={incident.incident_id} onSelect={select} onLocate={locate} selected={incident} csrf="memory-only-csrf" permissions={permissions} {...overrides} /></QueryClientProvider>);
  return { filters, select, locate, client };
}

describe('consulta y moderación de reportes ciudadanos', () => {
  it('conserva la fuente, estado pendiente, fecha y texto sin ejecutar HTML ni ofrecer aplicación al motor', () => {
    setup();
    const detail = screen.getByRole('region', { name: 'Detalle del reporte seleccionado' });
    expect(detail).toHaveTextContent('Reporte ciudadano');
    expect(detail).toHaveTextContent('Pendiente de verificación');
    expect(detail.querySelector('time')).toHaveAttribute('datetime', now);
    expect(detail).toHaveTextContent('<img src=x onerror=alert(1)>');
    expect(detail.querySelector('img')).toBeNull();
    expect(detail).not.toHaveTextContent('Fuente oficial');
    expect(screen.queryByRole('button', { name: /Aplicar incidente|Revisar aplicación experimental/ })).not.toBeInTheDocument();
  });

  it('verifica con permiso y versión esperada, actualiza ambas cachés y conserva procedencia ciudadana', async () => {
    const verified = { ...incident, verification_status: 'verified' as const };
    const request = vi.spyOn(api, 'reviewIncident').mockResolvedValue(verified);
    const { client } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Verificar' }));
    await screen.findByText('Revisión guardada. El mapa se actualizó con la respuesta del servidor.');
    expect(request).toHaveBeenCalledExactlyOnceWith(incident.incident_id, { verification_status: 'verified', expected_updated_at: incident.updated_at }, 'memory-only-csrf');
    expect(client.getQueryData(['incidents', 'detail', incident.incident_id])).toEqual(verified);
    for (const key of [['incidents', 'list', {}], ['mobile', 'incidents']]) {
      expect(client.getQueryData<IncidentList>(key)?.incidents[0]).toMatchObject({ verification_status: 'verified', source_type: 'citizen' });
    }
  });

  it('mantiene error HTTP y request ID y permite reintentar una revisión sin cambiar de reporte', async () => {
    const request = vi.spyOn(api, 'reviewIncident').mockRejectedValueOnce(new ApiError('La revisión cambió.', 'CONFLICT', 409, 'request-incident-1')).mockResolvedValueOnce({ ...incident, verification_status: 'verified' });
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Verificar' }));
    await screen.findByText('La revisión cambió.');
    expect(screen.getByText('Request ID: request-incident-1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Verificar' }));
    await screen.findByText('Revisión guardada. El mapa se actualizó con la respuesta del servidor.');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['sin credencial', { csrf: '' }], ['sin permiso', { permissions: { ...permissions, can_review: false } }],
    ['caducado', { selected: { ...incident, expires_at: '2020-01-01T00:00:00Z' } }],
    ['retirado', { selected: { ...incident, map_withdrawn: true } }],
  ])('impide moderación cuando corresponde: %s', (_label, overrides) => {
    const request = vi.spyOn(api, 'reviewIncident');
    setup(overrides);
    expect(screen.queryByRole('button', { name: 'Verificar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Marcar como oficial' })).not.toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
  });

  it('exige un motivo antes de rechazar y retira el reporte de las consultas públicas', async () => {
    const request = vi.spyOn(api, 'reviewIncident').mockResolvedValue({ ...incident, verification_status: 'rejected' });
    const { client } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Rechazar' }));
    const confirm = screen.getByRole('button', { name: 'Confirmar revisión' });
    await userEvent.click(confirm);
    expect(request).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText('Motivo del rechazo'), 'Reporte duplicado');
    await userEvent.click(confirm);
    await waitFor(() => expect(request).toHaveBeenCalledExactlyOnceWith(incident.incident_id, { verification_status: 'rejected', expected_updated_at: now, note: 'Reporte duplicado' }, 'memory-only-csrf'));
    await screen.findByText(/Revisión guardada/);
    expect(client.getQueryData<IncidentList>(['mobile', 'incidents'])?.incidents).toEqual([]);
  });

  it('requiere fuente HTTPS y aceptación para acreditar respaldo oficial sin cambiar el origen ciudadano', async () => {
    const request = vi.spyOn(api, 'reviewIncident').mockResolvedValue({ ...incident, verification_status: 'verified' });
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Marcar como oficial' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar revisión' }));
    expect(request).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText('Publicación o entidad responsable'), 'Fuente revisada');
    await userEvent.type(screen.getByLabelText('Enlace a la fuente oficial'), 'https://example.org/fuente');
    await userEvent.click(screen.getByLabelText(/He revisado la publicación oficial/));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar revisión' }));
    await waitFor(() => expect(request).toHaveBeenCalledExactlyOnceWith(incident.incident_id, { verification_status: 'verified', expected_updated_at: now, official_source: { title: 'Fuente revisada', url: 'https://example.org/fuente' }, official_ack: true }, 'memory-only-csrf'));
    expect(screen.getByRole('region', { name: 'Detalle del reporte seleccionado' })).toHaveTextContent('Reporte ciudadano');
  });

  it('oculta estados descartados en consulta pública y filtra sin alterar el reporte', async () => {
    const { filters } = setup({ csrf: '' });
    expect(screen.queryByRole('option', { name: 'Rechazado' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Caducado' })).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText('Tipo de novedad'), 'fallen_tree');
    expect(filters).toHaveBeenLastCalledWith({ type: 'fallen_tree', status: '', age: '24' });
    await userEvent.selectOptions(screen.getByLabelText('Estado de verificación'), 'pending');
    expect(filters).toHaveBeenLastCalledWith({ type: '', status: 'pending', age: '24' });
    await userEvent.selectOptions(screen.getByLabelText('Antigüedad del reporte'), '1');
    expect(filters).toHaveBeenLastCalledWith({ type: '', status: '', age: '1' });
  });

  it('muestra lista vacía, carga y error de consulta de forma accesible', () => {
    const { unmount } = render(<QueryClientProvider client={new QueryClient()}><IncidentPanel loading error={null} onRetry={vi.fn()} filters={{ type: '', status: '', age: '24' }} onFilters={vi.fn()} selectedId="" onSelect={vi.fn()} csrf="" /></QueryClientProvider>);
    expect(screen.getByRole('status')).toHaveTextContent('Cargando reportes');
    unmount();
    setup({ list: { incidents: [], total: 0, limit: 200, offset: 0, has_more: false }, selected: undefined, error: new Error('No se pudo consultar el reporte.') });
    expect(screen.getByText('No hay reportes con estos filtros.')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo consultar el reporte.');
  });

  it('renderiza fuente y estado en capa independiente con selección de teclado y conserva la red vial', async () => {
    config.osmTilesEnabled = false;
    const select = vi.fn();
    const incidents: Incident[] = [incident, { ...incident, incident_id: 'synthetic-2', source_type: 'synthetic', verification_status: 'verified', latitude: -.9995, longitude: -79.9995 }];
    render(<FloodMap graph={graph} shelters={[]} candidates={[]} selectedAgentId="" onSelectAgent={vi.fn()} onPickPosition={vi.fn()} incidents={incidents} onSelectIncident={select} />);
    const map = screen.getByTestId('flood-map');
    expect(map.querySelectorAll('[data-incident-id]')).toHaveLength(2);
    const synthetic = map.querySelector('[data-incident-id="synthetic-2"]')!;
    expect(synthetic).toHaveAttribute('data-incident-source', 'synthetic');
    expect(within(synthetic as HTMLElement).getByText(/Dato sintético de prueba/)).toBeInTheDocument();
    fireEvent.keyDown(synthetic, { key: 'Enter' });
    expect(select).toHaveBeenCalledWith('synthetic-2');
    await userEvent.click(screen.getByText('Capas', { selector: 'summary' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Novedades georreferenciadas' }));
    expect(map.querySelector('[data-layer="incidents"]')).toBeNull();
    expect(map.querySelector('[data-road-state="passable"]')).toBeInTheDocument();
  });
});
