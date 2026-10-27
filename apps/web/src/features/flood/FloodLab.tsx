import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Activity, CloudRain, FlaskConical, MapPin, RotateCcw, ShieldCheck, Waves } from 'lucide-react';
import type { EvacuationMetrics, GeoPoint, LabCandidate, LabCandidateValidation, LabCatalog, LabComparison, LabRunConfig, LabState, LabTimelineEntry } from '@corodev/contracts';
import { Badge, Button, Card, ErrorState, LoadingState, PageHeader, StatusIndicator } from '../../components/ui';
import { api, ApiError } from '../../services/api';
import { useFloodCatalog, useFloodGraph, useFloodSession, useFloodState } from '../../services/queries';
import { FloodMap } from './FloodMap';
import './flood.css';

const stateLabels: Record<LabState['state'], string> = { idle: 'Lista para iniciar', running: 'En ejecución', paused: 'Pausada por el servidor', finished: 'Finalizada', failed: 'Interrumpida' };
const behaviorLabels = { preventive: 'Preventiva', late: 'Tardía', adaptive: 'Adaptativa' };
const agentLabels = { waiting: 'Esperando', moving: 'En evacuación', isolated: 'Aislado', evacuated: 'Evacuado' };
const shelterLabels = { available: 'Disponible', full: 'A capacidad', exposed: 'Expuesto', inaccessible: 'Sin acceso' };
const disclaimer = 'Los escenarios de inundación emplean parámetros sintéticos y no constituyen pronósticos hidrológicos ni recomendaciones oficiales de evacuación.';

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
  const session = useFloodSession();
  const status = catalog.isError || state.isError ? 'offline' : catalog.isPending || state.isPending ? 'checking' : 'online';
  return <div className="page flood-page">
    <PageHeader eyebrow="LABORATORIO · ESCENARIO EXPERIMENTAL" title="Inundaciones urbanas" description="Explora una tormenta sintética sobre Manta, observa rutas y compara cuatro refugios candidatos." action={<StatusIndicator status={status} />} />
    <div className="flood-synthetic-banner" role="note"><span><FlaskConical size={18} />Laboratorio de exposición sintética</span><p>Los colores no describen condiciones reales ni niveles oficiales de alerta.</p></div>
    {catalog.isPending || state.isPending ? <LoadingState label="Conectando con el laboratorio de inundaciones…" /> : catalog.isError ? <ErrorState error={catalog.error} onRetry={() => void catalog.refetch()} /> : state.isError ? <ErrorState error={state.error} onRetry={() => void state.refetch()} /> : <FloodWorkspace catalog={catalog.data} backend={state.data} csrf={session.data?.authenticated ? session.data.csrf_token : ''} sessionError={session.error} retrySession={() => void session.refetch()} />}
    <p className="flood-disclaimer">{disclaimer}</p>
  </div>;
}

function FloodWorkspace({ catalog, backend, csrf, sessionError, retrySession }: { catalog: LabCatalog; backend: LabState; csrf: string; sessionError: Error | null; retrySession: () => void }) {
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
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [agentSearch, setAgentSearch] = useState('');
  const preview = draft.mode !== backend.mode;
  const graph = useFloodGraph(preview ? undefined : backend.run_id, preview ? draft.mode : undefined);
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
  const start = useMutation({ mutationFn: () => api.startFlood(activeConfig(), backend.run_id, csrf), onSuccess: state => { setSelectedAgentId(''); syncState(state); }, onError: refresh });
  const action = useMutation({ mutationFn: (input: { action: 'pause' | 'resume' | 'restart' | 'repeat' | 'speed'; interval?: number }) => api.floodAction(input.action, backend.run_id, csrf, input.interval), onSuccess: (state, input) => { if (state.run_id !== backend.run_id) setSelectedAgentId(''); if (input.action === 'speed') setDraft(previous => ({ ...previous, interval_ms: state.config.interval_ms })); if (input.action === 'restart' || input.action === 'repeat') { setDraft({ ...state.config, shelters: [...state.config.shelters] }); setPresetId(''); } syncState(state); }, onError: (_error, input) => { if (input.action === 'speed') setDraft(previous => ({ ...previous, interval_ms: backend.config.interval_ms })); refresh(); } });
  const validate = useMutation({ mutationFn: (input: { mode: LabRunConfig['mode']; candidates: LabCandidate[]; key: string }) => api.validateFloodCandidates(input.mode, input.candidates, csrf), onSuccess: (result, input) => setValidation({ key: input.key, result }) });
  const compare = useMutation({ mutationFn: () => api.compareFlood({ ...draft, shelters: parsed }, backend.run_id, csrf), onSuccess: syncState, onError: refresh });
  const busy = start.isPending || action.isPending || validate.isPending || compare.isPending;
  const authorized = Boolean(csrf);
  const configValid = Number.isSafeInteger(draft.seed) && draft.simulation_duration >= 1 && draft.simulation_duration <= 10000 && draft.rainfall_intensity >= 0 && draft.rainfall_intensity <= 1 && Number.isInteger(draft.agents) && draft.agents >= 1 && draft.agents <= 200;
  const canConfigureRun = !running && !comparisonRunning && !busy && authorized;
  const mutationError = start.error ?? action.error ?? validate.error ?? compare.error;
  const selectedMode = catalog.modes.find(mode => mode.id === draft.mode);
  const activeMode = catalog.modes.find(mode => mode.id === backend.mode);
  const selectedAgent = backend.scenario.agents.find(agent => agent.id === selectedAgentId);
  const agents = backend.scenario.agents.filter(agent => agent.id.toLowerCase().includes(agentSearch.toLowerCase()));
  const currentShelters = preview ? graph.data?.shelters ?? [] : backend.shelters;
  const changeDraft = <K extends keyof LabRunConfig>(key: K, value: LabRunConfig[K]) => { setDraft(previous => ({ ...previous, [key]: value })); setPresetId(''); };
  const setCandidate = (index: number, candidate: CandidateDraft | undefined) => { setCandidateDrafts(previous => previous.map((item, i) => i === index ? candidate : item)); setValidation(undefined); };
  const pickPosition = (point: GeoPoint) => {
    if (pickingCandidate === undefined) return;
    const original = catalog.original_shelters[pickingCandidate]!;
    const previous = candidateDrafts[pickingCandidate] ?? draftCandidate(original);
    setCandidate(pickingCandidate, { ...previous, lat: point.lat.toFixed(6), lng: point.lng.toFixed(6) });
    setUseCustom(true); setPickingCandidate(undefined);
  };
  return <>
    <Card className="flood-controls-card"><div className="flood-card-heading"><div><span className="flood-kicker"><CloudRain size={16} /> CONFIGURA LA TORMENTA</span><h2>Una amenaza, distintas estrategias</h2><p>Los parámetros se aplican al iniciar. Cada acción se confirma con el estado del servidor.</p></div><Badge tone={running ? 'cyan' : backend.state === 'paused' ? 'warning' : 'neutral'}>{stateLabels[backend.state]}</Badge></div>
      <div className="flood-configuration-grid"><label>Cobertura de inundación<select value={draft.mode} onChange={event => { changeDraft('mode', event.target.value as LabRunConfig['mode']); setValidation(undefined); setPickingCandidate(undefined); }}>{catalog.modes.map(mode => <option key={mode.id} value={mode.id}>{mode.id === 'competition' ? `Modo base — ${mode.nodes.toLocaleString('es-EC')} intersecciones` : `Manta completa — maestro urbano (${mode.nodes.toLocaleString('es-EC')} intersecciones)`}</option>)}</select><small>{selectedMode?.coverage ?? 'Red OpenStreetMap revisada'}</small></label>
        <label>Preset de tormenta<select value={presetId} onChange={event => { const preset = catalog.presets.find(item => item.id === event.target.value); setPresetId(event.target.value); if (preset) setDraft(previous => ({ ...preset.config, mode: previous.mode, shelters: previous.shelters, seed: previous.seed, agents: previous.agents, interval_ms: previous.interval_ms })); }}><option value="">Configuración personalizada</option>{catalog.presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select><small>{catalog.presets.find(preset => preset.id === presetId)?.description ?? 'Presets experimentales; no son escalas oficiales de alerta.'}</small></label>
        <label>Perfil de lluvia<select value={draft.rainfall_profile} onChange={event => changeDraft('rainfall_profile', event.target.value as LabRunConfig['rainfall_profile'])}><option value="storm">Tormenta y drenaje</option><option value="constant">Lluvia constante</option><option value="pulse">Pulso de lluvia</option></select></label>
        <label>Intensidad de lluvia<input type="number" min="0" max="1" step="0.05" value={draft.rainfall_intensity} onChange={event => changeDraft('rainfall_intensity', Number(event.target.value))} /><small>Índice normalizado de 0 a 1; no representa mm/h.</small></label>
        <label>Duración simulada<input type="number" min="1" max="10000" step="1" value={draft.simulation_duration} onChange={event => changeDraft('simulation_duration', Number(event.target.value))} /><small>Unidades de simulación; no duración hidrológica real.</small></label>
        <label>Semilla de inundación<input type="number" step="1" min="-9007199254740991" max="9007199254740991" value={draft.seed} onChange={event => changeDraft('seed', Number(event.target.value))} /></label>
        <label>Comportamiento de evacuación<select value={draft.evacuation_behavior} onChange={event => changeDraft('evacuation_behavior', event.target.value as LabRunConfig['evacuation_behavior'])}><option value="preventive">Preventiva</option><option value="late">Tardía</option><option value="adaptive">Adaptativa</option></select></label>
        <label>Cantidad de agentes<input type="number" min="1" max="200" step="1" value={draft.agents} onChange={event => changeDraft('agents', Number(event.target.value))} /></label>
        <label>Velocidad de reproducción<select value={draft.interval_ms} disabled={busy || comparisonRunning || !authorized} onChange={event => { const interval = Number(event.target.value); setDraft(previous => ({ ...previous, interval_ms: interval })); if (backend.state === 'running' || backend.state === 'paused') action.mutate({ action: 'speed', interval }); }}><option value="2000">Lenta · 2 s por paso</option><option value="1000">Normal · 1 s por paso</option><option value="500">Ágil · 500 ms por paso</option><option value="250">Rápida · 250 ms por paso</option><option value="25">Muy rápida · 25 ms por paso</option><option value="0">Acelerada · sin espera</option></select><small>Intervalo activo: {backend.config.interval_ms} ms. La velocidad no cambia el modelo.</small></label>
      </div>
      <div className="flood-run-context"><span><MapPin size={15} />Motor activo: {activeMode?.name ?? backend.mode}</span><span>Semilla {backend.config.seed} · {backend.config.agents} agentes · {behaviorLabels[backend.config.evacuation_behavior]}</span></div>
      {preview && <p className="flood-pick-notice" role="status">Previsualización de {selectedMode?.name ?? draft.mode}. La ronda activa continúa en {activeMode?.name ?? backend.mode}; este mapa no mezcla sus agentes con otra geografía. Iniciar tormenta aplicará la cobertura seleccionada al motor.</p>}
      <div className="flood-actions"><Button disabled={!canConfigureRun || !configValid || useCustom && !customValid} onClick={() => start.mutate()}><CloudRain size={16} />{start.isPending ? 'Iniciando…' : 'Iniciar tormenta'}</Button><Button variant="secondary" disabled={!running || busy || !authorized || comparisonRunning} onClick={() => action.mutate({ action: 'pause' })}>Pausar</Button><Button variant="secondary" disabled={backend.state !== 'paused' || busy || !authorized || comparisonRunning} onClick={() => action.mutate({ action: 'resume' })}>Continuar</Button><Button variant="secondary" disabled={busy || !authorized || comparisonRunning} onClick={() => action.mutate({ action: 'restart' })}><RotateCcw size={14} />Reiniciar</Button><Button variant="secondary" disabled={running || busy || !authorized || comparisonRunning} onClick={() => action.mutate({ action: 'repeat' })}>Repetir misma seed</Button></div>
      {useCustom && !customValid && <p className="muted" role="status">Valida los cuatro candidatos en el panel de refugios para iniciar una estrategia personalizada.</p>}
      {!configValid && <p className="flood-validation-error" role="alert">Revisa intensidad entre 0 y 1, duración entre 1 y 10.000, entre 1 y 200 agentes y una semilla entera válida.</p>}
      {!authorized && !sessionError && <p role="status" className="muted">Preparando la sesión local del laboratorio…</p>}{sessionError && <ErrorState error={sessionError} onRetry={retrySession} />}
      {mutationError && <ErrorState error={mutationError} onRetry={() => { start.reset(); action.reset(); validate.reset(); compare.reset(); refresh(); }} />}
      {backend.state === 'failed' && <p role="alert">La simulación se interrumpió. Puedes reiniciarla; los datos de ese estado no equivalen a una evacuación completa.</p>}
    </Card>
    <MetricsPanel metrics={backend.scenario.evacuation_metrics} latency={backend.timeline.at(-1)?.step_latency_ms ?? backend.scenario.performance.simulation_step_latency_ms} step={backend.scenario.simulation_step} duration={backend.config.simulation_duration} />
    <Card className="flood-map-card"><div className="flood-card-heading"><div><span className="flood-kicker"><Waves size={16} /> TERRITORIO Y EVACUACIÓN</span><h2>{preview ? 'Previsualización de cobertura' : 'Exposición y rutas en tiempo de simulación'}</h2><p>{preview ? selectedMode?.coverage : `Paso ${backend.scenario.simulation_step} · tiempo ${backend.scenario.simulation_time.toFixed(1)} / ${backend.scenario.simulation_duration} · lluvia ${(backend.scenario.rainfall * 100).toFixed(0)}% sintética`}</p></div><Badge tone="cyan">{preview ? 'Solo geografía' : `${backend.scenario.agents.length} agentes`}</Badge></div>
      {graph.isPending ? <LoadingState label="Cargando la red vial de inundación…" /> : graph.isError ? <ErrorState error={graph.error} onRetry={() => { if (graph.error instanceof ApiError && (graph.error.code === 'RUN_CHANGED' || graph.error.status === 409)) refresh(); void graph.refetch(); }} /> : !preview && graph.data.version !== backend.graph_version ? <p role="alert">La geografía cambió de ejecución. <Button variant="secondary" onClick={() => { refresh(); void graph.refetch(); }}>Actualizar geografía</Button></p> : <FloodMap key={`${graph.data.version}:${preview ? 'preview' : backend.run_id}`} graph={graph.data} scenario={preview ? undefined : backend.scenario} shelters={currentShelters} candidates={parsed} validation={currentValidation} selectedAgentId={selectedAgentId} onSelectAgent={setSelectedAgentId} pickingCandidate={pickingCandidate} onPickPosition={pickPosition} />}
    </Card>
    <div className="flood-lab-columns"><Card className="flood-editor-card"><div className="flood-card-heading"><div><span className="flood-kicker"><MapPin size={16} /> REFUGIOS DE LABORATORIO</span><h2>Cuatro candidatos, una estrategia</h2><p>Las ubicaciones propuestas no están habilitadas oficialmente como alojamientos temporales.</p></div><Badge tone={customValid ? 'success' : 'neutral'}>{parsed.length} / 4 candidatos</Badge></div>
      <fieldset className="flood-strategy-selection"><legend>Refugios para iniciar</legend><label><input type="radio" name="flood-shelter-strategy" checked={!useCustom} onChange={() => setUseCustom(false)} />Conservar cuatro refugios originales</label><label><input type="radio" name="flood-shelter-strategy" checked={useCustom} onChange={() => setUseCustom(true)} />Usar cuatro refugios personalizados</label></fieldset>
      <p className="muted">Usa el mapa o introduce coordenadas conocidas de una universidad, instalación deportiva, aeropuerto o terminal. El servidor comprueba acceso vial, ajuste máximo de {catalog.max_snap_distance_m} m y duplicados.</p>
      <div className="flood-candidate-grid">{candidateDrafts.map((candidate, index) => <CandidateEditor key={index} index={index} candidate={candidate} validation={currentValidation?.candidates.find(item => item.id === candidate?.id)} picking={pickingCandidate === index} onChange={next => setCandidate(index, next)} onPick={() => { if (!candidate) setCandidate(index, draftCandidate(catalog.original_shelters[index]!)); setPickingCandidate(index); setUseCustom(true); }} onRestore={() => setCandidate(index, draftCandidate(catalog.original_shelters[index]!))} />)}</div>
      <div className="flood-actions"><Button variant="secondary" disabled={parsed.length !== 4 || busy || !authorized} onClick={() => validate.mutate({ mode: draft.mode, candidates: parsed, key: candidateKey })}><ShieldCheck size={16} />{validate.isPending ? 'Validando…' : 'Validar cuatro candidatos'}</Button><Button variant="ghost" onClick={() => { setCandidateDrafts(catalog.original_shelters.map(draftCandidate)); setValidation(undefined); setPickingCandidate(undefined); setUseCustom(false); }}>Restaurar configuración inicial de refugios</Button>{pickingCandidate !== undefined && <Button variant="ghost" onClick={() => setPickingCandidate(undefined)}>Cancelar selección en mapa</Button>}</div>
      {currentValidation && <p role={currentValidation.valid ? 'status' : 'alert'} className={currentValidation.valid ? 'flood-validation-success' : 'flood-validation-error'}>{currentValidation.valid ? 'Los cuatro candidatos son válidos y accesibles en el grafo seleccionado.' : 'Corrige los candidatos rechazados antes de iniciar o comparar.'}</p>}
    </Card>
    <Card className="flood-agents-card"><div className="flood-card-heading"><div><span className="flood-kicker"><Activity size={16} /> ESTADO OBSERVABLE</span><h2>Agentes y refugios</h2><p>Los agentes sin destino admisible permanecen vivos y pueden recuperar una ruta.</p></div></div>
      <div className="flood-shelter-status">{backend.shelters.map(shelter => { const condition = backend.scenario.shelter_conditions.find(item => item.shelter_id === shelter.id); return <div key={shelter.id}><span className={`flood-status-dot flood-status-${condition?.state ?? 'available'}`} /><div><strong>{shelter.id}</strong><span>{shelterLabels[condition?.state ?? 'available']} · riesgo {(condition?.risk_score ?? 0).toFixed(2)}</span></div><p>{shelter.occupancy} / {shelter.capacity}<small>{shelter.reserved} reservadas · {shelter.available} libres</small></p></div>; })}</div>
      <label className="flood-search-label">Buscar agente de inundación<input type="search" placeholder="S-0001" value={agentSearch} onChange={event => setAgentSearch(event.target.value)} /></label><div className="flood-agent-list"><table><thead><tr><th>Agente</th><th>Estado</th><th>Refugio / ruta</th></tr></thead><tbody>{agents.map(agent => <tr key={agent.id}><td>{agent.id}</td><td><span className={`flood-agent-badge flood-agent-badge-${agent.state}`}>{agentLabels[agent.state]}</span></td><td><button className="text-link" type="button" aria-label={`Ver ruta de inundación de ${agent.id}`} onClick={() => setSelectedAgentId(agent.id)}>{agent.target_shelter_id || 'Sin asignación'} →</button></td></tr>)}</tbody></table>{!agents.length && <p className="muted">No hay agentes para esta búsqueda.</p>}</div>
      {selectedAgent && <div className="flood-agent-detail" aria-label={`Detalle de inundación de ${selectedAgent.id}`}><h3>{selectedAgent.id}</h3><p>{agentLabels[selectedAgent.state]} · {behaviorLabels[selectedAgent.behavior as LabRunConfig['evacuation_behavior']] ?? selectedAgent.behavior}</p><p>Nodo actual: {selectedAgent.current_node}</p><p>Refugio asignado: {selectedAgent.target_shelter_id || 'Sin asignación'}</p><p>Ruta publicada: {selectedAgent.planned_route.join(' → ') || 'Sin ruta admisible'}</p>{selectedAgent.evacuation_time !== undefined && <p>Tiempo hasta evacuación: {selectedAgent.evacuation_time.toFixed(1)} unidades simuladas</p>}</div>}
    </Card></div>
    <Card className="flood-timeline-card"><Timeline timeline={backend.timeline} current={backend.scenario.simulation_step} duration={backend.config.simulation_duration} /></Card>
    <Card className="flood-comparison-card"><div className="flood-card-heading"><div><span className="flood-kicker"><FlaskConical size={16} /> COMPARACIÓN CONTROLADA</span><h2>Cuatro originales frente a cuatro alternativos</h2><p>Misma semilla, lluvia, agentes, duración y puntos de origen. Sólo cambian los refugios.</p></div><Button disabled={!canConfigureRun || !configValid || !customValid} onClick={() => compare.mutate()}>{compare.isPending || comparisonRunning ? 'Comparando…' : 'Comparar A/B'}</Button></div>
      {!customValid && <p className="muted">Edita y valida cuatro candidatos para habilitar la comparación. La capacidad también forma parte de la estrategia de refugios.</p>}
      {backend.comparison ? <ComparisonPanel comparison={backend.comparison} /> : <div className="flood-comparison-empty"><FlaskConical size={28} /><p>La comparación ejecuta ambos escenarios completos en el motor Go.</p><span>Sin resultados inventados ni simulación paralela en el navegador.</span></div>}
    </Card>
    <Card className="flood-provenance-card"><h2>Origen de los datos y límites</h2><dl><div><dt>Geografía</dt><dd>{backend.scenario.data_provenance.graph_source}</dd></div><div><dt>Modelo</dt><dd>{backend.scenario.data_provenance.model}</dd></div><div><dt>Elevación</dt><dd>{backend.scenario.data_provenance.elevation_source === 'unavailable' ? 'Sin datos verificados de elevación; no se infiere seguridad por altura.' : backend.scenario.data_provenance.elevation_source}</dd></div><div><dt>Apariciones</dt><dd>{backend.origins.length} orígenes geográficos conservados. Ajuste máximo registrado: {Math.max(0, ...backend.origins.map(origin => origin.snap_distance_m)).toFixed(1)} m.</dd></div></dl><p>{catalog.disclaimer}</p></Card>
  </>;
}

function CandidateEditor({ index, candidate, validation, picking, onChange, onPick, onRestore }: { index: number; candidate?: CandidateDraft; validation?: LabCandidateValidation['candidates'][number]; picking: boolean; onChange: (candidate: CandidateDraft | undefined) => void; onPick: () => void; onRestore: () => void }) {
  return <fieldset className={`flood-candidate-card ${picking ? 'flood-candidate-picking' : ''}`}><legend><span>{index + 1}</span>Candidato {index + 1}</legend>{candidate ? <>
    <label>Nombre del candidato {index + 1}<input value={candidate.label} maxLength={100} placeholder="Universidad / instalación deportiva / terminal" onChange={event => onChange({ ...candidate, label: event.target.value })} /></label><div className="flood-candidate-coordinates"><label>Latitud del candidato {index + 1}<input type="text" inputMode="decimal" value={candidate.lat} onChange={event => onChange({ ...candidate, lat: event.target.value })} /></label><label>Longitud del candidato {index + 1}<input type="text" inputMode="decimal" value={candidate.lng} onChange={event => onChange({ ...candidate, lng: event.target.value })} /></label></div><label>Capacidad del candidato {index + 1}<input type="number" min="1" max="200" step="1" value={candidate.capacity} onChange={event => onChange({ ...candidate, capacity: event.target.value })} /></label><div className="flood-candidate-actions"><Button variant="secondary" onClick={onPick} aria-label={`Elegir candidato ${index + 1} en el mapa`}>{picking ? 'Esperando clic…' : 'Elegir en mapa'}</Button><Button variant="ghost" onClick={() => onChange(undefined)} aria-label={`Eliminar candidato ${index + 1}`}>Eliminar</Button></div>
    {validation && <p className={validation.valid ? 'flood-validation-success' : 'flood-validation-error'}>{validation.message}{validation.node_id && <><br />Nodo: {validation.node_id} · ajuste {validation.snap_distance_m.toFixed(1)} m</>}</p>}
    {!readCandidate(candidate) && <p className="flood-validation-error">Completa el nombre, coordenadas válidas y capacidad entre 1 y 200 antes de validar.</p>}
  </> : <div className="flood-candidate-empty"><p>Este candidato fue retirado. Necesitas cuatro ubicaciones válidas.</p><Button variant="secondary" onClick={onPick} aria-label={`Reemplazar candidato ${index + 1} en el mapa`}>Reemplazar en mapa</Button><Button variant="ghost" onClick={onRestore}>Restaurar candidato {index + 1}</Button></div>}</fieldset>;
}

function MetricsPanel({ metrics, latency, step, duration }: { metrics: EvacuationMetrics; latency: number; step: number; duration: number }) {
  const percentage = metrics.total_agents ? metrics.evacuated_agents / metrics.total_agents * 100 : 0;
  return <div className="flood-metrics" aria-label="Métricas de inundación"><Card><span>Evacuados</span><strong>{percentage.toFixed(1)}<small>%</small></strong><p>{metrics.evacuated_agents} / {metrics.total_agents} agentes</p></Card><Card><span>Aislados / esperando</span><strong>{metrics.isolated_agents}<small> / {metrics.waiting_agents}</small></strong><p>Sin resultado de mortalidad</p></Card><Card><span>Calles bloqueadas</span><strong>{metrics.blocked_edges}<small> / {metrics.caution_edges}</small></strong><p>Bloqueadas / precaución actuales</p></Card><Card><span>Tiempo medio</span><strong>{metrics.average_evacuation_time.toFixed(1)}</strong><p>Unidades hasta evacuación</p></Card><Card><span>Replanificaciones</span><strong>{metrics.reroute_count}</strong><p>{metrics.shelters_at_capacity} refugios a capacidad</p></Card><Card><span>Latencia del paso</span><strong>{latency.toFixed(1)}<small> ms</small></strong><p>Paso {step} · duración {duration}</p></Card></div>;
}

function Timeline({ timeline, current, duration }: { timeline: LabTimelineEntry[]; current: number; duration: number }) {
  const [inspected, setInspected] = useState<number>();
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
