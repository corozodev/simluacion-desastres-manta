import { ArrowRight, ArrowUpRight, Box, Braces, Check, Cloud, Code2, FilePlus2, Radio, Sparkles, Terminal } from 'lucide-react';
import { Link } from 'react-router-dom';
import { brand } from '@corodev/design-tokens/brand';
import { Badge, Card, EmptyState, ErrorState, LoadingState, PageHeader } from '../components/ui';
import { ItemList } from '../components/ItemList';
import { useHealth, useItems } from '../services/queries';
import { config } from '../lib/config';

function CloudIllustration() {
  return <div className="cloud-scene" aria-hidden="true"><div className="scene-grid" /><div className="scene-orbit orbit-one" /><div className="scene-orbit orbit-two" /><div className="scene-spark spark-one">+</div><div className="scene-spark spark-two">+</div><div className="scene-spark spark-three">✧</div>
    <div className="cloud-platform"><div className="cloud-platform-inner"><Cloud size={116} strokeWidth={1.15} /><span className="cloud-code"><Code2 size={35} /></span></div></div>
    <span className="floating-tile floating-tile-code"><Braces size={25} /></span><span className="floating-tile floating-tile-box"><Box size={22} /></span>
    <div className="scene-terminal"><div className="terminal-top"><span /><span /><span /><small>corodev / starter</small></div><div><span className="terminal-arrow">❯</span> ready to build<span className="terminal-cursor" /></div></div>
    <span className="scene-caption"><span /> Las grandes ideas empiezan aquí</span>
  </div>;
}

export function Overview() {
  const items = useItems(1, 4);
  const health = useHealth();
  const connected = health.isSuccess;
  const [firstTitle, ...restTitle] = brand.overviewTitle.split('. ');
  return <div className="page overview-page"><PageHeader eyebrow="TU WORKSPACE, LISTO" title={`Hola, ${brand.team} 👋`} description={brand.subtitle} action={<span className="workspace-badge"><span />Entorno de demostración</span>} />
    <section className="hero-card" aria-labelledby="hero-title"><div className="hero-copy"><div className="hero-label"><Sparkles size={14} /><span>MENOS SETUP. MÁS IDEAS.</span></div><h2 id="hero-title">{firstTitle}{restTitle.length > 0 && '.'}<br /><span>{restTitle.join('. ')}</span></h2><p>{brand.description}</p><div className="hero-actions"><Link to="/items" className="button button-primary">Explorar elementos<ArrowRight size={17} /></Link><Link to="/demo" className="hero-secondary">Probar formulario<ArrowUpRight size={16} /></Link></div><div className="hero-footnote"><span className="small-check"><Check size={11} /></span>React + Flutter<span className="footnote-divider" />Un mismo contrato HTTP</div></div><CloudIllustration /></section>
    <div className="summary-grid"><Card className="summary-card"><div className="summary-top"><span className="summary-icon icon-orange"><Box size={20} /></span><span className="summary-label">Datos de demostración</span><Link to="/items" aria-label="Ver todos los elementos"><ArrowUpRight size={17} /></Link></div><div className="summary-value">{items.isSuccess ? String(items.data.pagination.total).padStart(2, '0') : '—'}<span>elementos</span></div><p>Un punto de partida para explorar la API.</p></Card>
      <Card className="summary-card"><div className="summary-top"><span className="summary-icon icon-cyan"><Radio size={20} /></span><span className="summary-label">Conexión con la API</span><Link to="/diagnostics" aria-label="Ver diagnóstico de conexión"><ArrowUpRight size={17} /></Link></div><div className="summary-value summary-value-text">{health.isPending ? 'Conectando' : connected ? 'Todo conectado' : 'Sin conexión'}<span className={`inline-status ${connected ? 'inline-online' : ''}`} /></div><p>{connected ? `${health.data.service} · v${health.data.version}` : health.isPending ? 'Comprobando el servidor HTTP…' : 'Revisa el servidor en Diagnóstico.'}</p></Card>
      <Card className="summary-card"><div className="summary-top"><span className="summary-icon icon-purple"><Braces size={20} /></span><span className="summary-label">Un contrato, dos clientes</span><Badge tone="purple">OpenAPI</Badge></div><div className="summary-value summary-value-text">Web <span className="plus-symbol">+</span> Mobile</div><p>La misma base. La experiencia de cada plataforma.</p></Card></div>
    <div className="overview-bottom"><Card className="recent-card"><div className="section-heading"><div><h2>Explora los elementos</h2><p>Datos de ejemplo. Posibilidades reales.</p></div><Link to="/items" className="text-link">Ver todos<ArrowRight size={15} /></Link></div>
      {items.isPending ? <LoadingState /> : items.isError ? <ErrorState error={items.error} onRetry={() => void items.refetch()} /> : items.data.data.length === 0 ? <EmptyState /> : <ItemList items={items.data.data} compact />}
      <div className="list-note"><span className="note-dot" />Datos determinísticos servidos por HTTP<span className="muted">GET /v1/demo/items</span></div></Card>
      <Card className="next-card"><div className="next-card-top"><span className="icon-orange"><Terminal size={19} /></span><Badge>QUICK START</Badge></div><h2>Hazlo tuyo.</h2><p>Una base pequeña para construir algo grande. Empieza probando el flujo completo.</p><ol className="quick-steps"><li><span>01</span><div><strong>Explora los datos</strong><small>Busca, navega y abre un detalle.</small></div></li><li><span>02</span><div><strong>Prueba una idea</strong><small>Envía tu primer formulario.</small></div></li><li><span>03</span><div><strong>Conecta tu API</strong><small>{config.apiMode === 'mock' ? 'Hoy local. Luego, donde lo necesites.' : 'Tu endpoint remoto ya está configurado.'}</small></div></li></ol><Link to="/demo" className="button button-secondary">Crear un envío demo<FilePlus2 size={16} /></Link></Card></div>
    <div className="overview-footer"><Cloud size={15} /><span>Tu próxima solución aún no tiene límites.</span><span className="overview-footer-line" /><span>Construyamos desde aquí.</span></div>
  </div>;
}
