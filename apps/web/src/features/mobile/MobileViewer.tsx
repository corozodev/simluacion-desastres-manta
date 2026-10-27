import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ghost, Waves } from 'lucide-react';
import { brand } from '@corodev/design-tokens/brand';
import type { GeoPoint, Incident, IncidentCreate, Shelter } from '@corodev/contracts';
import { api } from '../../services/api';
import { config } from '../../lib/config';
import { useNetworkOnline, usePageVisible, usePublishedFlood, usePublishedZombie } from '../../services/published';
import { Button } from '../../components/ui';
import { WorldMap } from '../WorldMap';
import { FloodMap } from '../flood/FloodMap';
import { incidentDate, incidentIsActive, incidentOfficialSource, incidentStateLabel, incidentTypeLabels } from '../flood/incidentPresentation';
import '../flood/flood.css';
import './mobile.css';

const zombieStatus: Record<string, string> = { CREATED: 'Preparando', RUNNING: 'En ejecución', PAUSED: 'Pausada', COMPLETED: 'Finalizada', CANCELLED: 'Cancelada', FAILED: 'Error' };
const floodStatus: Record<string, string> = { idle: 'Sin simulación publicada', running: 'En ejecución', paused: 'Pausada', finished: 'Finalizada', failed: 'Error', cancelled: 'Cancelada' };
const agentStatus: Record<string, string> = { active: 'En camino', bitten: 'Infectado', evacuated: 'Evacuado', moving: 'En camino', waiting: 'Esperando', isolated: 'Aislado' };
const friendly = (id: string, index: number) => /^\w+-\d{1,4}$/.test(id) ? id : `Persona ${index + 1}`;

export default function MobileViewer() {
  const [scenario, setScenario] = useState<'zombie' | 'flood'>('zombie');
  const [visitedFlood, setVisitedFlood] = useState(false);
  const visible = usePageVisible();
  const online = useNetworkOnline();
  return <main className="mobile-preview"><div className={`mobile-device mobile-${scenario}`}>
    <header className="mobile-header"><strong>{brand.webName}<small>{brand.team}</small></strong><span>{scenario === 'zombie' ? 'Brote zombi' : 'Inundaciones'}</span></header>
    <section className="mobile-content" hidden={scenario !== 'zombie'} aria-label="Visor de brote zombi"><ZombieViewer active={visible && scenario === 'zombie'} online={online} /></section>
    {visitedFlood && <section className="mobile-content" hidden={scenario !== 'flood'} aria-label="Visor de inundaciones"><FloodViewer active={visible && scenario === 'flood'} online={online} /></section>}
    <nav className="mobile-navigation" aria-label="Escenarios ciudadanos"><button aria-pressed={scenario === 'zombie'} onClick={() => setScenario('zombie')}><Ghost aria-hidden="true" size={22} />Brote zombi</button><button aria-pressed={scenario === 'flood'} onClick={() => { setVisitedFlood(true); setScenario('flood'); }}><Waves aria-hidden="true" size={22} />Inundaciones</button></nav>
    {config.androidApkUrl && <a className="mobile-download" href={config.androidApkUrl}>Descargar para Android</a>}
  </div><aside className="mobile-preview-caption">Visor ciudadano · <a href="/mobile">Abrir en iPhone o Android</a></aside></main>;
}

function ZombieViewer({ active, online }: { active: boolean; online: boolean }) {
  const published = usePublishedZombie(active);
  const simulation = published.data?.simulation;
  const graph = useQuery({ queryKey: ['mobile', 'graph', simulation?.graph_profile ?? 'BASE', simulation?.graph_version ?? ''],
    queryFn: ({ signal }) => api.graph(signal, { mode: simulation?.graph_profile === 'FULL_MANTA' ? 'full' : 'competition' }), enabled: active, staleTime: Infinity, retry: false });
  const [selection, setSelection] = useState({ run: '', agent: '', shelter: '' });
  const run = simulation?.simulation_id ?? '';
  const selectedAgent = selection.run === run ? selection.agent : '';
  const selectedShelter = selection.run === run ? selection.shelter : '';
  const world = graph.data?.version === simulation?.graph_version ? simulation?.snapshot : undefined;
  const survivors = world?.survivors ?? [];
  const shelters = world?.shelters ?? (!simulation ? graph.data?.shelters : []) ?? [];
  const selectAgent = (id: string) => setSelection({ run, agent: id, shelter: '' });
  const selectShelter = (id: string) => setSelection({ run, agent: '', shelter: id });
  const selected = survivors.find(agent => agent.id === selectedAgent);
  return <>
    <div className="mobile-hud" role="status">{simulation ? <>Turno {simulation.tick}/{simulation.max_ticks} · {zombieStatus[simulation.status]}</> : published.data?.availability === 'unavailable' ? 'Ejecución no disponible' : 'Sin simulación activa'}</div>
    {!simulation && <p className="mobile-notice">Cuando comience una simulación, podrás verla aquí.</p>}
    {(!online || published.isError || graph.isError) && <ConnectionNotice onRetry={() => { void published.refetch(); void graph.refetch(); }} />}
    {simulation && !world && graph.data && <p role="status" className="mobile-notice">Actualizando geografía de la ejecución…</p>}
    {graph.data ? <WorldMap graph={graph.data} world={world} selected={selected} shelters={shelters} onSelect={selectAgent} selectedShelterId={selectedShelter} onSelectShelter={selectShelter} lifecycle={{ id: run, running: active && simulation?.status === 'RUNNING', connected: online && !published.isError, interval: simulation?.tick_interval_ms ?? 2000 }} /> : <p className="mobile-notice" role="status">Cargando mapa de Manta…</p>}
    {world && <p className="mobile-metrics">♟ {survivors.filter(agent => agent.status === 'active').length} en camino · ☣ {world.zombies.length} zombis visibles · ✓ {survivors.filter(agent => agent.status === 'evacuated').length} evacuados</p>}
    <Entities agents={survivors.map((agent, index) => ({ id: agent.id, name: friendly(agent.id, index), state: agent.status, shelter: agent.target_shelter_id, route: agent.planned_route.length > 1 }))} shelters={shelters} selectedAgent={selectedAgent} selectedShelter={selectedShelter} onAgent={selectAgent} onShelter={selectShelter} onClose={() => setSelection({ run, agent: '', shelter: '' })} />
    <p className="mobile-legal">Simulación experimental. Refugios ficticios; no son sitios oficiales de evacuación.</p>
  </>;
}

function FloodViewer({ active, online }: { active: boolean; online: boolean }) {
  const [mode, setMode] = useState<'citizen' | 'simulation'>('citizen');
  const [showReference, setShowReference] = useState(false);
  const published = usePublishedFlood(active && mode === 'simulation');
  const state = published.data;
  const synthetic = mode === 'simulation';
  const graph = useQuery({ queryKey: ['mobile', 'flood-graph', synthetic ? state?.graph_version ?? '' : 'citizen', synthetic ? state?.run_id ?? '' : ''],
    queryFn: ({ signal }) => api.floodGraph(signal, synthetic && state ? { runId: state.run_id } : { mode: 'competition' }),
    enabled: active && (!synthetic || Boolean(state)), staleTime: Infinity, retry: false });
  const reference = useQuery({ queryKey: ['mobile', 'reference'], queryFn: ({ signal }) => api.referenceStatus(signal), enabled: active && !synthetic, staleTime: 30000, retry: false });
  const polygons = useQuery({ queryKey: ['reference', 'polygons', reference.data?.dataset_version ?? ''], queryFn: ({ signal }) => api.susceptibilityReference(reference.data!.dataset_version!, signal), enabled: active && !synthetic && showReference && Boolean(reference.data?.dataset_version), staleTime: Infinity, retry: false });
  const incidents = useQuery({ queryKey: ['mobile', 'incidents'], queryFn: ({ signal }) => api.incidents({ limit: 200, offset: 0 }, signal), enabled: active && !synthetic, refetchInterval: active && !synthetic ? 10000 : false, retry: false });
  const citizenIncidents = useMemo(() => incidents.data?.incidents.filter(incident => incident.source_type !== 'synthetic' && incidentIsActive(incident)) ?? [], [incidents.data]);
  const [selection, setSelection] = useState({ run: '', agent: '', shelter: '' });
  const [selectedIncident, setSelectedIncident] = useState('');
  const [reporting, setReporting] = useState(false);
  const [point, setPoint] = useState<GeoPoint>();
  const [review, setReview] = useState(false);
  const run = synthetic ? state?.run_id ?? '' : 'citizen';
  const selectedAgent = selection.run === run ? selection.agent : '';
  const selectedShelter = selection.run === run ? selection.shelter : '';
  const matching = graph.data?.version === state?.graph_version;
  const scenario = synthetic && matching && state?.state !== 'idle' ? state?.scenario : undefined;
  const shelters = synthetic ? matching ? state?.shelters ?? [] : [] : graph.data?.shelters ?? [];
  const selectAgent = (id: string) => setSelection({ run, agent: id, shelter: '' });
  const selectShelter = (id: string) => setSelection({ run, agent: '', shelter: id });
  const selectedReport = citizenIncidents.find(incident => incident.incident_id === selectedIncident);
  const changeMode = (next: typeof mode) => { setMode(next); setReporting(false); setPoint(undefined); setReview(false); setSelectedIncident(''); };
  return <>
    <div className="mobile-segmented" role="group" aria-label="Vista de inundaciones"><button aria-pressed={!synthetic} onClick={() => changeMode('citizen')}>Mapa ciudadano</button><button aria-pressed={synthetic} onClick={() => changeMode('simulation')}>Simulación experimental</button></div>
    {synthetic ? <div className="mobile-hud" role="status">{state ? `${floodStatus[state.state]}${state.state !== 'idle' ? ` · Turno ${state.scenario.simulation_step}/${state.config.simulation_duration} · ${(100 * state.scenario.simulation_step / state.config.simulation_duration).toFixed(1)}%` : ''}` : 'Consultando simulación…'}<small>Simulación con datos sintéticos.</small></div> : <p className="mobile-notice">Novedades ciudadanas y refugios propuestos. Los reportes pendientes requieren verificación.</p>}
    {(!online || graph.isError || synthetic && published.isError || !synthetic && incidents.isError) && <ConnectionNotice onRetry={() => { void graph.refetch(); if (synthetic) void published.refetch(); else void incidents.refetch(); }} />}
    {graph.data ? <FloodMap key={`${mode}-${graph.data.version}`} suppressIncidentPopup citizen={!synthetic} graph={graph.data} scenario={scenario} shelters={shelters} candidates={[]} selectedAgentId={selectedAgent} onSelectAgent={selectAgent} selectedShelterId={selectedShelter} onSelectShelter={selectShelter} incidents={synthetic ? [] : citizenIncidents} selectedIncidentId={selectedIncident} onSelectIncident={setSelectedIncident} reference={polygons.data} showReference={showReference} onShowReference={setShowReference} referenceAvailable={Boolean(reference.data?.dataset_version)} pickingCandidate={reporting && !point ? 0 : undefined} pickLabel="reporte" onPickPosition={location => { setPoint(location); setReview(false); }} onCancelPick={() => { setReporting(false); setPoint(undefined); }} previewPosition={point} lifecycle={{ id: run, running: active && state?.state === 'running' && synthetic, connected: online && !published.isError, interval: state?.config.interval_ms ?? 2000 }} /> : <p className="mobile-notice" role="status">Cargando mapa de Manta…</p>}
    {scenario && <p className="mobile-metrics">✓ {scenario.evacuation_metrics.evacuated_agents}/{scenario.evacuation_metrics.total_agents} evacuados · ⊘ {scenario.evacuation_metrics.blocked_edges} calles bloqueadas</p>}
    <Entities agents={(scenario?.agents ?? []).map((agent, index) => ({ id: agent.id, name: friendly(agent.id, index), state: agent.state, shelter: agent.target_shelter_id, route: agent.planned_route.length > 1 }))} shelters={shelters} selectedAgent={selectedAgent} selectedShelter={selectedShelter} onAgent={selectAgent} onShelter={selectShelter} onClose={() => setSelection({ run, agent: '', shelter: '' })} />
    {!synthetic && <div className="mobile-citizen-actions"><Button onClick={() => { setReporting(true); setPoint(undefined); setReview(false); }}>Reportar novedad</Button><details><summary>Novedades publicadas ({citizenIncidents.length})</summary>{!citizenIncidents.length && <p>Sin novedades publicadas en esta consulta.</p>}<ul>{citizenIncidents.map(incident => <li key={incident.incident_id}><button onClick={() => setSelectedIncident(incident.incident_id)}>{incidentTypeLabels[incident.incident_type]} · {incidentStateLabel(incident)}{incidentOfficialSource(incident) && ' · respaldo oficial'}</button></li>)}</ul>{incidents.data?.has_more && <p>Se muestran las primeras 200 novedades.</p>}</details></div>}
    {selectedReport && !synthetic && <section className="mobile-sheet" aria-label="Novedad seleccionada"><Button variant="ghost" onClick={() => setSelectedIncident('')}>Cerrar novedad</Button><h2>{incidentTypeLabels[selectedReport.incident_type]}</h2><time dateTime={selectedReport.event_time}>{incidentDate(selectedReport.event_time)}</time><p>{selectedReport.description}</p><p>{incidentStateLabel(selectedReport)}{incidentOfficialSource(selectedReport) && ' · respaldo oficial'}</p><p>Transitabilidad declarada: {passability[selectedReport.road_passability_reported]}</p><p>Severidad declarada: {severity[selectedReport.severity_reported]}</p></section>}
    {reporting && !synthetic && <ReportForm point={point} review={review} setReview={setReview} onRelocate={() => { setPoint(undefined); setReview(false); }} onClose={() => { setReporting(false); setPoint(undefined); }} onSent={incident => { setSelectedIncident(incident.incident_id); setReporting(false); setPoint(undefined); void incidents.refetch(); }} />}
    {polygons.isError && showReference && <p role="status" className="mobile-notice">La referencia oficial no está disponible. Conservamos la geografía y las novedades.</p>}
    <p className="mobile-legal">{synthetic ? 'Modelo sintético; no es pronóstico ni alerta oficial.' : 'Los reportes ciudadanos no alteran automáticamente el grafo operativo. Refugios propuestos, sin habilitación oficial.'}</p>
  </>;
}

const severity = { unknown: 'Desconocida', low: 'Baja', moderate: 'Moderada', high: 'Alta' };
const passability = { unknown: 'Desconocida', passable: 'Transitable', restricted: 'Restringida', blocked: 'Bloqueada' };
function ConnectionNotice({ onRetry }: { onRetry: () => void }) { return <p className="mobile-notice mobile-offline" role="status">Sin conexión; el último estado puede estar desactualizado. <button onClick={onRetry}>Reintentar</button></p>; }
type Agent = { id: string; name: string; state: string; shelter: string; route: boolean };
function Entities({ agents, shelters, selectedAgent, selectedShelter, onAgent, onShelter, onClose }: { agents: Agent[]; shelters: Shelter[]; selectedAgent: string; selectedShelter: string; onAgent: (id: string) => void; onShelter: (id: string) => void; onClose: () => void }) {
  const selected = agents.find(agent => agent.id === selectedAgent);
  const shelter = shelters.find(shelter => shelter.id === selectedShelter);
  const shelterName = (id: string) => id ? `Refugio ${shelters.findIndex(shelter => shelter.id === id) + 1 || 'asignado'}` : 'Por asignar';
  return <>
    <details className="mobile-entities"><summary>Personas ({agents.length}) y refugios ({shelters.length})</summary><ul>{agents.map(agent => <li key={agent.id}><span>{agent.name} · {agentStatus[agent.state] ?? agent.state}<small>{shelterName(agent.shelter)}</small></span><button onClick={() => onAgent(agent.id)}>{agent.route ? 'Ver ruta' : 'Ver persona'}</button></li>)}</ul><ul>{shelters.map((shelter, index) => <li key={shelter.id}><button onClick={() => onShelter(shelter.id)}>Refugio {index + 1} · {shelter.occupancy}/{shelter.capacity}</button></li>)}</ul></details>
    {(selected || shelter) && <section className="mobile-sheet" aria-label={selected ? 'Persona seleccionada' : 'Refugio seleccionado'}><Button variant="ghost" onClick={onClose}>Cerrar detalle</Button>{selected && <><h2>{selected.name}</h2><p>{agentStatus[selected.state] ?? selected.state} · {shelterName(selected.shelter)}</p><p>{selected.route ? 'Ruta publicada resaltada sobre el mapa.' : 'Sin ruta publicada disponible.'}</p></>}{shelter && <><h2>Refugio {shelters.indexOf(shelter) + 1}</h2><p>Capacidad: {shelter.capacity} · Ocupación: {shelter.occupancy}</p><p>Plazas disponibles: {shelter.available ?? Math.max(0, shelter.capacity - shelter.occupancy - (shelter.reserved ?? 0))}</p><small>Ubicación experimental; sin habilitación oficial.</small></>}</section>}
  </>;
}

function ReportForm({ point, review, setReview, onRelocate, onClose, onSent }: { point?: GeoPoint; review: boolean; setReview: (review: boolean) => void; onRelocate: () => void; onClose: () => void; onSent: (incident: Incident) => void }) {
  const client = useQueryClient();
  const [type, setType] = useState<IncidentCreate['incident_type']>('flooded_road');
  const [description, setDescription] = useState('');
  const [reportedSeverity, setSeverity] = useState<IncidentCreate['severity_reported']>('unknown');
  const [reportedPassability, setPassability] = useState<IncidentCreate['road_passability_reported']>('unknown');
  const key = useRef<{ body: string; key: string; input: IncidentCreate } | null>(null);
  const gate = useRef(false);
  const [edgeChoice, setEdgeChoice] = useState({ point: '', id: '' });
  const pointKey = point ? `${point.lat},${point.lng}` : '';
  const service = useQuery({ queryKey: ['incidents', 'config'], queryFn: ({ signal }) => api.incidentInfo(signal), staleTime: Infinity, retry: false });
  const resolution = useQuery({ queryKey: ['mobile', 'report-location', pointKey], queryFn: () => api.resolveIncident({ latitude: point!.lat, longitude: point!.lng }), enabled: Boolean(point) && Boolean(service.data?.enabled), staleTime: Infinity, retry: false });
  const chosenEdge = edgeChoice.point === pointKey ? edgeChoice.id : !resolution.data?.ambiguous && resolution.data?.matched ? resolution.data.candidates[0]?.edge_id : undefined;
  const admissible = Boolean((resolution.data?.matched || resolution.data?.ambiguous) && chosenEdge && resolution.data!.candidates.some(candidate => candidate.edge_id === chosenEdge));
  const create = useMutation({ mutationFn: async () => {
    if (!point || !admissible) throw new Error('Selecciona una calle válida en el mapa.');
    const body = JSON.stringify({ incident_type: type, latitude: point.lat, longitude: point.lng, description: description.trim(), severity_reported: reportedSeverity, road_passability_reported: reportedPassability, location_method: 'manual', edge_id_hint: chosenEdge });
    if (key.current?.body !== body) key.current = { body, key: crypto.randomUUID(), input: { ...JSON.parse(body) as Omit<IncidentCreate, 'event_time'>, event_time: new Date().toISOString() } };
    return api.createIncident(key.current.input, key.current.key);
  }, onSuccess: incident => { void client.invalidateQueries({ queryKey: ['incidents'] }); onSent(incident); } });
  const once = async () => { if (gate.current) return; gate.current = true; try { await create.mutateAsync(); } catch { /* mutation exposes the structured failure */ } finally { gate.current = false; } };
  const maxLength = Math.min(500, service.data?.max_description_length ?? 500);
  const valid = Boolean(point) && admissible && description.trim().length >= 5 && description.trim().length <= maxLength && service.data?.enabled;
  useEffect(() => { setReview(false); }, [point?.lat, point?.lng]);
  return <section className={`mobile-sheet mobile-report ${!point ? 'mobile-report-picking' : ''}`} aria-label="Reportar novedad"><div className="mobile-sheet-actions"><h2>Reportar novedad</h2><Button variant="ghost" onClick={onClose}>Cerrar reporte</Button></div>{!point ? <p role="status">Toca una calle en el mapa para seleccionar la ubicación. También puedes centrar el mapa y pulsar Enter. No necesitas GPS.</p> : <>
    {review ? <div className="mobile-report-review"><h3>Revisar reporte</h3><p>{incidentTypeLabels[type]} · ubicación seleccionada en mapa</p><p>{description.trim()}</p><p>{passability[reportedPassability]} · severidad {severity[reportedSeverity]}</p><p>Se enviará como reporte ciudadano pendiente de verificación.</p></div> : <form onSubmit={event => { event.preventDefault(); if (valid) setReview(true); }}><label>Tipo de novedad<select value={type} onChange={event => setType(event.target.value as typeof type)}>{Object.entries(incidentTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><Button variant="secondary" onClick={onRelocate}>Cambiar ubicación en mapa</Button>{resolution.isFetching && <p role="status">Comprobando ubicación vial…</p>}{resolution.isError && <p role="alert">No se pudo verificar la ubicación. <button type="button" onClick={() => void resolution.refetch()}>Reintentar ubicación</button></p>}{resolution.data && !resolution.data.matched && !resolution.data.ambiguous && <p role="alert">No encontramos una calle admisible. Selecciona otra ubicación.</p>}{resolution.data?.ambiguous && <fieldset><legend>Elige la calle de la novedad</legend>{resolution.data.candidates.map((candidate, index) => <label key={candidate.edge_id}><input type="radio" name="reported-street" checked={chosenEdge === candidate.edge_id} onChange={() => setEdgeChoice({ point: pointKey, id: candidate.edge_id })} />Calle cercana {index + 1} · a {Math.round(candidate.distance_m)} m</label>)}</fieldset>}<label>Descripción breve<textarea minLength={5} maxLength={maxLength} value={description} onChange={event => setDescription(event.target.value)} required /></label><label>Transitabilidad declarada<select value={reportedPassability} onChange={event => setPassability(event.target.value as typeof reportedPassability)}>{Object.entries(passability).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Severidad declarada<select value={reportedSeverity} onChange={event => setSeverity(event.target.value as typeof reportedSeverity)}>{Object.entries(severity).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><Button type="submit" disabled={!valid}>Revisar reporte</Button></form>}
    {review && <div className="mobile-sheet-actions"><Button disabled={create.isPending || !valid} onClick={() => void once()}>{create.isPending ? 'Enviando…' : 'Enviar reporte'}</Button><Button variant="secondary" disabled={create.isPending} onClick={() => setReview(false)}>Editar reporte</Button></div>}
  </>}{service.isError && <p role="alert">No se pudo consultar el servicio de reportes. <button onClick={() => void service.refetch()}>Reintentar</button></p>}{service.data && !service.data.enabled && <p role="status">El envío de reportes no está disponible.</p>}{create.error && <p role="alert">{create.error.message}</p>}</section>;
}
