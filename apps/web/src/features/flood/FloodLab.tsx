import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, MapPin, Pause, Play, RotateCcw, ShieldCheck, Square } from 'lucide-react';
import type { EvacuationMetrics, GeoPoint, Graph, LabCandidate, LabCandidateValidation, LabCatalog, LabComparison, LabRunConfig, LabState, LabTimelineEntry, ScenarioSnapshot } from '@corodev/contracts';
import { Badge, Button, Card, ErrorState, LoadingState } from '../../components/ui';
import { api, ApiError } from '../../services/api';
import { useFloodCatalog, useFloodGraph, useFloodSession, useFloodState, useIncidentDetail, useIncidents, useReferenceStatus, useSusceptibilityReference } from '../../services/queries';
import { FloodMap } from './FloodMap';
import { DurationControl } from '../DurationControl';
import { HydrologyControls, validHydrology } from './HydrologyControls';
import { AgentShelterPanel } from '../maps/AgentShelterPanel';
import { MetricsOverlay, SimulationHUD } from '../SimulationHUD';
import { IncidentPanel } from './IncidentPanel';
import { ReferencePanel } from './ReferencePanel';
import type { IncidentFilterDraft } from './incidentPresentation';
import './flood.css';

const stateLabels: Record<LabState['state'], string> = { idle: 'Lista para iniciar', running: 'En ejecución', paused: 'Pausada', finished: 'Finalizada', failed: 'Interrumpida', cancelled: 'Cancelada' };
const numericInput = (value: string) => value.trim() === '' ? Number.NaN : Number(value);

type CandidateDraft = { id: string; label: string; lat: string; lng: string; capacity: string };
const draftCandidate = (candidate: LabCandidate): CandidateDraft => ({ ...candidate, lat: String(candidate.lat), lng: String(candidate.lng), capacity: String(candidate.capacity) });
function readCandidate(candidate: CandidateDraft | undefined): LabCandidate | undefined {
  if (!candidate || !candidate.label.trim() || [candidate.lat, candidate.lng, candidate.capacity].some(value => value.trim() === '')) return undefined;
  const lat = Number(candidate.lat), lng = Number(candidate.lng), capacity = Number(candidate.capacity);
  if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng) || Math.abs(lng) > 180 || !Number.isInteger(capacity) || capacity < 1 || capacity > 200) return undefined;
  return { id: candidate.id, label: candidate.label.trim(), lat, lng, capacity };
}

export function FloodLab() {
  const catalog = useFloodCatalog();
  const state = useFloodState();
  return <div className="page flood-page">
    <header className="scenario-heading"><h1>Escape Manta Inundación</h1><span>Simulación con datos sintéticos</span></header>
    {catalog.data && state.data ? <FloodWorkspace catalog={catalog.data} backend={state.data} connected={!state.isError && !catalog.isError} /> : catalog.isPending || state.isPending ? <LoadingState label="Conectando con el laboratorio de inundaciones…" /> : null}
    {catalog.isError && <ErrorState error={catalog.error} onRetry={() => void catalog.refetch()} />}
    {state.isError && <><p className="session-notice" role="status">Sin conexión. Conservamos el último estado; no se iniciará otra tormenta automáticamente.</p><ErrorState error={state.error} onRetry={() => void state.refetch()} /></>}

  </div>;
}

function FloodWorkspace({ catalog, backend, connected }: { catalog: LabCatalog; backend: LabState; connected: boolean }) {
  const [protectedTools, setProtectedTools] = useState(false);
  const session = useFloodSession(protectedTools);
  const csrf = session.data?.authenticated && !session.isError ? session.data.csrf_token : ''; // Optional, for moderation/reference only.
  const client = useQueryClient();
  const [draft, setDraft] = useState<LabRunConfig>(() => ({ ...backend.config, shelters: [...backend.config.shelters] }));
  const [presetId, setPresetId] = useState('');
  const [useCustom, setUseCustom] = useState(() => backend.config.shelters.some(candidate => {
    const original = catalog.original_shelters.find(item => item.id === candidate.id);
    return !original || original.lat !== candidate.lat || original.lng !== candidate.lng || original.capacity !== candidate.capacity;
  }));
  const [candidateDrafts, setCandidateDrafts] = useState<(CandidateDraft | undefined)[]>(() => backend.config.shelters.map(draftCandidate));
  const [validation, setValidation] = useState<{ key: string; result: LabCandidateValidation }>();
  const [pickingCandidate, setPickingCandidate] = useState<number>();
  const [provisional, setProvisional] = useState<{ index: number; drafts: (CandidateDraft | undefined)[]; result: LabCandidateValidation }>();
  const pickEpoch = useRef(0);
  const executionGate = useRef(false);
  const executeOnce = async (operation: () => Promise<unknown>) => {
    if (executionGate.current) return;
    executionGate.current = true;
    try { await operation(); } catch { /* The mutation publishes the structured error. */ } finally { executionGate.current = false; }
  };
  const shelterPanel = useRef<HTMLDetailsElement>(null);
  const incidentTools = useRef<HTMLDetailsElement>(null);
  const cancelPick = () => { pickEpoch.current++; setPickingCandidate(undefined); setProvisional(undefined); };
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape') cancelPick(); };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, []);
  useEffect(() => { if (!connected) cancelPick(); }, [connected]);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [selectedShelterId, setSelectedShelterId] = useState('');
  const [agentSearch, setAgentSearch] = useState('');
  useEffect(() => { cancelPick(); setSelectedAgentId(''); setSelectedShelterId(''); }, [backend.run_id, draft.mode]);
  const [incidentFilters, setIncidentFilters] = useState<IncidentFilterDraft>({ type: '', status: '', age: '24' });
  const [selectedIncidentId, setSelectedIncidentId] = useState('');
  const [showReference, setShowReference] = useState(false);
  const referenceStatus = useReferenceStatus();
  const activeReference = backend.scenario.data_provenance.geographic_reference;
  const referenceVersion = activeReference?.dataset_version ?? referenceStatus.data?.dataset_version;
  const referencePolygons = useSusceptibilityReference(referenceVersion, showReference);
  const preview = draft.mode !== backend.mode;
  const graph = useFloodGraph(preview ? undefined : backend.run_id, preview ? draft.mode : undefined);
  const retainedGraph = useRef<Graph | undefined>(undefined);
  useEffect(() => { if (graph.data) retainedGraph.current = graph.data; }, [graph.data]);
  // Keep the renderer and camera while another run requests the exact same
  // immutable geography. Never reuse a graph with a different version.
  const visibleGraph = graph.data ?? (!preview && retainedGraph.current?.version === backend.graph_version ? retainedGraph.current : undefined);
  // Advance the age cutoff once per minute, keeping the key stable across the
  // 500 ms world updates. Incident polling never reloads street geometry.
  const incidentMinute = Math.floor(Date.now() / 60000);
  const receivedAfter = useMemo(() => incidentFilters.age ? new Date(incidentMinute * 60000 - Number(incidentFilters.age) * 3600000).toISOString() : undefined, [incidentFilters.age, incidentMinute]);
  const bbox = useMemo(() => {
    if (!graph.data?.nodes.length) return undefined;
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const node of graph.data.nodes) { minLat = Math.min(minLat, node.lat); maxLat = Math.max(maxLat, node.lat); minLng = Math.min(minLng, node.lng); maxLng = Math.max(maxLng, node.lng); }
    // Include public coordinates quantized near the street coverage boundary.
    return [minLng - .0002, minLat - .0002, maxLng + .0002, maxLat + .0002].join(',');
  }, [graph.data]);
  const incidents = useIncidents({ bbox, incident_type: incidentFilters.type || undefined, verification_status: incidentFilters.status || undefined, received_after: receivedAfter, limit: 200, offset: 0 }, Boolean(bbox));
  const incidentDetail = useIncidentDetail(selectedIncidentId || undefined);
  const parsed = useMemo(() => candidateDrafts.map(readCandidate).filter((candidate): candidate is LabCandidate => Boolean(candidate)), [candidateDrafts]);
  const candidateKey = JSON.stringify([draft.mode, candidateDrafts]);
  const currentValidation = validation?.key === candidateKey ? validation.result : undefined;
  const customValid = parsed.length === 4 && Boolean(currentValidation?.valid);
  const running = backend.state === 'running';
  const comparisonRunning = backend.comparison?.state === 'running';
  const syncState = (state: LabState) => {
    client.setQueryData(['flood', 'state'], state);
    // A new run has its own immutable graph cache key. Mark previous entries
    // stale without downloading the master again for pause/resume/speed.
    if (state.run_id !== backend.run_id || state.graph_version !== backend.graph_version) void client.invalidateQueries({ queryKey: ['flood', 'graph'], refetchType: 'none' });
  };
  const refresh = () => { void client.invalidateQueries({ queryKey: ['flood', 'state'] }); };
  const activeConfig = (): LabRunConfig => ({ ...draft, shelters: useCustom ? parsed : catalog.original_shelters });
  const start = useMutation({ mutationFn: () => api.startFlood(activeConfig(), backend.run_id), onSuccess: state => { setSelectedAgentId(''); syncState(state); }, onError: refresh });
  const action = useMutation({ mutationFn: (input: { action: 'pause' | 'resume' | 'restart' | 'repeat' | 'speed' | 'cancel'; interval?: number }) => api.floodAction(input.action, backend.run_id, input.interval), onSuccess: (state, input) => { if (state.run_id !== backend.run_id) setSelectedAgentId(''); if (input.action === 'speed') setDraft(previous => ({ ...previous, interval_ms: state.config.interval_ms })); if (input.action === 'restart' || input.action === 'repeat') { setDraft({ ...state.config, shelters: [...state.config.shelters] }); setPresetId(''); } syncState(state); }, onError: (_error, input) => { if (input.action === 'speed') setDraft(previous => ({ ...previous, interval_ms: backend.config.interval_ms })); refresh(); } });
  const validate = useMutation({ mutationFn: (input: { mode: LabRunConfig['mode']; candidates: LabCandidate[]; key: string }) => api.validateFloodCandidates(input.mode, input.candidates), onSuccess: (result, input) => setValidation({ key: input.key, result }) });
  const compare = useMutation({ mutationFn: () => api.compareFlood({ ...draft, shelters: parsed }, backend.run_id), onSuccess: syncState, onError: refresh });
  const pickValidation = useMutation({
    mutationFn: (input: { index: number; drafts: (CandidateDraft | undefined)[]; candidates: LabCandidate[]; epoch: number }) => api.validateFloodCandidates(draft.mode, input.candidates),
    onSuccess: (result, input) => { if (input.epoch === pickEpoch.current) setProvisional({ index: input.index, drafts: input.drafts, result }); },
    onError: refresh,
  });
  const busy = start.isPending || action.isPending || validate.isPending || compare.isPending || pickValidation.isPending;
  const authorized = connected;
  const configValid = Number.isSafeInteger(draft.seed) && Number.isInteger(draft.simulation_duration) && draft.simulation_duration >= (catalog.duration_limits?.min_ticks ?? 30) && draft.simulation_duration <= (catalog.duration_limits?.max_ticks ?? 3000) && validHydrology(draft.hydrology) && draft.rainfall_intensity >= 0 && draft.rainfall_intensity <= 1 && Number.isInteger(draft.agents) && draft.agents >= 1 && draft.agents <= 200 && (!draft.geographic_reference?.enabled || Number.isFinite(draft.geographic_reference.strength) && draft.geographic_reference.strength >= 0 && draft.geographic_reference.strength <= 1);
  const canConfigureRun = !running && !comparisonRunning && !busy && authorized && pickingCandidate === undefined;
  const mutationError = start.error ?? action.error ?? validate.error ?? compare.error;
  const selectedMode = catalog.modes.find(mode => mode.id === draft.mode);
  const activeMode = catalog.modes.find(mode => mode.id === backend.mode);
  const panelAgents = useMemo(() => preview ? [] : backend.scenario.agents.map(agent => ({ id: agent.id, state: agent.state, shelterId: agent.target_shelter_id, routeAvailable: agent.planned_route.some(node => node !== agent.current_node) })), [preview, backend.scenario.agents]);
  const panelShelterStates = useMemo(() => Object.fromEntries(backend.scenario.shelter_conditions.map(condition => [condition.shelter_id, condition.state])), [backend.scenario.shelter_conditions]);
  const currentShelters = preview ? graph.data?.shelters ?? [] : backend.shelters;
  const changeDraft = <K extends keyof LabRunConfig>(key: K, value: LabRunConfig[K]) => { setDraft(previous => ({ ...previous, [key]: value })); setPresetId(''); };
  const setCandidate = (index: number, candidate: CandidateDraft | undefined) => { cancelPick(); setCandidateDrafts(previous => previous.map((item, i) => i === index ? candidate : item)); setValidation(undefined); };
  const pickPosition = (point: GeoPoint) => {
    if (pickingCandidate === undefined || !authorized || pickValidation.isPending) return;
    const index = pickingCandidate;
    const previous = candidateDrafts[index] ?? draftCandidate(catalog.original_shelters[index]!);
    const drafts = candidateDrafts.map((item, i) => i === index ? { ...previous, lat: point.lat.toFixed(6), lng: point.lng.toFixed(6) } : item);
    const candidates = drafts.map(readCandidate).filter((candidate): candidate is LabCandidate => Boolean(candidate));
    setProvisional(undefined);
    pickValidation.mutate({ index, drafts, candidates, epoch: ++pickEpoch.current });
  };
  const provisionalCandidate = provisional?.result.candidates.find(candidate => candidate.id === provisional.drafts[provisional.index]?.id);
  const confirmPick = () => {
    if (!provisional || !provisionalCandidate?.valid || !authorized) return;
    setCandidateDrafts(provisional.drafts);
    setValidation({ key: JSON.stringify([draft.mode, provisional.drafts]), result: provisional.result });
    setUseCustom(true);
    cancelPick();
  };
  const requestStart = () => {
    if (backend.state === 'paused' && backend.scenario.simulation_step > 0 && !window.confirm('Se reemplazará la tormenta pausada con la configuración preparada. ¿Continuar?')) return;
    void executeOnce(() => start.mutateAsync());
  };
  const requestRestart = () => {
    if ((backend.state === 'paused' || backend.state === 'running') && backend.scenario.simulation_step > 0 && !window.confirm('Reiniciar devuelve esta tormenta al paso cero. ¿Continuar?')) return;
    void executeOnce(() => action.mutateAsync({ action: 'restart' }));
  };
  const panel = <AgentShelterPanel selectingPosition={pickingCandidate !== undefined} shelters={currentShelters} agents={panelAgents} selectedAgentId={selectedAgentId} onSelectAgent={setSelectedAgentId} selectedShelterId={selectedShelterId} onSelectShelter={setSelectedShelterId} search={agentSearch} onSearch={setAgentSearch} shelterStates={panelShelterStates} editor={<details ref={shelterPanel} className="flood-map-shelters"><summary>Editar cuatro refugios</summary><div className="flood-editor-card"><div className="flood-card-heading"><div><span className="flood-kicker"><MapPin size={16} /> REFUGIOS EXPERIMENTALES</span><h2>Cuatro candidatos, una estrategia</h2><p>Las ubicaciones propuestas no están habilitadas oficialmente como alojamientos temporales.</p></div><Badge tone={customValid ? 'success' : 'neutral'}>{parsed.length} / 4 candidatos</Badge></div>
      <fieldset className="flood-strategy-selection"><legend>Refugios para iniciar</legend><label><input type="radio" name="flood-shelter-strategy" checked={!useCustom} onChange={() => setUseCustom(false)} />Conservar cuatro refugios originales</label><label><input type="radio" name="flood-shelter-strategy" checked={useCustom} onChange={() => setUseCustom(true)} />Usar cuatro refugios personalizados</label></fieldset>
      <p className="muted">Candidatos experimentales. Ajuste vial máximo: {catalog.max_snap_distance_m} m; no se certifica seguridad por elevación.</p>
      <div className="flood-candidate-grid">{candidateDrafts.map((candidate, index) => <CandidateEditor key={index} index={index} disabled={!authorized || busy} candidate={candidate} validation={currentValidation?.candidates.find(item => item.id === candidate?.id)} picking={pickingCandidate === index} onChange={next => setCandidate(index, next)} onPick={() => { if (!authorized || busy) return; if (!candidate) setCandidate(index, draftCandidate(catalog.original_shelters[index]!)); cancelPick(); pickValidation.reset(); setPickingCandidate(index); if (shelterPanel.current) shelterPanel.current.open = false; }} onRestore={() => setCandidate(index, draftCandidate(catalog.original_shelters[index]!))} />)}</div>
      <div className="flood-actions"><Button variant="secondary" disabled={parsed.length !== 4 || busy || !authorized} onClick={() => validate.mutate({ mode: draft.mode, candidates: parsed, key: candidateKey })}><ShieldCheck size={16} />{validate.isPending ? 'Validando…' : 'Validar cuatro candidatos'}</Button><Button variant="ghost" onClick={() => { setCandidateDrafts(catalog.original_shelters.map(draftCandidate)); setValidation(undefined); cancelPick(); setUseCustom(false); }}>Restaurar configuración inicial de refugios</Button></div>
      {currentValidation && <p role={currentValidation.valid ? 'status' : 'alert'} className={currentValidation.valid ? 'flood-validation-success' : 'flood-validation-error'}>{currentValidation.valid ? 'Los cuatro candidatos son válidos y accesibles en el grafo seleccionado.' : 'Corrige los candidatos rechazados antes de iniciar o comparar.'}</p>}
    </div></details>} />;
  const hud = <div className="flood-workspace-hud">
    <div className="flood-workspace-preparation">      <details className="flood-parameters flood-hud-disclosure"><summary>Configurar tormenta</summary><div className="flood-config-popover"><p className="flood-compact-notice">Los cambios se aplican al iniciar una tormenta nueva.</p><div className="flood-configuration-grid"><label>Cobertura de inundación<select value={draft.mode} onChange={event => { changeDraft('mode', event.target.value as LabRunConfig['mode']); setValidation(undefined); cancelPick(); }}>{catalog.modes.map(mode => <option key={mode.id} value={mode.id}>{mode.id === 'competition' ? `Modo base — ${mode.nodes.toLocaleString('es-EC')} intersecciones` : `Manta completa — maestro urbano (${mode.nodes.toLocaleString('es-EC')} intersecciones)`}</option>)}</select></label>
        <label>Preset de tormenta<select value={presetId} onChange={event => { const preset = catalog.presets.find(item => item.id === event.target.value); setPresetId(event.target.value); if (preset) setDraft(previous => ({ ...preset.config, mode: previous.mode, shelters: previous.shelters, seed: previous.seed, agents: previous.agents, interval_ms: previous.interval_ms, geographic_reference: previous.geographic_reference, simulation_duration: previous.simulation_duration, hydraulic_model: previous.hydraulic_model, hydrology: previous.hydrology })); }}><option value="">Configuración personalizada</option>{catalog.presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></label>
        <label>Algoritmo hidráulico<select value={draft.hydraulic_model ?? 'rainfall_runoff_2d'} onChange={event => changeDraft('hydraulic_model', event.target.value as LabRunConfig['hydraulic_model'])}><option value="rainfall_runoff_2d">Rainfall–Runoff 2D</option><option value="compound_flood_2d">Compound Flood 2D · experimental</option></select></label>
        <label>Perfil de lluvia<select value={draft.rainfall_profile} onChange={event => changeDraft('rainfall_profile', event.target.value as LabRunConfig['rainfall_profile'])}><option value="storm">Tormenta y drenaje</option><option value="constant">Lluvia constante</option><option value="pulse">Pulso de lluvia</option></select></label>
        <label>Intensidad de lluvia<input type="number" min="0" max="1" step="0.05" value={Number.isFinite(draft.rainfall_intensity) ? draft.rainfall_intensity : ''} onChange={event => changeDraft('rainfall_intensity', numericInput(event.target.value))} /><small>Índice de escenario 0–1; equivale a 0–120 mm/h sintéticos en el nuevo modelo, sin calibración meteorológica.</small></label>
        <label>Comportamiento de evacuación<select value={draft.evacuation_behavior} onChange={event => changeDraft('evacuation_behavior', event.target.value as LabRunConfig['evacuation_behavior'])}><option value="preventive">Preventiva</option><option value="late">Tardía</option><option value="adaptive">Adaptativa</option></select></label>
        <label>Cantidad de agentes<input type="number" min="1" max="200" step="1" value={Number.isFinite(draft.agents) ? draft.agents : ''} onChange={event => changeDraft('agents', numericInput(event.target.value))} /></label>
      </div>
      <details className="flood-advanced"><summary>Configuración avanzada</summary><div className="flood-configuration-grid">        <DurationControl value={Number.isFinite(draft.simulation_duration) ? String(draft.simulation_duration) : ''} min={catalog.duration_limits?.min_ticks ?? 30} max={catalog.duration_limits?.max_ticks ?? 3000} onChange={value => changeDraft('simulation_duration', numericInput(value))} />
        <label>Semilla de inundación<input type="number" step="1" min="-9007199254740991" max="9007199254740991" value={Number.isFinite(draft.seed) ? draft.seed : ''} onChange={event => changeDraft('seed', numericInput(event.target.value))} /></label>
        <label>Velocidad de reproducción<select value={draft.interval_ms} disabled={busy || comparisonRunning || !authorized} onChange={event => { const interval = Number(event.target.value); setDraft(previous => ({ ...previous, interval_ms: interval })); if (backend.state === 'running' || backend.state === 'paused') void executeOnce(() => action.mutateAsync({ action: 'speed', interval })); }}><option value="2000">Lenta · 2 s por paso</option><option value="1000">Normal · 1 s por paso</option><option value="500">Ágil · 500 ms por paso</option><option value="250">Rápida · 250 ms por paso</option><option value="25">Muy rápida · 25 ms por paso</option><option value="0">Acelerada · sin espera</option></select><small>Intervalo activo: {backend.config.interval_ms} ms. La velocidad no cambia el modelo.</small></label>
      </div><HydrologyControls value={draft.hydrology} compound={draft.hydraulic_model === 'compound_flood_2d'} onChange={value => changeDraft('hydrology', value)} /><div className="flood-reference-controls"><label><input type="checkbox" checked={Boolean(draft.geographic_reference?.enabled)} disabled={!referenceStatus.data?.dataset_version} onChange={event => changeDraft('geographic_reference', event.target.checked ? { enabled: true, dataset_version: referenceStatus.data!.dataset_version!, strength: 0 } : undefined)} />Usar susceptibilidad geográfica como referencia</label><p className="muted">Fija la versión como contexto al iniciar. La susceptibilidad no cambia el relieve, la lluvia, las profundidades ni los bloqueos calculados.</p></div>
</details></div></details>
      <span className="flood-prepared-summary">{selectedMode?.id === 'competition' ? 'Base' : 'Manta ampliada'} · {Number.isFinite(draft.agents) ? draft.agents : '—'} agentes</span>
    </div>
    <SimulationHUD label="Tormenta" status={stateLabels[backend.state]} tick={backend.state === 'idle' ? undefined : backend.scenario.simulation_step} maxTicks={backend.config.simulation_duration} elapsed={backend.state === 'idle' ? undefined : `Evacuación ${backend.scenario.simulation_time.toFixed(0)} u. · tormenta ${((backend.scenario.hydraulic?.hydrological_time_seconds ?? 0) / 60).toFixed(1)} min · ejecución ${((backend.runtime_elapsed_ms ?? backend.scenario.performance.simulation_total_duration_ms) / 1000).toFixed(1)} s`}>
      {!running && backend.state !== 'paused' && <Button disabled={!canConfigureRun || !configValid || useCustom && !customValid} onClick={requestStart}><Play size={14} />{start.isPending ? 'Iniciando…' : 'Iniciar tormenta'}</Button>}
      {running && <Button variant="secondary" disabled={busy || !authorized || comparisonRunning} onClick={() => void executeOnce(() => action.mutateAsync({ action: 'pause' }))}><Pause size={14} />Pausar</Button>}
      {backend.state === 'paused' && <Button variant="secondary" disabled={busy || !authorized || comparisonRunning} onClick={() => void executeOnce(() => action.mutateAsync({ action: 'resume' }))}><Play size={14} />Continuar</Button>}
      {(running || backend.state === 'paused') && <Button variant="secondary" disabled={busy || !authorized || comparisonRunning} onClick={() => void executeOnce(() => action.mutateAsync({ action: 'cancel' }))}><Square size={14} />Cancelar</Button>}
      <details className="flood-hud-disclosure flood-actions-disclosure"><summary>Más acciones</summary><div className="flood-config-popover">
        {backend.state === 'paused' && <Button title="Reemplazar la tormenta pausada con los parámetros preparados" disabled={!canConfigureRun || !configValid || useCustom && !customValid} onClick={requestStart}><Play size={14} />Iniciar tormenta</Button>}
        {backend.state !== 'idle' && <Button variant="secondary" title="Volver al paso cero con la misma configuración" disabled={busy || !authorized || comparisonRunning} onClick={requestRestart}><RotateCcw size={14} />Reiniciar</Button>}
        {!running && <Button variant="secondary" title="Ejecutar otra vez la misma configuración y semilla" disabled={busy || !authorized || comparisonRunning} onClick={() => void executeOnce(() => action.mutateAsync({ action: 'repeat' }))}>Repetir</Button>}
      </div></details>
    </SimulationHUD>
    {preview && <p className="flood-compact-notice" role="status">Previsualizando {selectedMode?.name}. El motor activo conserva {activeMode?.name}.</p>}
    {useCustom && !customValid && <p className="flood-compact-notice" role="status">Valida los cuatro candidatos en Refugios y agentes antes de iniciar.</p>}
    {!configValid && <p className="flood-validation-error" role="alert">Revisa intensidad 0–1, duración entera 30–3.000 turnos, agentes 1–200, semilla y parámetros hidráulicos. El bloqueo debe superar la precaución y la histéresis debe ser menor.</p>}
    {mutationError && <ErrorState error={mutationError} onRetry={() => { start.reset(); action.reset(); validate.reset(); compare.reset(); refresh(); }} />}
      {pickingCandidate !== undefined && <div className="flood-pick-notice" role="status"><p>Selecciona la ubicación del refugio {pickingCandidate + 1} en el mapa. Escape cancela.</p>{pickValidation.isPending && <p>Validando ajuste y conectividad con el servidor…</p>}{pickValidation.error && <ErrorState error={pickValidation.error} />}{provisionalCandidate && <p>{provisionalCandidate.message}{provisionalCandidate.valid && <> · ajuste {provisionalCandidate.snap_distance_m.toFixed(1)} m</>}</p>}<div className="flood-actions"><Button disabled={!provisionalCandidate?.valid || pickValidation.isPending || !authorized} onClick={confirmPick}>Confirmar ubicación</Button><Button variant="ghost" onClick={cancelPick}>Cancelar selección en mapa</Button></div></div>}

  </div>;
  return <>
    <section className="flood-map-card flood-map-workspace" aria-label="Laboratorio cartográfico de inundación">
      {!visibleGraph && !graph.isError ? <LoadingState label="Cargando la red vial de inundación…" /> : !visibleGraph && graph.isError ? <ErrorState error={graph.error} onRetry={() => { if (graph.error instanceof ApiError && (graph.error.code === 'RUN_CHANGED' || graph.error.status === 409)) refresh(); void graph.refetch(); }} /> : !preview && visibleGraph!.version !== backend.graph_version ? <p role="alert">La geografía cambió de ejecución. <Button variant="secondary" onClick={() => { refresh(); void graph.refetch(); }}>Actualizar geografía</Button></p> : <FloodMap hud={hud} panel={panel} metrics={backend.state === 'idle' && backend.scenario.simulation_step === 0 ? undefined : <MetricsPanel metrics={backend.scenario.evacuation_metrics} latency={backend.timeline.at(-1)?.step_latency_ms ?? backend.scenario.performance.simulation_step_latency_ms} />} referenceAvailable={['cached', 'stale'].includes(referenceStatus.data?.availability ?? '')} lifecycle={{ id: preview ? '' : backend.run_id, running: !preview && backend.state === 'running', connected, interval: backend.config.interval_ms }} graph={visibleGraph!} scenario={preview ? undefined : backend.scenario} shelters={currentShelters} candidates={parsed} validation={currentValidation} selectedAgentId={selectedAgentId} onSelectAgent={id => setSelectedAgentId(previous => previous === id ? '' : id)} selectedShelterId={selectedShelterId} onSelectShelter={setSelectedShelterId} pickingCandidate={pickingCandidate} onPickPosition={pickPosition} onCancelPick={cancelPick} onOpenIncident={id => { setSelectedIncidentId(id); if (incidentTools.current) { incidentTools.current.open = true; incidentTools.current.scrollIntoView({ block: 'nearest' }); } }} previewPosition={provisionalCandidate?.valid ? { lat: provisionalCandidate.snapped_lat, lng: provisionalCandidate.snapped_lng } : undefined} incidents={incidents.data?.incidents} selectedIncidentId={selectedIncidentId} onSelectIncident={setSelectedIncidentId} reference={referencePolygons.data} showReference={showReference} onShowReference={setShowReference} />}
    </section>
    <details className="flood-secondary" onToggle={event => { if (event.currentTarget.open) setProtectedTools(true); }}><summary>Datos y fuentes oficiales</summary><ReferencePanel status={referenceStatus.data} collection={referencePolygons.data} loading={referenceStatus.isPending || showReference && referencePolygons.isFetching} error={referenceStatus.error ?? (showReference ? referencePolygons.error : null)} retry={() => { void referenceStatus.refetch(); if (showReference && referenceVersion) void referencePolygons.refetch(); }} csrf={csrf} active={activeReference} /></details>
    <details ref={incidentTools} className="flood-secondary" onToggle={event => { if (event.currentTarget.open) setProtectedTools(true); }}><summary>Reportes y herramientas autorizadas</summary><IncidentPanel list={incidents.data} loading={incidents.isPending} error={incidents.error} onRetry={() => { void incidents.refetch(); if (selectedIncidentId) void incidentDetail.refetch(); }} filters={incidentFilters} onFilters={setIncidentFilters} selectedId={selectedIncidentId} onSelect={setSelectedIncidentId} selected={incidentDetail.data ?? incidents.data?.incidents.find(incident => incident.incident_id === selectedIncidentId)} detailLoading={Boolean(selectedIncidentId) && incidentDetail.isPending} detailError={incidentDetail.error} backend={backend} preview={preview} csrf={csrf} busy={busy} onApplied={result => { const current = client.getQueryData<LabState>(['flood', 'state']); if (current?.run_id === result.state.run_id && current.scenario.world_version <= result.state.scenario.world_version) syncState(result.state); else refresh(); client.setQueryData(['incidents', 'detail', result.incident.incident_id], result.incident); }} /></details>
    <details className="flood-secondary"><summary>Evolución y resultados</summary><Card className="flood-timeline-card"><HydraulicMetrics scenario={backend.scenario} /><Timeline timeline={backend.timeline} current={backend.scenario.simulation_step} duration={backend.config.simulation_duration} /></Card></details>
    <details className="flood-secondary"><summary>Comparar estrategias · A/B</summary><Card className="flood-comparison-card"><div className="flood-card-heading"><div><span className="flood-kicker"><FlaskConical size={16} /> COMPARACIÓN CONTROLADA</span><h2>Cuatro originales frente a cuatro alternativos</h2><p>Misma semilla, lluvia, agentes, duración y puntos de origen. Sólo cambian los refugios.</p></div><Button disabled={!canConfigureRun || !configValid || !customValid} onClick={() => void executeOnce(() => compare.mutateAsync())}>{compare.isPending || comparisonRunning ? 'Comparando…' : 'Comparar A/B'}</Button></div>
      {!customValid && <p className="muted">Edita y valida cuatro candidatos para habilitar la comparación. La capacidad también forma parte de la estrategia de refugios.</p>}
      {backend.comparison ? <ComparisonPanel comparison={backend.comparison} /> : <div className="flood-comparison-empty"><FlaskConical size={28} /><p>Ejecuta ambas estrategias con los mismos agentes y la misma tormenta.</p><span>Valida cuatro candidatos para comparar los resultados.</span></div>}
    </Card>
    </details><details className="flood-secondary"><summary>Origen de los datos y límites</summary><Card className="flood-provenance-card"><h2>Origen de los datos y límites</h2><dl><div><dt>Geografía</dt><dd>{backend.scenario.data_provenance.graph_source}</dd></div><div><dt>Modelo</dt><dd>{backend.scenario.data_provenance.model}</dd></div><div><dt>Elevación</dt><dd>{backend.scenario.data_provenance.elevation_source === 'unavailable' ? 'Sin datos verificados de elevación; no se infiere seguridad por altura.' : backend.scenario.data_provenance.elevation_source}</dd></div><div><dt>Apariciones</dt><dd>{backend.origins.length} orígenes geográficos conservados. Ajuste máximo registrado: {Math.max(0, ...backend.origins.map(origin => origin.snap_distance_m)).toFixed(1)} m.</dd></div></dl><p>{catalog.disclaimer}</p></Card></details>
  </>;
}

function CandidateEditor({ index, disabled, candidate, validation, picking, onChange, onPick, onRestore }: { index: number; disabled: boolean; candidate?: CandidateDraft; validation?: LabCandidateValidation['candidates'][number]; picking: boolean; onChange: (candidate: CandidateDraft | undefined) => void; onPick: () => void; onRestore: () => void }) {
  return <fieldset className={`flood-candidate-card ${picking ? 'flood-candidate-picking' : ''}`}><legend><span>{index + 1}</span>Candidato {index + 1}</legend>{candidate ? <>
    <label>Nombre del candidato {index + 1}<input value={candidate.label} maxLength={100} placeholder="Universidad / instalación deportiva / terminal" onChange={event => onChange({ ...candidate, label: event.target.value })} /></label><details><summary>Coordenadas</summary><div className="flood-candidate-coordinates"><label>Latitud del candidato {index + 1}<input type="text" inputMode="decimal" value={candidate.lat} onChange={event => onChange({ ...candidate, lat: event.target.value })} /></label><label>Longitud del candidato {index + 1}<input type="text" inputMode="decimal" value={candidate.lng} onChange={event => onChange({ ...candidate, lng: event.target.value })} /></label></div></details><label>Capacidad del candidato {index + 1}<input type="number" min="1" max="200" step="1" value={candidate.capacity} onChange={event => onChange({ ...candidate, capacity: event.target.value })} /></label><div className="flood-candidate-actions"><Button variant="secondary" disabled={disabled} onClick={onPick} aria-label={`Elegir candidato ${index + 1} en el mapa`}>{picking ? 'Esperando clic…' : 'Editar ubicación'}</Button><Button variant="ghost" onClick={() => onChange(undefined)} aria-label={`Eliminar candidato ${index + 1}`}>Eliminar</Button></div>
    {validation && <p className={validation.valid ? 'flood-validation-success' : 'flood-validation-error'}>{validation.message}{validation.node_id && <><br />Nodo: {validation.node_id} · ajuste {validation.snap_distance_m.toFixed(1)} m</>}</p>}
    {!readCandidate(candidate) && <p className="flood-validation-error">Completa el nombre, coordenadas válidas y capacidad entre 1 y 200 antes de validar.</p>}
  </> : <div className="flood-candidate-empty"><p>Este candidato fue retirado. Necesitas cuatro ubicaciones válidas.</p><Button variant="secondary" disabled={disabled} onClick={onPick} aria-label={`Reemplazar candidato ${index + 1} en el mapa`}>Reemplazar en mapa</Button><Button variant="ghost" onClick={onRestore}>Restaurar candidato {index + 1}</Button></div>}</fieldset>;
}

function MetricsPanel({ metrics, latency }: { metrics: EvacuationMetrics; latency: number }) {
  const percentage = metrics.total_agents ? metrics.evacuated_agents / metrics.total_agents * 100 : 0;
  return <MetricsOverlay items={[
    { label: 'Evacuados', value: `${percentage.toFixed(1)}%`, detail: `${metrics.evacuated_agents} / ${metrics.total_agents} agentes` },
    { label: 'Aislados / esperando', value: `${metrics.isolated_agents} / ${metrics.waiting_agents}` },
    { label: 'Calles bloqueadas', value: metrics.blocked_edges, detail: `${metrics.caution_edges} en precaución` },
    { label: 'Tiempo medio', value: metrics.evacuated_agents ? metrics.average_evacuation_time.toFixed(1) : '—', detail: 'Unidades del modelo' },
    { label: 'Replanificaciones', value: metrics.reroute_count, detail: `${metrics.shelters_at_capacity} refugios a capacidad` },
    { label: 'Latencia del paso', value: latency > 0 ? `${latency.toFixed(1)} ms` : '—', detail: latency > 0 ? 'Paso publicado' : 'Sin pasos medidos' },
  ]} />;
}

function HydraulicMetrics({ scenario }: { scenario: ScenarioSnapshot }) {
  const hydraulic = scenario.hydraulic;
  if (!hydraulic) return null;
  const balance = hydraulic.mass_balance;
  return <section className="hydraulic-metrics" aria-label="Balance de agua calculado"><h3>Balance hidráulico experimental</h3><dl>
    <div><dt>Superficie con agua ≥1 cm</dt><dd>{(hydraulic.flooded_area_m2 / 1000000).toFixed(3)} km²</dd></div>
    <div><dt>Profundidad máxima calculada</dt><dd>{hydraulic.max_depth_m.toFixed(3)} m</dd></div>
    <div><dt>Volumen almacenado</dt><dd>{balance.stored_m3.toFixed(1)} m³</dd></div>
    <div><dt>Entrada por lluvia</dt><dd>{balance.rainfall_m3.toFixed(1)} m³</dd></div>
    <div><dt>Infiltración / drenaje</dt><dd>{balance.infiltration_m3.toFixed(1)} / {balance.drainage_m3.toFixed(1)} m³</dd></div>
    <div><dt>Residual de masa</dt><dd>{balance.residual_m3.toExponential(2)} m³</dd></div>
    <div><dt>Malla efectiva</dt><dd>{hydraulic.grid.rows} × {hydraulic.grid.cols} · {hydraulic.grid.cell_size_m.toFixed(1)} m</dd></div>
    <div><dt>Cálculo hidráulico / evacuación</dt><dd>{scenario.performance.hydraulic_step_latency_ms?.toFixed(2) ?? '—'} / {scenario.performance.evacuation_step_latency_ms?.toFixed(2) ?? '—'} ms</dd></div>
  </dl><p className="muted">{hydraulic.terrain_source}. La susceptibilidad oficial es una capa separada; estos valores no son mediciones ni un pronóstico validado.</p></section>;
}

function Timeline({ timeline, current, duration }: { timeline: LabTimelineEntry[]; current: number; duration: number }) {
  const [inspected, setInspected] = useState<number>();
  if (!timeline.length) return <p className="muted">Todavía no hay pasos registrados. Inicia una tormenta para consultar su evolución.</p>;
  const selected = timeline.find(entry => entry.step === inspected);
  const maxAgents = Math.max(1, ...timeline.map(entry => entry.evacuation_metrics.total_agents));
  const maxStep = Math.max(1, current);
  const evacuated = timeline.map(entry => `${30 + entry.step / maxStep * 840},${145 - entry.evacuation_metrics.evacuated_agents / maxAgents * 110}`).join(' ');
  const isolated = timeline.map(entry => `${30 + entry.step / maxStep * 840},${145 - entry.evacuation_metrics.isolated_agents / maxAgents * 110}`).join(' ');
  return <><div className="flood-card-heading"><div><span className="flood-kicker">EVOLUCIÓN PUBLICADA</span><h2>Timeline de simulación</h2><p>Inspecciona métricas registradas sin alterar el reloj ni la reproducción del servidor.</p></div><Badge tone="cyan">Paso {current}</Badge></div><div className="flood-timeline-progress"><progress max={duration} value={timeline.at(-1)?.simulation_time ?? 0} aria-label="Progreso de la tormenta" /><span>{(timeline.at(-1)?.simulation_time ?? 0).toFixed(1)} / {duration} unidades</span></div><svg viewBox="0 0 900 170" role="img" aria-label="Evolución de agentes evacuados y aislados" className="flood-timeline-chart"><line x1="30" x2="870" y1="145" y2="145" /><polyline points={evacuated} className="flood-timeline-evacuated" /><polyline points={isolated} className="flood-timeline-isolated" /><text x="30" y="165">Inicio</text><text x="790" y="165">Paso {current}</text></svg><div className="flood-timeline-legend"><span>— Evacuados</span><span>— Aislados</span></div><label className="flood-timeline-inspector">Inspeccionar paso registrado<select value={inspected ?? ''} onChange={event => setInspected(event.target.value ? Number(event.target.value) : undefined)}><option value="">Último estado en vivo</option>{timeline.map(entry => <option key={entry.step} value={entry.step}>Paso {entry.step} · {entry.simulation_time.toFixed(1)} unidades</option>)}</select></label>{selected && <p role="status">Paso {selected.step}: {selected.evacuation_metrics.evacuated_agents} evacuados, {selected.evacuation_metrics.isolated_agents} aislados, {selected.evacuation_metrics.blocked_edges} calles bloqueadas · latencia {selected.step_latency_ms.toFixed(2)} ms.</p>}</>;
}

function ComparisonPanel({ comparison }: { comparison: LabComparison }) {
  const [a, b] = [comparison.results.find(result => result.strategy === 'original'), comparison.results.find(result => result.strategy === 'custom')];
  const matched = a && b && a.total_agents === b.total_agents && a.seed === b.seed && a.mode === b.mode && a.origins_hash === b.origins_hash && a.config_hash === b.config_hash;
  const metrics = [
    { label: 'Porcentaje evacuado', value: (result: NonNullable<typeof a>) => `${result.evacuated_percentage.toFixed(1)}% (${result.evacuation_metrics.evacuated_agents}/${result.total_agents})` },
    { label: 'Agentes aislados', value: (result: NonNullable<typeof a>) => String(result.evacuation_metrics.isolated_agents) },
    { label: 'Tiempo medio de evacuación', value: (result: NonNullable<typeof a>) => `${result.evacuation_metrics.average_evacuation_time.toFixed(2)} unidades` },
    { label: 'Refugios saturados', value: (result: NonNullable<typeof a>) => String(result.evacuation_metrics.shelters_at_capacity) },
    { label: 'Recálculos de ruta', value: (result: NonNullable<typeof a>) => String(result.evacuation_metrics.reroute_count) },
    { label: 'Tramos bloqueados al final', value: (result: NonNullable<typeof a>) => String(result.evacuation_metrics.blocked_edges) },
    { label: 'Latencia media de simulación', value: (result: NonNullable<typeof a>) => `${result.step_latency_ms.toFixed(2)} ms` },
  ];
  return <div className="flood-comparison-result" aria-label="Resultados de comparación A/B"><p role={comparison.state === 'failed' ? 'alert' : 'status'}>{comparison.message}</p>{comparison.state === 'running' && <progress value={comparison.progress} max={2} aria-label="Progreso de comparación A/B" />}{a && b ? <><p className={matched ? 'flood-validation-success' : 'flood-validation-error'} role={matched ? 'status' : 'alert'}>{matched ? 'Comparación verificada: mismos orígenes, agentes, grafo, semilla y parámetros de tormenta.' : 'Los identificadores de comparación no coinciden; no interpretes estos resultados como A/B controlada.'}</p><div className="flood-comparison-table"><table><thead><tr><th>Métrica</th><th>A · Cuatro originales</th><th>B · Cuatro personalizados</th></tr></thead><tbody>{metrics.map(metric => <tr key={metric.label}><th>{metric.label}</th><td>{metric.value(a)}</td><td>{metric.value(b)}</td></tr>)}</tbody></table></div><details><summary>Ver controles de reproducibilidad</summary><p>Semilla: {a.seed} · grafo: {a.graph_version} · denominador común: {a.total_agents} agentes.</p><p>Orígenes: <code>{a.origins_hash}</code></p><p>Configuración común: <code>{a.config_hash}</code></p></details></> : comparison.state !== 'running' ? <p>No se publicaron dos resultados completos; no se calcula una diferencia parcial.</p> : null}</div>;
}
