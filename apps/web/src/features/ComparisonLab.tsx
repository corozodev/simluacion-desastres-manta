import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { SimulationCreateRequest, SimulationCreated, SimulationState, SimulationResults } from '@corodev/contracts';
import { api, ApiError } from '../services/api';
import { isTerminal } from '../services/simulation';
import { Button, ErrorState } from '../components/ui';
import { algorithmLabels } from './AgentPolicies';

type Algorithm = keyof typeof algorithmLabels;
type ComparisonRow = { input: SimulationCreateRequest; key: string; metadata?: SimulationCreated; state?: SimulationState; results?: SimulationResults };
export type ComparisonExport = { configuration: SimulationCreateRequest; graph_version?: string; status: string; tick: number; metrics: SimulationState['snapshot']['metrics'] | null; shelters: SimulationState['snapshot']['shelters']; analytics: SimulationResults['results']['analytics'] | null; fleet: SimulationState['snapshot']['fleet_metrics'] | null; };
export function comparisonExport(rows: Pick<ComparisonRow, 'input' | 'state' | 'results'>[]): ComparisonExport[] {
  return rows.map(row => ({ configuration: row.state ? { ...row.input, seed: row.state.seed, max_ticks: row.state.max_ticks, tick_interval_ms: row.state.tick_interval_ms, config: row.state.config } : row.input, graph_version: row.state?.graph_version, status: row.state?.status ?? 'PENDING', tick: row.state?.tick ?? 0, metrics: row.state?.snapshot.metrics ?? null, shelters: row.state?.snapshot.shelters ?? [], analytics: row.results?.results.analytics ?? null, fleet: row.state?.snapshot.fleet_metrics ?? null }));
}
export function comparisonCSV(rows: ComparisonExport[]) {
  const header = ['configuration', 'status', 'tick', 'survivors', 'evacuated', 'bitten', 'active', 'http_p50_ms', 'http_p95_ms', 'http_p99_ms', 'requests_invalid', 'requests_timeout', 'replans', 'oscillations', 'mean_arrival_turn', 'mean_route_efficiency', 'prediction_hits', 'prediction_misses', 'prediction_false_positives', 'prediction_brier_score', 'fleet_pickups', 'fleet_delivered', 'graph_version'];
  const quote = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return [header, ...rows.map(row => [JSON.stringify(row.configuration), row.status, row.tick, row.configuration.config?.survivors, row.metrics?.evacuated, row.metrics?.bitten, row.metrics?.active, row.metrics?.http_p50_ms, row.metrics?.http_p95_ms, row.metrics?.http_p99_ms, row.metrics?.requests_invalid, row.metrics?.requests_timeout, row.analytics?.replans, row.analytics?.oscillations, row.analytics?.mean_arrival_turn, row.analytics?.mean_route_efficiency, row.analytics?.prediction.hits, row.analytics?.prediction.misses, row.analytics?.prediction.false_positives, row.analytics?.prediction.brier_score, row.fleet?.pickups, row.fleet?.delivered, row.graph_version])].map(values => values.map(quote).join(',')).join('\r\n');
}
function saveFile(value: string, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// Runs use their own backend sessions. Polling observes those sessions and never
// creates work. Only an explicit comparison/replay authorizes the bounded queue.
export function ComparisonLab({ input, valid, disabled, onBusyChange }: { input: SimulationCreateRequest; valid: boolean; disabled: boolean; onBusyChange: (busy: boolean) => void }) {
  const [first, setFirst] = useState<Algorithm>('baseline_shortest_path');
  const [second, setSecond] = useState<Algorithm>('predictive_temporal_astar');
  const [rows, setRows] = useState<ComparisonRow[]>([]);
  const [current, setCurrent] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const queue = useRef<ComparisonRow[]>([]);
  const allowed = useRef(false);
  const finalized = useRef(new Set<string>());
  const gate = useRef(false);
  const create = useMutation({ mutationFn: ({ row }: { row: ComparisonRow; index: number }) => api.createSimulation(row.input, row.key),
    onSuccess: (metadata, { index }) => {
      // An automatic seed is resolved by the first backend creation. Freeze it
      // for its replay and all pending members of this comparison.
      queue.current[index] = { ...queue.current[index]!, metadata, input: { ...queue.current[index]!.input, seed: metadata.seed } };
      for (let next = index + 1; next < queue.current.length; next++) {
        if (queue.current[next]!.input.seed === undefined) queue.current[next]!.input.seed = metadata.seed;
      }
      setRows([...queue.current]); setCurrent(index);
    },
    onError: () => { gate.current = false; setBusy(false); },
  });
  const active = current === null ? undefined : rows[current];
  const state = useQuery({ queryKey: ['comparison-session', active?.metadata?.simulation_id ?? '', 'state'],
    queryFn: ({ signal }) => api.simulationState(active!.metadata!.simulation_id, active!.metadata!.access_token, signal),
    enabled: Boolean(active?.metadata), retry: false, gcTime: 0, refetchOnWindowFocus: false,
    refetchInterval: query => isTerminal(query.state.data?.status) || query.state.error instanceof ApiError && [401, 403, 404, 410].includes(query.state.error.status ?? 0) ? false : Math.min(30_000, 2000 * 2 ** Math.min(4, query.state.errorUpdateCount)),
  });
  const results = useQuery({ queryKey: ['comparison-session', active?.metadata?.simulation_id ?? '', 'results'],
    queryFn: ({ signal }) => api.simulationResults(active!.metadata!.simulation_id, active!.metadata!.access_token, signal),
    enabled: Boolean(active?.metadata) && isTerminal(state.data?.status), retry: false, gcTime: 0,
  });
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  useEffect(() => () => { allowed.current = false; }, []);
  useEffect(() => {
    if (!(state.error instanceof ApiError) || ![401, 403, 404, 410].includes(state.error.status ?? 0)) return;
    allowed.current = false; gate.current = false; setBusy(false);
  }, [state.error]);
  useEffect(() => {
    const value = state.data;
    if (!value || current === null || value.simulation_id !== queue.current[current]?.metadata?.simulation_id) return;
    queue.current[current] = { ...queue.current[current]!, state: value, ...(results.data?.simulation_id === value.simulation_id ? { results: results.data } : {}) };
    setRows([...queue.current]);
    if (!isTerminal(value.status) || results.data?.simulation_id !== value.simulation_id || finalized.current.has(value.simulation_id)) return;
    finalized.current.add(value.simulation_id);
    const next = current + 1;
    if (allowed.current && next < queue.current.length) {
      setCurrent(null); create.mutate({ row: queue.current[next]!, index: next });
    } else { gate.current = false; setBusy(false); }
  }, [state.data, results.data, current]);
  const begin = (inputs: SimulationCreateRequest[]) => {
    if (gate.current || disabled) return;
    gate.current = true; allowed.current = true; setBusy(true); setCurrent(null); finalized.current.clear();
    queue.current = inputs.map(configuration => ({ input: structuredClone(configuration), key: crypto.randomUUID() }));
    setRows([...queue.current]); create.mutate({ row: queue.current[0]!, index: 0 });
  };
  const cancel = useMutation({ mutationFn: async () => {
    allowed.current = false;
    if (active?.metadata && !isTerminal(state.data?.status)) await api.controlSimulation(active.metadata.simulation_id, active.metadata.access_token, 'cancel');
  }, onSuccess: () => { gate.current = false; setBusy(false); void state.refetch(); } });
  const exportRows = comparisonExport(rows);
  const canRetry = create.isError && create.variables && !busy;
  return <details className="workspace-results comparison-lab"><summary>Laboratorio comparativo</summary>
    <p>Compara dos planificadores con el mismo grafo, semilla, población, refugios, capacidades y cronograma de bloqueos de la ronda. Las ejecuciones son independientes y secuenciales, a 2 segundos por turno. No comienzan al abrir este panel ni al actualizar la página.</p>
    <p>El modo oficial conserva sus reglas en ambos casos. Cambia únicamente el algoritmo; las funciones PRO y la política zombi se copian de la configuración superior. La prueba acelerada se ejecuta con la herramienta de evaluación local; estos resultados corresponden al HTTP real de cada sesión.</p>
    <div className="comparison-controls"><fieldset disabled={busy || disabled}><legend className="sr-only">Planificadores a comparar</legend>
      <label>Configuración A<select value={first} onChange={event => setFirst(event.target.value as Algorithm)}>{Object.entries(algorithmLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label>Configuración B<select value={second} onChange={event => setSecond(event.target.value as Algorithm)}>{Object.entries(algorithmLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    </fieldset><Button disabled={disabled || busy || !valid || first === second} onClick={() => begin([first, second].map(algorithm => ({ ...input, config: { ...input.config, evacuation_algorithm: algorithm } })))}>{busy ? 'Comparación en curso…' : 'Ejecutar comparación'}</Button>
      {busy && active?.metadata && <Button variant="secondary" disabled={cancel.isPending} onClick={() => cancel.mutate()}>Detener comparación</Button>}
      {!busy && rows.length > 0 && !canRetry && <Button variant="secondary" disabled={disabled} onClick={() => begin(rows.map(row => row.input))}>Repetir comparación y semillas</Button>}
      {canRetry && <Button variant="secondary" disabled={disabled} onClick={() => { gate.current = true; setBusy(true); create.mutate(create.variables!); }}>Reintentar configuración pendiente</Button>}
    </div>
    {create.error && <ErrorState error={create.error} />}{cancel.error && <ErrorState error={cancel.error} />}{results.error && <ErrorState error={results.error} onRetry={() => void results.refetch()} />}{state.error && <ErrorState error={state.error} onRetry={() => void state.refetch()} />}
    {busy && <p role="status">{active?.metadata ? `Configuración ${current === 0 ? 'A' : 'B'} · turno ${state.data?.tick ?? 0}` : 'Preparando la siguiente ejecución independiente…'}</p>}
    {rows.length > 0 && <><div className="comparison-table-scroll"><table className="comparison-table"><caption>Resultados observados · latencias de POST /paso del backend</caption><thead><tr><th scope="col">Configuración</th><th scope="col">Estado / turno</th><th scope="col">Supervivencia</th><th scope="col">Evacuados</th><th scope="col">Mordidos</th><th scope="col">HTTP p50 / p95 / p99</th><th scope="col">Inválidas / timeouts</th><th scope="col">Llegada / eficiencia</th><th scope="col">Replanes / oscilaciones</th><th scope="col">Predicción acertada / fallida</th><th scope="col">Flota recogidos / entregados</th><th scope="col">Ocupación de refugios</th></tr></thead><tbody>{rows.map((row, index) => {
      const metrics = row.state?.snapshot.metrics;
      const analytics = row.results?.results.analytics;
      const fleet = row.state?.snapshot.fleet_metrics;
      const initial = row.input.config?.survivors ?? 0;
      const survival = metrics && initial > 0 ? (initial - metrics.bitten) / initial : undefined;
      return <tr key={index}><th scope="row">{index === 0 ? 'A' : 'B'} · {algorithmLabels[row.input.config?.evacuation_algorithm ?? 'legacy_current']}</th><td>{row.state ? `${row.state.status} / ${row.state.tick}` : row.metadata ? 'Preparando estado' : 'Pendiente'}</td><td>{survival !== undefined ? <><meter min={0} max={1} value={survival} aria-label={`Supervivencia ${index === 0 ? 'A' : 'B'}`} />{(100 * survival).toFixed(1)}%</> : 'Sin datos'}</td><td>{metrics?.evacuated ?? '—'}</td><td>{metrics?.bitten ?? '—'}</td><td>{metrics && metrics.requests_success + metrics.requests_invalid + metrics.requests_timeout > 0 ? `${metrics.http_p50_ms.toFixed(1)} / ${metrics.http_p95_ms.toFixed(1)} / ${metrics.http_p99_ms.toFixed(1)} ms` : 'Sin medición'}</td><td>{metrics ? `${metrics.requests_invalid} / ${metrics.requests_timeout}` : '—'}</td><td>{analytics ? `${analytics.mean_arrival_turn.toFixed(1)} turnos / ${analytics.mean_route_efficiency.toFixed(2)}` : 'Sin datos'}</td><td>{analytics ? `${analytics.replans} / ${analytics.oscillations}` : 'Sin datos'}</td><td>{analytics ? `${analytics.prediction.hits} / ${analytics.prediction.misses} · Brier ${analytics.prediction.brier_score.toFixed(3)}` : 'Sin datos'}</td><td>{fleet ? `${fleet.pickups} / ${fleet.delivered}` : 'Desactivada'}</td><td>{row.state?.snapshot.shelters.map(sh => `${sh.id}: ${sh.occupancy}/${sh.capacity} (+${sh.reserved} reservadas)`).join(' · ') || 'Sin datos'}</td></tr>;
    })}</tbody></table></div>
    <p>Supervivencia incluye agentes activos; los pasajeros sólo cuentan como evacuados tras su entrega. Las métricas parciales pueden cambiar hasta finalizar. Los tiempos HTTP no forman parte de la comparación determinista. Las credenciales de estas ejecuciones sólo permanecen en memoria; al cerrar la página caducarán según los límites del servidor.</p>
    <div className="comparison-controls"><Button variant="secondary" onClick={() => saveFile(JSON.stringify({ schema_version: 1, execution: 'real_http_sequential', results: exportRows }, null, 2), 'application/json', 'corodev-comparison.json')}>Exportar JSON</Button><Button variant="secondary" onClick={() => saveFile(comparisonCSV(exportRows), 'text/csv;charset=utf-8', 'corodev-comparison.csv')}>Exportar CSV</Button></div></>}
  </details>;
}
