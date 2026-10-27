import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pause, Play, RotateCcw, Square } from 'lucide-react';
import type { Graph, SimulationCapabilities, SimulationCreateRequest, SimulationState } from '@corodev/contracts';
import { Button, ErrorState, LoadingState } from '../components/ui';
import { useGraph, useIncidents, useSusceptibilityReference } from '../services/queries';
import { api } from '../services/api';
import { isTerminal, useSimulationCapabilities, useSimulationSession } from '../services/simulation';
import { routeWarnings, WorldMap } from './WorldMap';
import { FloodMap } from './flood/FloodMap';
import { ReferencePanel } from './flood/ReferencePanel';
import { incidentSourceLabels, incidentStatusLabels, incidentTypeLabels } from './flood/incidentPresentation';
import { sessionLifecycle } from './visualization/observation';
import { ShelterEditor, ShelterSelectionNotice, useShelterDraft } from './ShelterEditor';
import { AgentShelterPanel } from './maps/AgentShelterPanel';
import { MetricsOverlay, SimulationHUD } from './SimulationHUD';
import './flood/flood.css';

const statusLabels = { CREATED: 'Preparando', RUNNING: 'En ejecución', PAUSED: 'Pausada', COMPLETED: 'Finalizada', CANCELLED: 'Cancelada', FAILED: 'Error del motor' };

export function Escape() {
  const capabilities = useSimulationCapabilities();
  return <div className="page escape-page map-first-page"><header className="scenario-heading"><h1>Escape de Manta Zombie</h1><span>Simulación experimental</span></header>
    {capabilities.isError && capabilities.data && <p className="workspace-notice" role="status">No pudimos actualizar los escenarios y límites. Conservamos tu configuración y el último estado de tu simulación.</p>}
    {capabilities.data ? <SimulationWorkspace capabilities={capabilities.data} /> : capabilities.isPending ? <LoadingState label="Consultando escenarios y límites…" /> : <ErrorState error={capabilities.error!} onRetry={() => void capabilities.refetch()} />}
  </div>;
}

function SimulationWorkspace({ capabilities }: { capabilities: SimulationCapabilities }) {
  const session = useSimulationSession();
  const scenario = 'zombie_outbreak' as const;
  const [profile, setProfile] = useState<SimulationCreateRequest['graph_profile']>('BASE');
  const [seed, setSeed] = useState(String(capabilities.defaults.seed));
  const [survivors, setSurvivors] = useState(String(capabilities.defaults.survivors));
  const [round, setRound] = useState(capabilities.defaults.round);
  const [ticks, setTicks] = useState(String(capabilities.defaults.max_ticks));
  const [refuges, setRefuges] = useState<string[]>([]);
  const state = session.state.data;
  const selectedProfile = state?.graph_profile ?? profile;
  const flood = state?.scenario === 'urban_flood';
  const graph = useGraph(undefined, selectedProfile === 'BASE' ? 'competition' : 'full');
  const shelterDraft = useShelterDraft(graph.data);
  useEffect(() => { setRefuges([]); }, [graph.data?.version]);
  const locked = Boolean(session.id) || session.busy;
  const selectedCapability = capabilities.scenarios.find(item => item.id === scenario);
  const graphCapability = capabilities.graph_profiles.find(item => item.id === profile);
  const integer = (value: string, min: number, max: number) => value.trim() !== '' && Number.isSafeInteger(Number(value)) && Number(value) >= min && Number(value) <= max;
  const valid = selectedCapability?.available && graphCapability?.available && graph.isSuccess
    && integer(seed, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
    && integer(survivors, 1, capabilities.limits.max_survivors) && integer(ticks, 1, capabilities.limits.max_ticks)
    && 2000 >= capabilities.limits.min_tick_interval_ms && 2000 <= capabilities.limits.max_tick_interval_ms && shelterDraft.valid && !shelterDraft.picking
    && refuges.every(id => graph.data?.shelters.some(shelter => shelter.id === id));
  const connected = !session.state.isError && !session.state.isPending;
  const configuration = !session.id && <form className="workspace-config" aria-label="Configuración de simulación" onSubmit={event => {
    event.preventDefault(); if (!valid || locked) return;
    void session.start({ scenario, graph_profile: profile, seed: Number(seed), max_ticks: Number(ticks), tick_interval_ms: 2000, config: { survivors: Number(survivors), round, refuge_ids: refuges, ...(shelterDraft.custom ? { custom_shelters: shelterDraft.custom } : {}) } });
  }}>
    <fieldset disabled={locked}><legend className="sr-only">Preparar brote</legend>
      <label className="config-graph">Profundidad del grafo<select value={profile} onChange={event => { setProfile(event.target.value as typeof profile); setRefuges([]); shelterDraft.reset(); }}>{capabilities.graph_profiles.map(item => <option key={item.id} value={item.id} disabled={!item.available}>{item.id === 'BASE' ? 'Básica' : 'Avanzada experimental'}: {item.nodes.toLocaleString('es-EC')} intersecciones{item.available ? '' : ' — No disponible'}</option>)}</select></label>
      <label className="config-agents">Agentes<input type="number" required step="1" min="1" max={capabilities.limits.max_survivors} value={survivors} onChange={event => setSurvivors(event.target.value)} /></label>
      <label className="config-round">Ronda<select value={round} onChange={event => { const next = capabilities.rounds.find(item => item.id === event.target.value); if (next) { setRound(next.id); setSurvivors(String(Math.min(next.survivors, capabilities.limits.max_survivors))); } }}>{capabilities.rounds.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    </fieldset>
    <details className="workspace-advanced"><summary>Configuración avanzada</summary><div className="config-popover"><fieldset disabled={locked}><legend className="sr-only">Reproducción determinista</legend>
      <label>Semilla<input type="number" required step="1" min={-Number.MAX_SAFE_INTEGER} max={Number.MAX_SAFE_INTEGER} value={seed} onChange={event => setSeed(event.target.value)} /></label>
      <label>Turnos máximos<input type="number" required step="1" min="1" max={capabilities.limits.max_ticks} value={ticks} onChange={event => setTicks(event.target.value)} /></label>
    </fieldset><p>Un turno cada 2 segundos. La semilla conserva la reproducción determinista.</p>{capabilities.graph_profiles.filter(item => !item.available).map(item => <p key={item.id}>{item.name}: {item.disabled_reason || 'No disponible en esta instancia.'}</p>)}</div></details>
    <Button type="submit" disabled={!valid || locked}><Play size={14} />{session.busy ? 'Iniciando…' : 'Iniciar simulación'}</Button><span className="config-status">Sin ejecución activa</span>
  </form>;
  const hud = <>
    {configuration}
    {session.id && <SimulationHUD label={state ? 'Tu simulación' : 'Preparación de simulación'} status={state ? statusLabels[state.status] : session.id ? 'Recuperando ejecución' : 'Sin ejecución activa'} tick={state?.tick} maxTicks={state?.max_ticks} elapsed={state ? elapsed(state) : undefined}>
      {state?.status === 'RUNNING' && <Button variant="secondary" disabled={session.busy || !connected} onClick={() => void session.control('pause')}><Pause size={14} />Pausar</Button>}
      {state?.status === 'PAUSED' && <Button variant="secondary" disabled={session.busy || !connected} onClick={() => void session.control('resume')}><Play size={14} />Continuar</Button>}
      {state && ['RUNNING', 'PAUSED'].includes(state.status) && <Button variant="secondary" disabled={session.busy || !connected} onClick={() => void session.control('cancel')}><Square size={14} />Cancelar</Button>}
      {state && isTerminal(state.status) && <><Button title="Reinicia con la misma configuración y semilla" disabled={session.busy || !connected} onClick={() => void session.restart()}><RotateCcw size={14} />Reiniciar</Button><Button variant="secondary" disabled={session.busy} onClick={() => session.forget()}>Nueva configuración</Button></>}
    </SimulationHUD>}
    {!session.id && <ShelterSelectionNotice draft={shelterDraft} disabled={locked} />}
  </>;
  return <>
    {!graph.data ? graph.isPending ? <LoadingState label="Cargando el grafo…" /> : <ErrorState error={graph.error!} onRetry={() => void graph.refetch()} /> : state && state.graph_version !== graph.data.version ? <p role="alert">La versión del grafo no coincide con tu simulación. <Button variant="secondary" onClick={() => void graph.refetch()}>Actualizar grafo</Button></p> : <MapDetails graph={graph.data} state={state} flood={flood} connected={connected} hud={hud} shelterDraft={!session.id ? shelterDraft : undefined} shelterTools={!session.id ? <ShelterEditor draft={shelterDraft} disabled={locked} originalIds={graph.data.shelters.map(item => item.id)} selectedIds={refuges} onSelectedIds={setRefuges} /> : undefined} />}
    {graph.isError && graph.data && <ErrorState error={graph.error} onRetry={() => void graph.refetch()} />}
    {session.notice && <p className="workspace-notice" role="status">{session.notice}</p>}
    {session.error && <><p role="status">{session.error instanceof Error && 'status' in session.error && session.error.status === 503 ? 'Capacidad de ejecución agotada. Conservamos tu configuración; vuelve a intentar más tarde.' : 'La operación no se completó. Puedes volver a intentarlo.'}</p><ErrorState error={session.error} /></>}
    {session.state.isError && <><p className="workspace-notice" role="status">Sin conexión. Conservamos el último estado y reintentamos con espera progresiva. No se creará otra simulación.</p><ErrorState error={session.state.error} onRetry={() => void session.state.refetch()} /></>}

    {session.results.data && <details className="workspace-results" aria-label="Resultados de simulación" open><summary>Resultados de simulación · {statusLabels[session.results.data.status]}</summary><h2>Resultados de simulación</h2><dl><div><dt>Agentes iniciales</dt><dd>{session.results.data.results.initial_survivors}</dd></div><div><dt>Evacuados</dt><dd>{session.results.data.results.evacuated}</dd></div>{!flood && <><div><dt>Mordidos</dt><dd>{session.results.data.results.bitten}</dd></div><div><dt>Tasa de supervivencia</dt><dd>{(session.results.data.results.survival_rate * 100).toFixed(1)}%</dd></div></>}<div><dt>Refugios utilizados</dt><dd>{session.results.data.results.refuges_used}</dd></div></dl></details>}
    {state && <details className="workspace-results"><summary>Configuración e información técnica</summary><p>{state.config.survivors} agentes · semilla {state.seed} · {state.max_ticks} turnos · {state.tick_interval_ms} ms por turno · {state.config.round}</p><p>Grafo {state.graph_version} · ejecución {state.simulation_id} · versión {state.state_version}</p></details>}
    {session.results.isError && <ErrorState error={session.results.error} onRetry={() => void session.results.refetch()} />}
  </>;
}

function elapsed(state: SimulationState) {
  const seconds = Math.max(0, Math.floor((Date.parse(state.ended_at ?? state.updated_at) - Date.parse(state.started_at)) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
function LiveMetrics({ state }: { state: SimulationState }) {
  const metrics = state.scenario_state?.evacuation_metrics;
  return <MetricsOverlay items={metrics ? [
    { label: 'Evacuados / aislados / esperando', value: `${metrics.evacuated_agents} / ${metrics.isolated_agents} / ${metrics.waiting_agents}` },
    { label: 'Vías bloqueadas / precaución', value: `${metrics.blocked_edges} / ${metrics.caution_edges}`, detail: `${metrics.reroute_count} rutas recalculadas` },
    { label: 'Tiempo medio', value: `${metrics.average_evacuation_time.toFixed(1)} u.` },
  ] : [
    { label: 'Evacuados / mordidos / activos', value: `${state.snapshot.metrics.evacuated} / ${state.snapshot.metrics.bitten} / ${state.snapshot.metrics.active}` },
    { label: 'Latencia HTTP p95', value: state.snapshot.metrics.http_p95_ms > 0 ? `${state.snapshot.metrics.http_p95_ms.toFixed(1)} ms` : 'Sin medición' },
  ]} />;
}

function MapDetails({ graph, state, flood, connected, hud, shelterTools, shelterDraft }: { graph: Graph; state?: SimulationState; flood: boolean; connected: boolean; hud: ReactNode; shelterTools?: ReactNode; shelterDraft?: ReturnType<typeof useShelterDraft> }) {
  const lifecycle = useMemo(() => sessionLifecycle(state, connected), [state, connected]);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [selectedShelterId, setSelectedShelterId] = useState('');
  const [showReference, setShowReference] = useState(false);
  const [selectedIncident, setSelectedIncident] = useState('');
  useEffect(() => { setSearch(''); setSelectedId(''); setSelectedShelterId(''); setSelectedIncident(''); }, [state?.simulation_id, graph.version]);
  const snapshot = state?.snapshot;
  const selected = snapshot?.survivors.find(item => item.id === selectedId);
  const warnings = selected && snapshot ? routeWarnings(graph, snapshot, selected) : [];
  const shelters = snapshot?.shelters ?? shelterDraft?.shelters ?? graph.shelters;
  const incidents = useIncidents({}, flood);
  const reference = useQuery({ queryKey: ['reference', 'status'], queryFn: ({ signal }) => api.referenceStatus(signal), enabled: flood, retry: false, staleTime: 30_000 });
  const polygons = useSusceptibilityReference(reference.data?.dataset_version, flood && showReference);
  const panel = <AgentShelterPanel shelters={shelters} agents={flood ? state?.scenario_state?.agents.map(item => ({ id: item.id, state: item.state, shelterId: item.target_shelter_id, routeAvailable: item.planned_route.some(node => node !== item.current_node) })) : snapshot?.survivors.map(item => ({ id: item.id, state: item.status, shelterId: item.target_shelter_id, routeAvailable: item.planned_route.some(node => node !== item.current_node) }))} search={search} onSearch={setSearch} selectedAgentId={selectedId} onSelectAgent={setSelectedId} selectedShelterId={selectedShelterId} onSelectShelter={setSelectedShelterId} editor={shelterTools} selectingPosition={Boolean(shelterDraft?.picking)} />;
  const shared = { hud, panel, metrics: state ? <LiveMetrics state={state} /> : undefined, selectedShelterId, onSelectShelter: setSelectedShelterId };
  return <>
    {flood ? <FloodMap {...shared} referenceAvailable={['cached', 'stale'].includes(reference.data?.availability ?? '')} lifecycle={lifecycle} graph={graph} scenario={state?.scenario_state} shelters={shelters} candidates={[]} selectedAgentId={selectedId} onSelectAgent={setSelectedId} onPickPosition={() => undefined} incidents={incidents.data?.incidents} selectedIncidentId={selectedIncident} onSelectIncident={setSelectedIncident} reference={polygons.data} showReference={showReference} onShowReference={setShowReference} /> : <WorldMap {...shared} graph={graph} world={snapshot} selected={selected} lifecycle={lifecycle} onSelect={setSelectedId} shelters={shelters} pickingPosition={Boolean(shelterDraft?.picking)} onPickPosition={shelterDraft?.select} onCancelPick={shelterDraft?.cancel} previewPosition={shelterDraft?.proposal?.node ?? shelterDraft?.proposal?.point} />}
    {warnings.map(warning => <p key={warning} role="alert" className="workspace-notice">{warning}</p>)}
    {flood && <details className="workspace-results"><summary>Reportes y referencias independientes</summary><p>Las declaraciones ciudadanas y la referencia territorial no modifican esta ejecución.</p>{incidents.isError ? <ErrorState error={incidents.error} onRetry={() => void incidents.refetch()} /> : <ul>{incidents.data?.incidents.map(incident => <li key={incident.incident_id}>{incidentTypeLabels[incident.incident_type]} · {incidentSourceLabels[incident.source_type]} · {incidentStatusLabels[incident.verification_status]} · {incident.description}</li>)}</ul>}<ReferencePanel status={reference.data} collection={polygons.data} loading={reference.isPending || polygons.isFetching} error={reference.error ?? polygons.error} retry={() => { void reference.refetch(); if (showReference) void polygons.refetch(); }} csrf="" /></details>}
  </>;
}
