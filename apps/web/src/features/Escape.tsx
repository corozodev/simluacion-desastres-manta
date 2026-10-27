import { useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, StatusIndicator } from '../components/ui';
import { useGraph, useWorld } from '../services/queries';
import { SimulationControl } from './SimulationControl';
import { ApiError } from '../services/api';
import { routeWarnings, WorldMap } from './WorldMap';

export function Escape() {
  const world = useWorld();
  return <EscapeSession key={world.data?.simulation?.run_id ?? world.data?.graph_version ?? 'loading'} world={world} />;
}

function EscapeSession({ world }: { world: ReturnType<typeof useWorld> }) {
  const snapshot = world.data;
  const [coverage, setCoverage] = useState(snapshot?.simulation?.mode ?? 'competition');
  const preview = Boolean(snapshot?.simulation && coverage !== snapshot.simulation.mode);
  const graph = useGraph(preview ? undefined : snapshot?.simulation?.run_id, preview ? coverage : undefined);
  const refetchWorld = world.refetch;
  useEffect(() => {
    if (graph.error instanceof ApiError && graph.error.code === 'RUN_CHANGED') void refetchWorld();
  }, [graph.error, refetchWorld]);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const matching = snapshot?.survivors.filter(s => s.id.toLowerCase().includes(search.toLowerCase())) ?? [];
  const selected = matching.find(s => s.id.toLowerCase() === search.trim().toLowerCase()) ?? matching.find(s => s.id === selectedId) ?? (matching.length === 1 ? matching[0] : undefined);
  const position = graph.data?.nodes.find(node => node.id === selected?.current_node);
  const warnings = selected && graph.data ? routeWarnings(graph.data, snapshot!, selected) : [];
  const status = world.isError ? 'offline' : world.isPending ? 'checking' : 'online';
  return <div className="page escape-page"><PageHeader eyebrow="TRACK A · HALLOWEEN 2026" title="Escape de Manta Zombie" description="Navegación por Manta. Las zonas de aparición indican el origen; las rutas pueden continuar por toda la red operativa." action={<StatusIndicator status={status} />} />
    {world.isPending ? <LoadingState label="Consultando el mundo…" /> : world.isError ? <ErrorState error={world.error} onRetry={() => void world.refetch()} /> : null}
    {snapshot?.simulation && <SimulationControl info={snapshot.simulation} selection={coverage} onSelect={mode => { setCoverage(mode as typeof coverage); setSearch(''); setSelectedId(''); }} />}
    {snapshot && <><div className="summary-grid">
      <Card className="escape-metric"><span>Turno</span><strong>{snapshot.turn}<small> / 150 nominales</small></strong></Card>
      <Card className="escape-metric"><span>Evacuados / mordidos / activos</span><strong>{snapshot.metrics.evacuated} / {snapshot.metrics.bitten} / {snapshot.metrics.active}</strong><small>{snapshot.metrics.evacuated + snapshot.metrics.active} vivos en total</small></Card>
      <Card className="escape-metric"><span>Latencia HTTP p95</span><strong>{snapshot.metrics.http_p95_ms.toFixed(2)}<small> ms</small></strong></Card>
    </div><Card className="escape-map-card"><div className="section-heading"><div><h2>{preview ? 'Previsualización geográfica' : 'Estado observable'}</h2><p>{preview ? 'La ronda activa continúa sin cambios' : `Actualización cada 2 segundos · versión ${snapshot.world_version}`}</p></div><Badge tone="purple">{preview ? "Solo geografía" : `${snapshot.zombies.length} zombies visibles`}</Badge></div>
      {graph.isPending ? <LoadingState label="Cargando el grafo…" /> : graph.isError ? <ErrorState error={graph.error} onRetry={() => void graph.refetch()} /> : !preview && graph.data.version !== snapshot.graph_version ? <div className="state" role="alert"><p>El estado utiliza otra versión del grafo.</p><Button variant="secondary" onClick={() => void graph.refetch()}>Actualizar grafo</Button></div> : <WorldMap key={`${coverage}:${graph.data.version}`} graph={graph.data} world={preview ? undefined : snapshot} selected={preview ? undefined : selected} />}
    </Card><div className="escape-details"><Card className="escape-map-card"><h2>Refugios ficticios</h2><p className="muted">Puntos del escenario; no son instalaciones oficiales de emergencia.</p><p className="muted">El grafo operativo es una selección de calles reales. La envolvente urbana no implica cobertura vial completa.</p><ul className="escape-shelters">{(preview ? graph.data?.shelters ?? [] : snapshot.shelters).map(shelter => <li key={shelter.id}><strong>{shelter.id}</strong><span>{shelter.occupancy} / {shelter.capacity} ocupadas<br />{shelter.reserved ?? 0} reservadas · {shelter.available ?? Math.max(0, shelter.capacity - shelter.occupancy - (shelter.reserved ?? 0))} libres</span></li>)}</ul></Card>
      <Card className="escape-map-card"><h2>Sobrevivientes</h2>{preview ? <p>Vuelve a la cobertura activa para consultar posiciones y rutas.</p> : <><label className="escape-search">Buscar por ID<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="S-0001" /></label>
        {matching.length === 0 ? <EmptyState title="Sin sobrevivientes para esta búsqueda" description="Prueba con otro ID o espera la inicialización del mundo." /> : <div className="escape-table"><table><thead><tr><th>ID</th><th>Nodo</th><th>Estado</th><th>Refugio</th><th>Ruta</th></tr></thead><tbody>{matching.map(survivor => <tr key={survivor.id}><td>{survivor.id}</td><td>{survivor.current_node}</td><td>{({ active: 'Activo', bitten: 'Mordido', evacuated: 'Evacuado' })[survivor.status]}</td><td>{survivor.target_shelter_id || 'Sin asignación'}</td><td><button type="button" className="text-link" onClick={() => setSelectedId(survivor.id)} aria-label={`Ver ruta de ${survivor.id}`}>Ver ruta</button></td></tr>)}</tbody></table></div>}
        {selected ? <div className="escape-survivor-detail" aria-label={`Detalle de ${selected.id}`}><h3>{selected.id}</h3><p>Posición: {position ? `${position.lat.toFixed(6)}, ${position.lng.toFixed(6)}` : selected.current_node}</p><p>Refugio asignado: {selected.target_shelter_id || 'Sin asignación'}</p><p>Siguiente movimiento: {selected.planned_route.find(node => node !== selected.current_node) ?? selected.current_node}</p>{selected.spawn_zone_id && <p>Zona de origen: {graph.data?.spawn_zones?.find(zone => zone.id === selected.spawn_zone_id)?.name ?? selected.spawn_zone_id}</p>}<p>Ruta publicada: {selected.planned_route.length ? selected.planned_route.join(' → ') : 'Sin ruta publicada'}</p>{warnings.map(warning => <p key={warning} role="alert" className="escape-danger">{warning}</p>)}</div> : <p className="muted">Selecciona un sobreviviente para ver su posición y ruta.</p>}
      </>}</Card></div></>}
  </div>;
}
