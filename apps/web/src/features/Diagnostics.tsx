import { Activity, ArrowUpRight, CheckCircle2, Cloud, Copy, Globe2, Info, LoaderCircle, RefreshCw, Server, Terminal } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { brand } from '@corodev/design-tokens/brand';
import { Badge, Button, Card, ErrorState, PageHeader, StatusIndicator } from '../components/ui';
import { config } from '../lib/config';
import { useHealth } from '../services/queries';

export function Diagnostics() {
  const health = useHealth();
  const [copyState, setCopyState] = useState('Copiar URL');
  const status = health.isPending ? 'checking' : health.isError ? 'offline' : 'online';
  const copyUrl = async () => {
    try { await navigator.clipboard.writeText(config.apiBaseUrl); setCopyState('URL copiada'); }
    catch { setCopyState('Selecciona la URL para copiar'); }
    setTimeout(() => setCopyState('Copiar URL'), 2500);
  };
  return <div className="page"><PageHeader eyebrow="CONOCE TU ENTORNO" title="Todo bajo control." description="La configuración efectiva y el estado real de tu conexión, en un solo lugar." action={<Button variant="secondary" onClick={() => void health.refetch()} disabled={health.isFetching}><RefreshCw size={16} className={health.isFetching ? 'spin' : ''} />Comprobar conexión</Button>} />
    <div className="diagnostic-connection"><span className={`diagnostic-status-icon ${health.isSuccess ? 'diagnostic-online' : ''}`}>{health.isFetching ? <LoaderCircle size={25} className="spin" /> : health.isSuccess ? <CheckCircle2 size={25} /> : <Activity size={25} />}</span><div><h2>{health.isPending ? 'Comprobando el servidor…' : health.isSuccess ? 'Tu API está respondiendo.' : 'No pudimos conectar con la API.'}</h2><p>{health.isSuccess ? 'Respuesta verificada mediante una petición HTTP a /health.' : 'Comprueba la URL, la conexión y que el servidor esté iniciado.'}</p></div><StatusIndicator status={status} /></div>
    <div className="diagnostic-grid"><Card className="diagnostic-card"><div className="section-heading"><div className="heading-with-icon"><Globe2 size={20} /><h2>Configuración del cliente</h2></div><Badge tone="purple">WEB</Badge></div><dl className="diagnostic-properties"><div><dt>Modo de API</dt><dd><Badge tone={config.apiMode === 'mock' ? 'warning' : 'cyan'}>{config.apiMode.toUpperCase()}</Badge><span className="muted">{config.apiMode === 'mock' ? 'Servidor mock por HTTP' : 'Endpoint remoto'}</span></dd></div><div><dt>URL base efectiva</dt><dd className="url-value"><code>{config.apiBaseUrl || 'Configuración no válida'}</code>{config.apiBaseUrl && <button className="icon-button" aria-label={copyState} onClick={() => void copyUrl()}><Copy size={15} /></button>}</dd></div><div><dt>Timeout de solicitud</dt><dd>{config.timeoutMs / 1000} segundos</dd></div><div><dt>Versión del cliente</dt><dd><code>v{brand.version}</code></dd></div></dl><div className="diagnostic-note"><Info size={15} />Las variables VITE_ son públicas. Configura solo valores no sensibles.</div></Card>
      <Card className="diagnostic-card"><div className="section-heading"><div className="heading-with-icon"><Server size={20} /><h2>Servidor HTTP</h2></div><Badge tone={health.isSuccess ? 'success' : 'neutral'}>{health.isSuccess ? 'ONLINE' : health.isPending ? 'CHECKING' : 'OFFLINE'}</Badge></div><dl className="diagnostic-properties"><div><dt>Servicio</dt><dd><code>{health.data?.service ?? '—'}</code></dd></div><div><dt>Versión de API</dt><dd><code>{health.data ? `v${health.data.version}` : '—'}</code></dd></div><div><dt>Endpoint de salud</dt><dd><code>GET /health</code></dd></div><div><dt>Última comprobación</dt><dd>{health.dataUpdatedAt > 0 ? new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(health.dataUpdatedAt) : 'Sin respuesta correcta'}</dd></div></dl><div className="diagnostic-note"><span className="note-dot" />Se comprueba automáticamente cada 30 segundos.</div></Card></div>
    {health.isError && <Card className="diagnostic-error"><ErrorState error={health.error} onRetry={() => void health.refetch()} /></Card>}
    <Card className="connection-guide"><div><span className="guide-icon icon-orange"><Terminal size={24} /></span><h2>Del entorno local a tu próxima API.</h2><p>Cambia la URL, conserva el contrato. Tu cliente ya sabe qué hacer.</p></div><div className="connection-code"><span>apps/web/.env.local</span><code>VITE_API_MODE=remote<br />VITE_API_BASE_URL=https://api.example.com</code></div><div className="guide-footer"><p><Cloud size={16} />Compatible con una futura API en AWS. Reinicia Vite al cambiar las variables.</p><Link to="/items" className="text-link">Probar los datos<ArrowUpRight size={15} /></Link></div></Card>
  </div>;
}
