import type { ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GeoPoint, Graph, LabCandidateValidation, LabCatalog, LabRunConfig, LabState } from '@corodev/contracts';
import { FloodLab } from '../features/flood/FloodLab';
import { api, ApiError } from '../services/api';

vi.mock('../features/flood/FloodMap', () => ({ FloodMap: ({ onPickPosition, pickingCandidate, previewPosition, hud, panel, metrics }: { hud?: ReactNode; panel?: ReactNode; metrics?: ReactNode; onPickPosition: (point: GeoPoint) => void; pickingCandidate?: number; previewPosition?: GeoPoint }) => <div aria-label="Mapa del laboratorio">{hud}{panel}{metrics}<button disabled={pickingCandidate === undefined} onClick={() => onPickPosition({ lat: -1.000123, lng: -80.000123 })}>Señalar ubicación de prueba</button>{previewPosition && <p>Marcador provisional ajustado: {previewPosition.lat}, {previewPosition.lng}</p>}</div> }));
vi.mock('../features/flood/IncidentPanel', () => ({ IncidentPanel: () => null }));
vi.mock('../features/flood/ReferencePanel', () => ({ ReferencePanel: () => null }));
const graph = JSON.parse(readFileSync('../../packages/contracts/examples/graph.json', 'utf8')) as Graph;
const shelters = graph.shelters.map(shelter => { const node = graph.nodes.find(node => node.id === shelter.node_id)!; return { id: shelter.id, label: shelter.id, capacity: shelter.capacity, lat: node.lat, lng: node.lng }; });
const config: LabRunConfig = { mode: 'competition', seed: 42, rainfall_profile: 'storm', hydraulic_model: 'rainfall_runoff_2d', rainfall_intensity: .8, simulation_duration: 150, evacuation_behavior: 'preventive', agents: 1, interval_ms: 500, shelters };
const metrics = { total_agents: 1, evacuated_agents: 0, isolated_agents: 0, waiting_agents: 1, average_evacuation_time: 0, blocked_edges: 0, caution_edges: 0, shelters_at_capacity: 0, reroute_count: 0, simulation_total_duration: 0 };
const state: LabState = { run_id: 'initial-run', state: 'idle', mode: 'competition', graph_version: graph.version, config, shelters: graph.shelters, origins: [], timeline: [], scenario: { scenario_type: 'urban_flood', simulation_step: 0, world_version: 0, graph_version: graph.version, simulation_time: 0, simulation_duration: 150, time_step: 1, rainfall: 0, flood_zones: [], road_conditions: [], shelter_conditions: [], agents: [], evacuation_metrics: metrics, performance: { simulation_step_latency_ms: 0, simulation_total_duration_ms: 0 }, data_provenance: { graph_source: graph.source, model: 'synthetic-test', elevation_source: 'unavailable', disclaimer: 'Sintético' } } };
const catalog: LabCatalog = { modes: [{ id: 'competition', name: 'Base', nodes: graph.nodes.length, edges: graph.edges.length, coverage: 'Datos de prueba', graph_version: graph.version, source: graph.source, experimental: false, enabled: true, preview_available: true, disabled_reason: '' }], presets: [], default_config: config, original_shelters: shelters, max_snap_distance_m: 500, disclaimer: 'Sintético' };
function setup(enabled = true, authenticated = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  vi.spyOn(api, 'floodCatalog').mockResolvedValue(catalog);
  vi.spyOn(api, 'floodState').mockResolvedValue(state);
  vi.spyOn(api, 'floodGraph').mockResolvedValue(graph);
  vi.spyOn(api, 'referenceStatus').mockRejectedValue(new Error('Sin referencia'));
  vi.spyOn(api, 'incidents').mockResolvedValue({ incidents: [], total: 0, limit: 200, offset: 0, has_more: false });
  const session = vi.spyOn(api, 'floodSession').mockResolvedValue({ enabled, authenticated, csrf_token: authenticated ? 'lab-csrf' : '' });
  const start = vi.spyOn(api, 'startFlood').mockResolvedValue({ ...state, state: 'running' });
  const login = vi.spyOn(api, 'login').mockResolvedValue({ enabled: true, authenticated: true, csrf_token: 'admin-csrf' });
  render(<QueryClientProvider client={client}><FloodLab /></QueryClientProvider>);
  return { session, start, login, client };
}
function openShelterEditor() {
  const trigger = screen.getByRole('button', { name: 'Refugios y agentes' });
  if (trigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger);
  const editor = screen.getByText('Editar cuatro refugios').closest('details')!;
  editor.open = true;
  return editor;
}
function openConfiguration() {
  const summary = screen.getByText('Configurar tormenta', { selector: 'summary' });
  if (!summary.closest('details')!.open) fireEvent.click(summary);
}
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); sessionStorage.clear(); });
describe('acceso directo al laboratorio', () => {
  it('prepara hidráulica compuesta y duración sin iniciar al configurar y conserva los perfiles existentes', async () => {
    const { start } = setup();
    await screen.findByRole('button', { name: 'Iniciar tormenta' });
    openConfiguration();
    const model = screen.getByLabelText('Algoritmo hidráulico');
    expect(model.querySelectorAll('option')).toHaveLength(2);
    fireEvent.change(model, { target: { value: 'compound_flood_2d' } });
    expect(screen.getByLabelText('Perfil de lluvia').querySelectorAll('option')).toHaveLength(3);
    expect(screen.getByLabelText('Comportamiento de evacuación').querySelectorAll('option')).toHaveLength(3);
    fireEvent.change(screen.getByLabelText('Perfil de lluvia'), { target: { value: 'pulse' } });
    fireEvent.change(screen.getByLabelText('Comportamiento de evacuación'), { target: { value: 'adaptive' } });
    fireEvent.click(screen.getByText('Configuración avanzada', { selector: 'summary' }));
    const duration = screen.getByLabelText('Duración de la simulación');
    fireEvent.change(duration, { target: { value: '3001' } });
    expect(screen.getByRole('button', { name: 'Iniciar tormenta' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '1200 turnos' }));
    fireEvent.change(screen.getByLabelText('Lluvia antecedente (horas)'), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText('Saturación inicial (0–1)'), { target: { value: '.8' } });
    fireEvent.change(screen.getByLabelText('Nivel marítimo experimental (m)'), { target: { value: '1.5' } });
    expect(start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar tormenta' }));
    await waitFor(() => expect(start).toHaveBeenCalledWith(expect.objectContaining({ hydraulic_model: 'compound_flood_2d', simulation_duration: 1200, rainfall_profile: 'pulse', evacuation_behavior: 'adaptive', hydrology: expect.objectContaining({ antecedent_rain_hours: 6, initial_saturation: .8, sea_level_m: 1.5 }) }), state.run_id));
  });

  it('rechaza umbrales hidráulicos incoherentes antes de iniciar una tormenta', async () => {
    const { start } = setup();
    await screen.findByRole('button', { name: 'Iniciar tormenta' });
    openConfiguration();
    fireEvent.click(screen.getByText('Configuración avanzada', { selector: 'summary' }));
    fireEvent.change(screen.getByLabelText('Profundidad de bloqueo vial (m)'), { target: { value: '.05' } });
    expect(screen.getByRole('button', { name: 'Iniciar tormenta' })).toBeDisabled();
    expect(start).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Profundidad de bloqueo vial (m)'), { target: { value: '.3' } });
    expect(screen.getByRole('button', { name: 'Iniciar tormenta' })).toBeEnabled();
  });

  it('inicia directamente sin operador, sesión previa ni credenciales automáticas', async () => {
    const { session, start, login } = setup();
    const storm = await screen.findByRole('button', { name: 'Iniciar tormenta' });
    expect(storm).toBeEnabled(); expect(start).not.toHaveBeenCalled();
    expect(screen.queryByText('Acceso de operador')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Operador')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Código de acceso')).not.toBeInTheDocument();
    expect(session).not.toHaveBeenCalled(); expect(login).not.toHaveBeenCalled();
    fireEvent.click(storm);
    await waitFor(() => expect(start).toHaveBeenCalledWith(config, state.run_id));
    expect(localStorage.length + sessionStorage.length).toBe(0);
  });


  it('valida un marcador provisional, exige confirmación y envía los candidatos confirmados al servidor', async () => {
    const { start } = setup(true, true);
    const result: LabCandidateValidation = { valid: true, candidates: shelters.map((candidate, index) => ({ ...candidate, ...(index === 0 ? { lat: -1.000123, lng: -80.000123 } : {}), node_id: graph.shelters[index]!.node_id, snapped_lat: index === 0 ? -1.0001 : candidate.lat, snapped_lng: index === 0 ? -80.0001 : candidate.lng, snap_distance_m: 3, valid: true, message: 'Acceso vial válido' })) };
    const validate = vi.spyOn(api, 'validateFloodCandidates').mockResolvedValue(result);
    await screen.findByRole('button', { name: 'Iniciar tormenta' });
    const editor = openShelterEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Elegir candidato 1 en el mapa' }));
    expect(editor.open).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Señalar ubicación de prueba' }));
    expect(await screen.findByText(/Marcador provisional ajustado/)).toHaveTextContent('-1.0001, -80.0001');
    expect(validate).toHaveBeenCalledWith('competition', expect.arrayContaining([expect.objectContaining({ lat: -1.000123, lng: -80.000123 })]));
    expect(screen.queryByLabelText('Latitud del candidato 1')).not.toBeInTheDocument();
    expect(start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar ubicación' }));
    openShelterEditor();
    expect(screen.getByLabelText('Latitud del candidato 1')).toHaveValue('-1.000123');
    expect(screen.queryByText(/Marcador provisional ajustado/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar tormenta' }));
    await waitFor(() => expect(start).toHaveBeenCalledWith(expect.objectContaining({ shelters: expect.arrayContaining([expect.objectContaining({ id: shelters[0]!.id, lat: -1.000123, lng: -80.000123 })]) }), state.run_id));
  });
  it('rechaza puntos inadmisibles y Escape conserva la configuración anterior', async () => {
    setup(true, true);
    vi.spyOn(api, 'validateFloodCandidates').mockResolvedValue({ valid: false, candidates: shelters.map(candidate => ({ ...candidate, node_id: '', snapped_lat: 0, snapped_lng: 0, snap_distance_m: 999, valid: false, message: 'Supera el ajuste vial máximo de 500 m' })) });
    await screen.findByRole('button', { name: 'Iniciar tormenta' });
    openShelterEditor();
    const previous = (screen.getByLabelText('Latitud del candidato 1') as HTMLInputElement).value;
    fireEvent.click(screen.getByRole('button', { name: 'Elegir candidato 1 en el mapa' }));
    fireEvent.click(screen.getByRole('button', { name: 'Señalar ubicación de prueba' }));
    expect(await screen.findByText('Supera el ajuste vial máximo de 500 m')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar ubicación' })).toBeDisabled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Confirmar ubicación' })).not.toBeInTheDocument();
    openShelterEditor();
    expect(screen.getByLabelText('Latitud del candidato 1')).toHaveValue(previous);
    expect(screen.getByRole('button', { name: 'Iniciar tormenta' })).toBeEnabled();
  });
  it('retiene mapa y ediciones tras un fallo de polling sin habilitar mutaciones', async () => {
    const { client, start } = setup(true, true);
    await screen.findByRole('button', { name: 'Iniciar tormenta' });
    openConfiguration();
    fireEvent.change(screen.getByLabelText('Cantidad de agentes'), { target: { value: '7' } });
    vi.spyOn(api, 'floodState').mockRejectedValue(new ApiError('Sin red', 'NETWORK_ERROR'));
    await client.invalidateQueries({ queryKey: ['flood', 'state'] });
    expect(await screen.findByText(/Conservamos el último estado/)).toBeInTheDocument();
    expect(screen.getByLabelText('Cantidad de agentes')).toHaveValue(7);
    expect(screen.getByLabelText('Mapa del laboratorio')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Iniciar tormenta' })).toBeDisabled();
    expect(start).not.toHaveBeenCalled();
  });

  it('ignora validaciones tardías después de cancelar y nunca aplica el marcador sin confirmar', async () => {
    setup(true, true);
    let complete!: (result: LabCandidateValidation) => void;
    const validation = new Promise<LabCandidateValidation>(resolve => { complete = resolve; });
    vi.spyOn(api, 'validateFloodCandidates').mockReturnValue(validation);
    await screen.findByRole('button', { name: 'Iniciar tormenta' });
    openShelterEditor();
    const previous = (screen.getByLabelText('Latitud del candidato 1') as HTMLInputElement).value;
    fireEvent.click(screen.getByRole('button', { name: 'Elegir candidato 1 en el mapa' }));
    fireEvent.click(screen.getByRole('button', { name: 'Señalar ubicación de prueba' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar selección en mapa' }));
    complete({ valid: true, candidates: shelters.map(candidate => ({ ...candidate, node_id: 'A', snapped_lat: -1.0001, snapped_lng: -80.0001, snap_distance_m: 3, valid: true, message: 'Válido' })) });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Iniciar tormenta' })).toBeEnabled());
    expect(screen.queryByText(/Marcador provisional ajustado/)).not.toBeInTheDocument();
    openShelterEditor();
    expect(screen.getByLabelText('Latitud del candidato 1')).toHaveValue(previous);
  });
  it('bloquea campos numéricos vacíos y evita dos inicios durante una solicitud pendiente', async () => {
    const { start } = setup(true, true);
    const storm = await screen.findByRole('button', { name: 'Iniciar tormenta' });
    openConfiguration();
    fireEvent.change(screen.getByLabelText('Cantidad de agentes'), { target: { value: '' } });
    expect(storm).toBeDisabled();
    openConfiguration();
    fireEvent.change(screen.getByLabelText('Cantidad de agentes'), { target: { value: '1' } });
    let complete!: (next: LabState) => void;
    start.mockReturnValue(new Promise<LabState>(resolve => { complete = resolve; }));
    fireEvent.click(storm); fireEvent.click(storm);
    await waitFor(() => expect(start).toHaveBeenCalledOnce());
    complete({ ...state, state: 'running' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pausar' })).toBeEnabled());
  });
  it('conserva la instancia cartográfica mientras la nueva ejecución obtiene la misma geografía', async () => {
    const { start } = setup(true, true);
    const storm = await screen.findByRole('button', { name: 'Iniciar tormenta' });
    const map = screen.getByLabelText('Mapa del laboratorio');
    let resolveGraph!: (value: Graph) => void;
    vi.mocked(api.floodGraph).mockReturnValue(new Promise(resolve => { resolveGraph = resolve; }));
    start.mockResolvedValue({ ...state, run_id: 'next-same-geography', state: 'running' });
    fireEvent.click(storm);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pausar' })).toBeEnabled());
    expect(screen.getByLabelText('Mapa del laboratorio')).toBe(map);
    expect(screen.queryByText('Cargando la red vial de inundación…')).not.toBeInTheDocument();
    resolveGraph(graph);
    await waitFor(() => expect(screen.getByLabelText('Mapa del laboratorio')).toBe(map));
  });

});
