import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Graph, SimulationCapabilities, SimulationCreateRequest, SimulationState, WorldSnapshot } from '@corodev/contracts';
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, StatusIndicator } from '../components/ui';
import { useGraph, useIncidents, useSusceptibilityReference } from '../services/queries';
import { api } from '../services/api';
import { isTerminal, useSimulationCapabilities, useSimulationSession } from '../services/simulation';
import { routeWarnings, WorldMap } from './WorldMap';
import { FloodMap } from './flood/FloodMap';
import { ReferencePanel } from './flood/ReferencePanel';
import { incidentSourceLabels, incidentStatusLabels, incidentTypeLabels } from './flood/incidentPresentation';
import './flood/flood.css';

const statusLabels = { CREATED: 'Preparando', RUNNING: 'En ejecución', PAUSED: 'Pausada', COMPLETED: 'Finalizada', CANCELLED: 'Cancelada', FAILED: 'Error del motor' };

export function Escape() {
  const capabilities = useSimulationCapabilities();
  return <div className="page escape-page"><PageHeader eyebrow="TRACK A · SISTEMA MANTA" title="Escape de Manta Zombie" description="Explora la red vial de Manta y configura tu propia simulación de evacuación." action={<StatusIndicator status={capabilities.isError ? 'offline' : capabilities.isPending ? 'checking' : 'online'} />} />
    {capabilities.isError && capabilities.data && <p className="session-notice" role="status">No pudimos actualizar los escenarios y límites. Conservamos tu configuración y el último estado de tu simulación.</p>}
    {capabilities.data ? <SimulationWorkspace capabilities={capabilities.data} /> : capabilities.isPending ? <LoadingState label="Consultando escenarios y límites…" /> : <ErrorState error={capabilities.error!} onRetry={() => void capabilities.refetch()} />}
  </div>;
}

function SimulationWorkspace({ capabilities }: { capabilities: SimulationCapabilities }) {
  const session = useSimulationSession();
  const [scenario, setScenario] = useState(capabilities.defaults.scenario);
  const [profile, setProfile] = useState(capabilities.defaults.graph_profile);
  const [seed, setSeed] = useState(String(capabilities.defaults.seed));
  const [survivors, setSurvivors] = useState(String(capabilities.defaults.survivors));
  const [round, setRound] = useState(capabilities.defaults.round);
  const [ticks, setTicks] = useState(String(capabilities.defaults.max_ticks));
  const [interval, setInterval] = useState(String(capabilities.defaults.tick_interval_ms));
  const [rain, setRain] = useState('0.8');
  const [refuges, setRefuges] = useState<string[]>([]);
  const state = session.state.data;
  const selectedScenario = state?.scenario ?? scenario;
  const selectedProfile = state?.graph_profile ?? profile;
  const flood = selectedScenario === 'urban_flood';
  const graph = useGraph(undefined, selectedProfile === 'BASE' ? 'competition' : 'full');
  const locked = Boolean(session.id) || session.busy;
  const selectedCapability = capabilities.scenarios.find(item => item.id === scenario);
  const graphCapability = capabilities.graph_profiles.find(item => item.id === profile);
  const validInteger = (value: string, min: number, max: number) => value.trim() !== '' && Number.isSafeInteger(Number(value)) && Number(value) >= min && Number(value) <= max;
  const valid = selectedCapability?.available && graphCapability?.available && graph.isSuccess
    && validInteger(seed, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
    && validInteger(survivors, 1, capabilities.limits.max_survivors)
    && validInteger(ticks, 1, capabilities.limits.max_ticks)
    && validInteger(interval, capabilities.limits.min_tick_interval_ms, capabilities.limits.max_tick_interval_ms)
    && (scenario !== 'urban_flood' || rain.trim() !== '' && Number.isFinite(Number(rain)) && Number(rain) >= 0 && Number(rain) <= 1)
    && refuges.every(id => graph.data?.shelters.some(shelter => shelter.id === id));
  const connected = !session.state.isError && !session.state.isPending;
  return <>
    {session.notice && <p className="session-notice" role="status">{session.notice}</p>}
    {!session.id && <Card className="escape-map-card simulation-control" aria-label="Configuración de simulación">
      <div className="section-heading"><div><h2>Configura tu simulación</h2><p>Exploración. El motor comienza al pulsar Iniciar simulación.</p></div><Badge tone="cyan">Sin ejecución activa</Badge></div>
      <form onSubmit={event => {
        event.preventDefault();
        if (!valid || locked) return;
        const input: SimulationCreateRequest = { scenario, graph_profile: profile, seed: Number(seed), max_ticks: Number(ticks), tick_interval_ms: Number(interval), config: { survivors: Number(survivors), round, refuge_ids: refuges, ...(scenario === 'urban_flood' ? { rainfall_intensity: Number(rain) } : {}) } };
        void session.start(input);
      }}>
        <fieldset className="session-config-grid" disabled={locked}>
          <legend className="sr-only">Parámetros de la simulación</legend>
          <label>Amenaza<select value={scenario} onChange={event => setScenario(event.target.value as typeof scenario)}>{capabilities.scenarios.map(item => <option key={item.id} value={item.id} disabled={!item.available}>{item.name}{item.available ? '' : ' — No disponible'}</option>)}</select></label>
          <label>Profundidad del grafo<select value={profile} onChange={event => { setProfile(event.target.value as typeof profile); setRefuges([]); }}>{capabilities.graph_profiles.map(item => <option key={item.id} value={item.id} disabled={!item.available}>{item.id === 'BASE' ? 'Básica' : 'Avanzada experimental'}: {item.nodes.toLocaleString('es-EC')} intersecciones{item.available ? '' : ' — No disponible'}</option>)}</select></label>
          <label>Semilla<input type="number" required step="1" min={-Number.MAX_SAFE_INTEGER} max={Number.MAX_SAFE_INTEGER} value={seed} onChange={event => setSeed(event.target.value)} /></label>
          <label>Agentes<input type="number" required step="1" min="1" max={capabilities.limits.max_survivors} value={survivors} onChange={event => setSurvivors(event.target.value)} /></label>
          <label>Ronda<select value={round} onChange={event => { const next = capabilities.rounds.find(item => item.id === event.target.value); if (next) { setRound(next.id); setSurvivors(String(Math.min(next.survivors, capabilities.limits.max_survivors))); } }}>{capabilities.rounds.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Turnos máximos<input type="number" required step="1" min="1" max={capabilities.limits.max_ticks} value={ticks} onChange={event => setTicks(event.target.value)} /></label>
          <label>Intervalo entre turnos (ms)<input type="number" required step="1" min={capabilities.limits.min_tick_interval_ms} max={capabilities.limits.max_tick_interval_ms} value={interval} onChange={event => setInterval(event.target.value)} /></label>
          {scenario === 'urban_flood' && <label>Intensidad de lluvia sintética<input type="number" required min="0" max="1" step="0.05" value={rain} onChange={event => setRain(event.target.value)} /></label>}
        </fieldset>
        <fieldset className="session-refuges" disabled={locked}><legend>Refugios de la simulación</legend><p>Sin selección se utilizan todos los refugios predeterminados. Son puntos ficticios del escenario.</p>{graph.data?.shelters.map(shelter => <label key={shelter.id}><input type="checkbox" checked={refuges.includes(shelter.id)} onChange={event => setRefuges(previous => event.target.checked ? [...previous, shelter.id] : previous.filter(id => id !== shelter.id))} />{shelter.id} · capacidad {shelter.capacity}</label>)}</fieldset>
        <p className="session-summary">{selectedCapability?.name} · {graphCapability?.name} · {survivors || '—'} agentes · semilla {seed || '—'} · {ticks || '—'} turnos · {refuges.length ? refuges.join(', ') : 'refugios predeterminados'}</p>
        {capabilities.graph_profiles.filter(item => !item.available).map(item => <p className="muted" key={item.id}>{item.name}: {item.disabled_reason || 'No disponible en esta instancia.'}</p>)}
        <Button type="submit" disabled={!valid || locked}>{session.busy ? 'Iniciando…' : 'Iniciar simulación'}</Button>
      </form>
    </Card>}
    {session.error && <><p role="status">{session.error instanceof Error && 'status' in session.error && session.error.status === 503 ? 'Capacidad de ejecución agotada. Conservamos tu configuración; vuelve a intentar más tarde.' : 'La operación no se completó. Puedes volver a intentarlo.'}</p><ErrorState error={session.error} /></>}
    {session.id && session.state.isPending && <LoadingState label="Recuperando tu simulación…" />}
    {session.state.isError && <><p className="session-notice" role="status">Sin conexión. Conservamos el último estado y reintentamos con espera progresiva. No se creará otra simulación.</p><ErrorState error={session.state.error} onRetry={() => void session.state.refetch()} /></>}
    {state && <Card className="escape-map-card simulation-control" aria-label="Tu simulación">
      <div className="section-heading"><div><h2>Tu simulación</h2><p>{state.scenario === 'urban_flood' ? 'Inundación urbana sintética' : 'Brote zombie'} · {state.graph_profile} · semilla {state.seed}</p></div><Badge tone={state.status === 'RUNNING' ? 'success' : state.status === 'PAUSED' ? 'warning' : 'neutral'}>{statusLabels[state.status]}</Badge></div>
      <p>Turno {state.tick}/{state.max_ticks} · {elapsed(state)} transcurridos · versión {state.state_version}</p><progress className="session-progress" aria-label="Progreso de simulación" value={state.tick} max={state.max_ticks} />
      <p className="muted">Grafo {state.graph_version} · {state.config.survivors} agentes · refugios {state.config.refuge_ids.join(', ')} · ejecución {state.simulation_id}</p>
      <div className="flood-actions">
        <Button variant="secondary" disabled={session.busy || !connected || state.status !== 'RUNNING'} onClick={() => void session.control('pause')}>Pausar</Button>
        <Button variant="secondary" disabled={session.busy || !connected || state.status !== 'PAUSED'} onClick={() => void session.control('resume')}>Reanudar</Button>
        <Button variant="secondary" disabled={session.busy || !connected || !['RUNNING', 'PAUSED'].includes(state.status)} onClick={() => void session.control('cancel')}>Cancelar</Button>
        <Button disabled={session.busy || !connected || !isTerminal(state.status)} onClick={() => void session.restart()}>Reiniciar con la misma configuración</Button>
        {isTerminal(state.status) && <Button variant="secondary" disabled={session.busy} onClick={() => session.forget()}>Nueva configuración</Button>}
      </div>
    </Card>}
    {state && <LiveMetrics state={state} />}
    {session.results.data && <Card className="escape-map-card session-results" aria-label="Resultados de simulación"><h2>Resultados de simulación</h2><p>{statusLabels[session.results.data.status]} · {state?.tick}/{state?.max_ticks} turnos · {state ? elapsed(state) : ''}</p><dl><div><dt>Agentes iniciales</dt><dd>{session.results.data.results.initial_survivors}</dd></div><div><dt>Evacuados</dt><dd>{session.results.data.results.evacuated}</dd></div>{!flood && <><div><dt>Mordidos</dt><dd>{session.results.data.results.bitten}</dd></div><div><dt>Tasa de supervivencia</dt><dd>{(session.results.data.results.survival_rate * 100).toFixed(1)}%</dd></div></>}<div><dt>Refugios utilizados</dt><dd>{session.results.data.results.refuges_used}</dd></div></dl></Card>}
    {session.results.isError && <ErrorState error={session.results.error} onRetry={() => void session.results.refetch()} />}
    <Card className="escape-map-card"><div className="section-heading"><div><h2>{session.id ? 'Estado observable de tu simulación' : 'Explora Manta'}</h2><p>{session.id ? 'Datos calculados por Go · consulta cada 2 segundos mientras está activa' : 'Geografía estática · navegar por el mapa no inicia el motor'}</p></div><Badge tone={flood ? 'cyan' : 'purple'}>{flood ? 'SIMULACIÓN — DATOS SINTÉTICOS' : session.id ? 'Sesión independiente' : 'Solo geografía'}</Badge></div>
      {graph.isPending ? <LoadingState label="Cargando el grafo…" /> : graph.isError ? <ErrorState error={graph.error} onRetry={() => void graph.refetch()} /> : state && state.graph_version !== graph.data.version ? <p role="alert">La versión del grafo no coincide con tu simulación. <Button variant="secondary" onClick={() => void graph.refetch()}>Actualizar grafo</Button></p> : <MapDetails key={session.id ?? `${selectedScenario}:${selectedProfile}`} graph={graph.data} state={state} flood={flood} />}
    </Card>
  </>;
}

function elapsed(state: SimulationState) {
  const seconds = Math.max(0, Math.floor((Date.parse(state.ended_at ?? state.updated_at) - Date.parse(state.started_at)) / 1000));
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}
function LiveMetrics({ state }: { state: SimulationState }) {
  const metrics = state.scenario_state?.evacuation_metrics;
  return <div className="summary-grid">
    {metrics ? <><Card className="escape-metric"><span>Evacuados / aislados / esperando</span><strong>{metrics.evacuated_agents} / {metrics.isolated_agents} / {metrics.waiting_agents}</strong></Card><Card className="escape-metric"><span>Vías bloqueadas / precaución</span><strong>{metrics.blocked_edges} / {metrics.caution_edges}</strong><small>{metrics.reroute_count} rutas recalculadas</small></Card><Card className="escape-metric"><span>Tiempo medio de evacuación</span><strong>{metrics.average_evacuation_time.toFixed(1)}<small> unidades del modelo</small></strong><small>Duración simulada {metrics.simulation_total_duration.toFixed(1)}</small></Card></> : <><Card className="escape-metric"><span>Evacuados / mordidos / activos</span><strong>{state.snapshot.metrics.evacuated} / {state.snapshot.metrics.bitten} / {state.snapshot.metrics.active}</strong><small>{state.snapshot.metrics.evacuated + state.snapshot.metrics.active} vivos en total</small></Card><Card className="escape-metric"><span>Latencia HTTP p95</span><strong>{state.snapshot.metrics.http_p95_ms.toFixed(2)}<small> ms</small></strong></Card></>}
  </div>;
}

function MapDetails({ graph, state, flood }: { graph: Graph; state?: SimulationState; flood: boolean }) {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [showReference, setShowReference] = useState(false);
  const [selectedIncident, setSelectedIncident] = useState('');
  const snapshot = state?.snapshot;
  const matching = snapshot?.survivors.filter(s => s.id.toLowerCase().includes(search.toLowerCase())) ?? [];
  const selected = matching.find(s => s.id.toLowerCase() === search.trim().toLowerCase()) ?? matching.find(s => s.id === selectedId) ?? (matching.length === 1 ? matching[0] : undefined);
  const position = graph.nodes.find(node => node.id === selected?.current_node);
  const warnings = selected && snapshot ? routeWarnings(graph, snapshot, selected) : [];
  const shelters = snapshot?.shelters ?? graph.shelters;
  const incidents = useIncidents({}, flood);
  const reference = useQuery({ queryKey: ['reference', 'status'], queryFn: ({ signal }) => api.referenceStatus(signal), enabled: flood, retry: false, staleTime: 30_000 });
  const polygons = useSusceptibilityReference(reference.data?.dataset_version, flood && showReference);
  return <>
    {flood ? <><FloodMap graph={graph} scenario={state?.scenario_state} shelters={shelters} candidates={[]} selectedAgentId={selectedId} onSelectAgent={setSelectedId} onPickPosition={() => undefined} incidents={incidents.data?.incidents} selectedIncidentId={selectedIncident} onSelectIncident={setSelectedIncident} reference={polygons.data} showReference={showReference} onShowReference={setShowReference} />
      <p className="muted">Lluvia, exposición, agentes y refugios: sintéticos. Las declaraciones ciudadanas y la referencia territorial se muestran como capas independientes y no modifican esta ejecución.</p>
      {state?.scenario_state && <p className="muted">{state.scenario_state.data_provenance.disclaimer} Modelo: {state.scenario_state.data_provenance.model}.</p>}
      <details><summary>Reportes ciudadanos y otras observaciones</summary>{incidents.isError ? <ErrorState error={incidents.error} onRetry={() => void incidents.refetch()} /> : <ul>{incidents.data?.incidents.map(incident => <li key={incident.incident_id}>{incidentTypeLabels[incident.incident_type]} · {incidentSourceLabels[incident.source_type]} · {incidentStatusLabels[incident.verification_status]} · {incident.description}</li>)}</ul>}</details>
      <ReferencePanel status={reference.data} collection={polygons.data} loading={reference.isPending || polygons.isFetching} error={reference.error ?? polygons.error} retry={() => { void reference.refetch(); if (showReference) void polygons.refetch(); }} csrf="" />
    </> : <WorldMap graph={graph} world={snapshot} selected={selected} />}
    <div className="escape-details"><Card className="escape-map-card"><h2>Refugios ficticios</h2><p className="muted">Puntos del escenario; no son instalaciones oficiales de emergencia. La envolvente urbana no implica cobertura vial completa.</p><ul className="escape-shelters">{shelters.map(shelter => <li key={shelter.id}><strong>{shelter.id}</strong><span>{shelter.occupancy} / {shelter.capacity} ocupadas<br />{shelter.reserved ?? 0} reservadas · {shelter.available ?? Math.max(0, shelter.capacity - shelter.occupancy - (shelter.reserved ?? 0))} libres</span></li>)}</ul></Card>
      {snapshot && !flood && <Survivors world={snapshot} search={search} onSearch={setSearch} matching={matching} onSelect={setSelectedId} selected={selected} position={position} graph={graph} warnings={warnings} />}
      {state?.scenario_state && <Card className="escape-map-card"><h2>Agentes de inundación</h2><div className="escape-table"><table><thead><tr><th>ID</th><th>Estado</th><th>Refugio</th><th>Ruta</th></tr></thead><tbody>{state.scenario_state.agents.map(agent => <tr key={agent.id}><td>{agent.id}</td><td>{({ moving: 'En movimiento', waiting: 'Esperando', isolated: 'Aislado', evacuated: 'Evacuado' })[agent.state]}</td><td>{agent.target_shelter_id || 'Sin asignación'}</td><td><button className="text-link" onClick={() => setSelectedId(agent.id)}>Ver ruta de {agent.id}</button></td></tr>)}</tbody></table></div></Card>}
    </div>
  </>;
}

function Survivors({ search, onSearch, matching, onSelect, selected, position, graph, warnings }: { world: WorldSnapshot; search: string; onSearch: (value: string) => void; matching: WorldSnapshot['survivors']; onSelect: (value: string) => void; selected?: WorldSnapshot['survivors'][number]; position?: Graph['nodes'][number]; graph: Graph; warnings: string[] }) {
  return <Card className="escape-map-card"><h2>Sobrevivientes</h2><label className="escape-search">Buscar por ID<input type="search" value={search} onChange={event => onSearch(event.target.value)} placeholder="S-0001" /></label>
    {matching.length === 0 ? <EmptyState title="Sin sobrevivientes para esta búsqueda" description="Prueba con otro ID." /> : <div className="escape-table"><table><thead><tr><th>ID</th><th>Nodo</th><th>Estado</th><th>Refugio</th><th>Ruta</th></tr></thead><tbody>{matching.map(survivor => <tr key={survivor.id}><td>{survivor.id}</td><td>{survivor.current_node}</td><td>{({ active: 'Activo', bitten: 'Mordido', evacuated: 'Evacuado' })[survivor.status]}</td><td>{survivor.target_shelter_id || 'Sin asignación'}</td><td><button type="button" className="text-link" onClick={() => onSelect(survivor.id)} aria-label={`Ver ruta de ${survivor.id}`}>Ver ruta</button></td></tr>)}</tbody></table></div>}
    {selected ? <div className="escape-survivor-detail" aria-label={`Detalle de ${selected.id}`}><h3>{selected.id}</h3><p>Posición: {position ? `${position.lat.toFixed(6)}, ${position.lng.toFixed(6)}` : selected.current_node}</p><p>Refugio asignado: {selected.target_shelter_id || 'Sin asignación'}</p><p>Siguiente movimiento: {selected.planned_route.find(node => node !== selected.current_node) ?? selected.current_node}</p>{selected.spawn_zone_id && <p>Zona de origen: {graph.spawn_zones?.find(zone => zone.id === selected.spawn_zone_id)?.name ?? selected.spawn_zone_id}</p>}<p>Ruta publicada: {selected.planned_route.length ? selected.planned_route.join(' → ') : 'Sin ruta publicada'}</p>{warnings.map(warning => <p key={warning} role="alert" className="escape-danger">{warning}</p>)}</div> : <p className="muted">Selecciona un sobreviviente para ver su posición y ruta.</p>}
  </Card>;
}
