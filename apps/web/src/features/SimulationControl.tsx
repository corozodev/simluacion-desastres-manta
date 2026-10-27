import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SimulationInfo } from '@corodev/contracts';
import { api } from '../services/api';
import { Badge, Button, Card, ErrorState, LoadingState } from '../components/ui';

export function SimulationControl({ info, selection, onSelect }: { info: SimulationInfo; selection: string; onSelect: (mode: string) => void }) {
  const client = useQueryClient();
  const catalog = useQuery({ queryKey: ['simulation-catalog'], queryFn: ({ signal }) => api.catalog(signal), retry: false, staleTime: 60_000 });
  const session = useQuery({ queryKey: ['operator-session'], queryFn: ({ signal }) => api.session(signal), enabled: catalog.data?.admin_enabled === true, retry: false, refetchInterval: 60_000 });
  const [operator, setOperator] = useState('');
  const code = useRef<HTMLInputElement>(null);
  const [round, setRound] = useState(info.round);
  const [seed, setSeed] = useState(String(info.seed));
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['world'] });
    void client.invalidateQueries({ queryKey: ['operator-session'] });
  };
  const login = useMutation({ mutationFn: () => {
    const accessCode = code.current?.value ?? '';
    if (code.current) code.current.value = '';
    return api.login(operator, accessCode);
  }, onSuccess: state => client.setQueryData(['operator-session'], state) });
  const logout = useMutation({ mutationFn: () => api.logout(session.data?.csrf_token ?? ''), onSuccess: state => client.setQueryData(['operator-session'], state), onError: refresh });
  const start = useMutation({ mutationFn: () => api.startRun({ mode: selection as SimulationInfo['mode'], round: round as SimulationInfo['round'], seed: Number(seed), expected_run_id: info.run_id }, session.data?.csrf_token ?? ''), onSuccess: refresh, onError: refresh });
  const active = info.state === 'running' || info.state === 'starting';
  const preset = catalog.data?.presets.find(p => p.id === selection);
  const activePreset = catalog.data?.presets.find(p => p.id === info.mode);
  const busy = start.isPending || login.isPending || logout.isPending;
  const validSeed = seed.trim() !== '' && Number.isSafeInteger(Number(seed));
  const error = login.error ?? start.error ?? logout.error;
  const states = { idle: 'Lista para iniciar', starting: 'Preparando', running: 'En ejecución', finished: 'Finalizada', failed: 'Interrumpida' };
  return <Card className="escape-map-card simulation-control" aria-label="Control de simulación">
    <div className="section-heading"><div><h2>Cobertura de simulación</h2><p>Activa: {activePreset?.name ?? info.mode} · {activePreset ? `${activePreset.nodes.toLocaleString('es-EC')} nodos / ${activePreset.edges.toLocaleString('es-EC')} aristas` : info.graph_version}</p></div><Badge tone={active ? 'success' : 'neutral'}>{states[info.state]}</Badge></div>
    <p>{activePreset?.coverage} · Ronda: {info.round} · Semilla: {info.seed}</p>
    {info.failure && <p role="alert">{info.failure}</p>}
    {catalog.isPending ? <LoadingState label="Consultando coberturas…" /> : catalog.isError ? <ErrorState error={catalog.error} onRetry={() => void catalog.refetch()} /> : <>
      <label className="escape-search">Previsualizar cobertura<select value={selection} onChange={event => onSelect(event.target.value)}>{catalog.data.presets.map(p => <option key={p.id} value={p.id} disabled={!p.preview_available}>{p.name}</option>)}</select></label>
      <p>{preset?.coverage}</p>
      {selection !== info.mode && <p role="status"><strong>Previsualización.</strong> Este mapa no está activo. No muestra posiciones ni rutas de la ronda actual.</p>}
      {preset && !preset.enabled && <p className="muted">{preset.disabled_reason} Puedes previsualizar su geografía.</p>}
      {!session.data?.authenticated ? <>
        <p>Visita pública: solo lectura. Previsualizar no cambia la simulación.</p>
        {catalog.data.admin_enabled ? <details><summary>Acceso de operador</summary><form className="simulation-form" onSubmit={event => { event.preventDefault(); login.mutate(); }}>
          <label>Operador<input autoComplete="username" value={operator} maxLength={64} required onChange={event => setOperator(event.target.value)} /></label>
          <label>Código de acceso<input ref={code} type="password" autoComplete="off" minLength={43} maxLength={43} required /></label>
          <Button type="submit" disabled={busy}>Acceder</Button>
        </form></details> : <p className="muted">Administración deshabilitada en esta instancia.</p>}
      </> : <form className="simulation-form" onSubmit={event => { event.preventDefault(); if (validSeed && !active && preset?.enabled) start.mutate(); }}>
        <p>Operador: {session.data.operator} · sesión hasta {new Date(session.data.expires_at!).toLocaleTimeString()}</p>
        <label>Ronda<select value={round} disabled={active || busy} onChange={event => { setRound(event.target.value as SimulationInfo['round']); }}>{catalog.data.rounds.map(r => <option key={r.id} value={r.id}>{r.survivors} sobrevivientes · {r.turns} turnos</option>)}</select></label>
        <label>Semilla<input type="number" step="1" min="-9007199254740991" max="9007199254740991" required value={seed} disabled={active || busy} onChange={event => setSeed(event.target.value)} /></label>
        <p>Se iniciará <strong>{preset?.name}</strong>. Cada ronda dura 150 turnos de 2 segundos en producción. Las últimas {catalog.data.history_limit} rondas finalizadas se conservan en memoria hasta reiniciar el servidor.</p>
        {active && <p role="status">Espera a que termine la ronda activa para iniciar otra.</p>}
        <Button type="submit" disabled={active || busy || !preset?.enabled || !validSeed}>Iniciar ronda seleccionada</Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => logout.mutate()}>Cerrar sesión</Button>
      </form>}
      {session.isError && <ErrorState error={session.error} onRetry={() => void session.refetch()} />}
      {error && <ErrorState error={error} />}
    </>}
  </Card>;
}
