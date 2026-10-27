import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Graph, Incident, IncidentApplication, IncidentApplyResult, LabState } from '@corodev/contracts';
import { IncidentPanel, type IncidentPanelProps } from '../features/flood/IncidentPanel';
import { FloodMap } from '../features/flood/FloodMap';
import { api, ApiError } from '../services/api';
import { config } from '../lib/config';

const now = new Date().toISOString();
const incident: Incident = {
  schema_version: 1, incident_id: 'incident-citizen-1', incident_type: 'road_closed', latitude: -1, longitude: -80,
  description: 'Calle cerrada observada. <img src=x onerror=alert(1)>', severity_reported: 'moderate', road_passability_reported: 'blocked',
  event_time: now, received_at: now, source_type: 'citizen', verification_status: 'pending',
  evidence_metadata: { attachment_count: 0, storage_status: 'not_supported' }, affected_edge_ids: ['E1'], graph_version: 'test-graph', snap_distance_m: 2,
  location_method: 'manual', location_precision_m: 20, expires_at: new Date(Date.now() + 86400000).toISOString(), updated_at: now,
};
const graph: Graph = {
  version: 'test-graph', source: 'Synthetic test graph', nodes: [{ id: 'A', lat: -1, lng: -80 }, { id: 'B', lat: -.999, lng: -79.999 }],
  edges: [{ id: 'E1', from: 'A', to: 'B', distance_m: 150, speed_mps: 1.4, road_type: 'residential', blocked: false, directed: false }], shelters: [],
};
const metrics = { total_agents: 1, evacuated_agents: 0, isolated_agents: 0, waiting_agents: 0, average_evacuation_time: 0, blocked_edges: 0, caution_edges: 0, shelters_at_capacity: 0, reroute_count: 0, simulation_total_duration: 1 };
const backend: LabState = {
  run_id: 'test-run', state: 'paused', mode: 'competition', graph_version: graph.version,
  config: { mode: 'competition', seed: 42, rainfall_profile: 'constant', rainfall_intensity: 0, simulation_duration: 80, evacuation_behavior: 'preventive', agents: 1, interval_ms: 500, shelters: [] },
  scenario: { scenario_type: 'urban_flood', simulation_step: 1, world_version: 3, graph_version: graph.version, simulation_time: 1, simulation_duration: 80, time_step: 1, rainfall: 0, flood_zones: [], road_conditions: [], shelter_conditions: [], agents: [{ id: 'S1', current_node: 'A', state: 'moving', behavior: 'preventive', target_shelter_id: 'R1', planned_route: ['A', 'B'] }], evacuation_metrics: metrics, performance: { simulation_step_latency_ms: 1, simulation_total_duration_ms: 1 }, data_provenance: { graph_source: graph.source, model: 'test', elevation_source: 'unavailable', disclaimer: 'Synthetic test' } },
  shelters: [], timeline: [], origins: [], incident_applications: [],
};
const application: IncidentApplication = {
  application_id: 'application-1', incident_id: incident.incident_id, run_id: backend.run_id, affected_edge_ids: ['E1'], simulation_step: 1,
  world_version: 4, source_type: 'citizen', verification_status_at_application: 'pending', effect: 'blocked', expires_at_simulation_step: 21, applied_at: now,
};
const result: IncidentApplyResult = { incident, application, already_applied: false, state: { ...backend, incident_applications: [application], scenario: { ...backend.scenario, world_version: 4 } } };
const initialTiles = config.osmTilesEnabled;
afterEach(() => { vi.restoreAllMocks(); config.osmTilesEnabled = initialTiles; });
function setup(overrides: Partial<IncidentPanelProps> = {}) {
  const applied = vi.fn();
  const filters = vi.fn();
  const select = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  function Harness() {
    const [state, setState] = useState(backend);
    return <IncidentPanel list={{ incidents: [incident], total: 1, limit: 200, offset: 0, has_more: false }} loading={false} error={null} onRetry={vi.fn()} filters={{ type: '', status: '', age: '24' }} onFilters={filters} selectedId={incident.incident_id} onSelect={select} selected={incident} backend={state} preview={false} csrf="memory-only-csrf" busy={false} onApplied={value => { setState(value.state); applied(value); }} {...overrides} />;
  }
  render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>);
  return { applied, filters, select, client };
}

describe('reportes ciudadanos en el laboratorio React', () => {
  it('muestra procedencia, fechas y cuantización sin interpretar un pendiente como oficial ni ejecutar HTML', () => {
    setup();
    const detail = screen.getByRole('region', { name: `Detalle de incidente ${incident.incident_id}` });
    expect(detail).toHaveTextContent('Reporte ciudadano pendiente de verificación');
    expect(detail).toHaveTextContent('Momento declarado');
    expect(detail).toHaveTextContent('Recibido por el servidor');
    expect(detail).toHaveTextContent('cuantización de 20 m; no mide la exactitud del dispositivo');
    expect(detail).toHaveTextContent('<img src=x onerror=alert(1)>');
    expect(detail.querySelector('img')).toBeNull();
    expect(detail).not.toHaveTextContent('Fuente oficial');
    expect(screen.queryByRole('button', { name: 'Aplicar incidente a simulación' })).toBeNull();
  });

  it('exige revisar y aceptar el uso experimental, aplica al run actual y conserva pending con auditoría', async () => {
    const request = vi.spyOn(api, 'applyFloodIncident').mockResolvedValue(result);
    const { applied } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Revisar aplicación experimental' }));
    const confirm = screen.getByRole('button', { name: 'Aplicar incidente a simulación' });
    expect(confirm).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: /Entiendo que esta evaluación es experimental/ }));
    await userEvent.click(confirm);
    expect(request).toHaveBeenCalledExactlyOnceWith(incident.incident_id, backend.run_id, 'memory-only-csrf', 20, 'blocked');
    expect(applied).toHaveBeenCalledWith(result);
    await screen.findByText(/El reporte continúa pendiente de verificación/);
    expect(screen.getByLabelText('Registro de aplicación experimental')).toHaveTextContent('1 / 4');
    expect(screen.getByLabelText('Registro de aplicación experimental')).toHaveTextContent('Reporte ciudadano · Pendiente de verificación');
    expect(screen.getByText('Reporte ciudadano pendiente de verificación')).toBeInTheDocument();
  });

  it('mantiene el error HTTP y request ID y permite reintentar la aplicación sin perder la selección', async () => {
    const request = vi.spyOn(api, 'applyFloodIncident').mockRejectedValueOnce(new ApiError('La ejecución cambió.', 'CONFLICT', 409, 'request-incident-1')).mockResolvedValueOnce({ ...result, already_applied: true });
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Revisar aplicación experimental' }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Entiendo que esta evaluación es experimental/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar incidente a simulación' }));
    await screen.findByText('La ejecución cambió.');
    expect(screen.getByText('Request ID: request-incident-1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar incidente a simulación' }));
    await screen.findByText(/El incidente ya estaba aplicado; no se duplicó el overlay/);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['sin sesión autorizada', { csrf: '' }], ['previsualización de otra cobertura', { preview: true }],
    ['ronda finalizada', { backend: { ...backend, state: 'finished' as const } }],
    ['reporte rechazado', { selected: { ...incident, verification_status: 'rejected' as const } }],
    ['caducidad por fecha', { selected: { ...incident, expires_at: '2020-01-01T00:00:00Z' } }],
    ['sin asociación', { selected: { ...incident, affected_edge_ids: [] } }],
  ])('impide inyección cuando corresponde: %s', (_label, overrides) => {
    setup(overrides);
    expect(screen.getByRole('button', { name: 'Revisar aplicación experimental' })).toBeDisabled();
  });

  it('permite evaluar otra novedad asociada con un efecto explícito del operador', async () => {
    setup({ selected: { ...incident, incident_type: 'other' } });
    await userEvent.click(screen.getByRole('button', { name: 'Revisar aplicación experimental' }));
    expect(screen.getByRole('combobox', { name: 'Efecto experimental' })).toHaveValue('blocked');
    expect(screen.getByRole('button', { name: 'Aplicar incidente a simulación' })).toBeDisabled();
  });

  it('filtra tipo/estado/antigüedad y reserva los estados descartados para el panel autorizado', async () => {
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

  it('guarda una revisión explícita con control de concurrencia y conserva la fuente ciudadana', async () => {
    const request = vi.spyOn(api, 'reviewIncident').mockResolvedValue({ ...incident, verification_status: 'corroborated' });
    setup();
    await userEvent.click(screen.getByText('Revisión autorizada del reporte'));
    await userEvent.selectOptions(screen.getByLabelText('Nuevo estado de verificación'), 'corroborated');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar revisión autorizada' }));
    expect(request).toHaveBeenCalledExactlyOnceWith(incident.incident_id, { verification_status: 'corroborated', expected_updated_at: incident.updated_at }, 'memory-only-csrf');
    await screen.findByText('Revisión guardada. La procedencia del reporte se conserva.');
    expect(screen.queryByText('Fuente oficial')).toBeNull();
  });

  it('maneja carga, lista vacía y error de detalle de forma accesible', () => {
    setup({ list: { incidents: [], total: 0, limit: 200, offset: 0, has_more: false }, selected: undefined, detailError: new Error('No se pudo consultar el reporte.') });
    expect(screen.getByRole('status')).toHaveTextContent('No hay novedades');
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo consultar el reporte.');
  });

  it('renderiza estado y fuente en capa independiente con selección de teclado sin confundir datos sintéticos', async () => {
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
    await userEvent.click(screen.getByRole('checkbox', { name: 'Novedades georreferenciadas' }));
    expect(map.querySelector('[data-layer="incidents"]')).toBeNull();
    expect(map.querySelector('[data-road-state="passable"]')).toBeInTheDocument();
  });
});
