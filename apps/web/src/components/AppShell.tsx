import { MapPinned, Activity, ArrowUpRight, Box, ChevronDown, Cloud, Command, FilePlus2, HelpCircle, LayoutDashboard, Menu, Search, Sparkles, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { brand } from '@corodev/design-tokens/brand';
import { config } from '../lib/config';
import { useHealth, useWorld } from '../services/queries';
import { StatusIndicator } from './ui';

const navigation = [
  { to: '/', label: 'Resumen', icon: LayoutDashboard },
  { to: '/escape', label: 'Escape de Manta', icon: MapPinned },
  { to: '/items', label: 'Elementos', icon: Box },
  { to: '/demo', label: 'Formulario demo', icon: FilePlus2 },
  { to: '/diagnostics', label: 'Diagnóstico', icon: Activity },
];

export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const isEscape = location.pathname.startsWith('/escape');
  const demoHealth = useHealth(!isEscape);
  const world = useWorld(isEscape);
  const health = isEscape ? world : demoHealth;
  const status = health.isPending ? 'checking' : health.isError ? 'offline' : 'online';
  const current = navigation.find(item => item.to === location.pathname || (item.to !== '/' && location.pathname.startsWith(item.to))) ?? navigation[0]!;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); navigate('/items'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);
  return <div className="app-shell"><a className="skip-link" href="#main-content">Saltar al contenido</a>
    {menuOpen && <button className="sidebar-backdrop" aria-label="Cerrar navegación" onClick={() => setMenuOpen(false)} />}
    <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`} aria-label="Navegación principal">
      <Link to="/" className="brand" onClick={() => setMenuOpen(false)}><span className="brand-symbol"><Cloud size={23} strokeWidth={2} /><span /></span><span>{brand.team}<span className="brand-dot">.</span></span></Link>
      <button className="icon-button sidebar-close" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)}><X size={20} /></button>
      <div className="workspace-switch"><span className="workspace-icon"><Sparkles size={17} /></span><span><strong>{brand.name}</strong><small>Demo workspace</small></span><ChevronDown size={14} className="muted" /></div>
      <p className="nav-label">WORKSPACE</p>
      <nav>{navigation.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === '/'} onClick={() => setMenuOpen(false)} className={({ isActive }) => `nav-item ${isActive ? 'nav-item-active' : ''}`}><Icon size={19} strokeWidth={1.75} /><span>{label}</span>{to === '/demo' && <span className="nav-tag">DEMO</span>}</NavLink>)}</nav>
      <div className="sidebar-bottom"><div className="build-card"><span className="build-card-icon"><Cloud size={22} /></span><strong>Listo para lo que viene.</strong><p>Una base. Muchas posibilidades.</p><Link to="/diagnostics" onClick={() => setMenuOpen(false)}>Explorar el entorno <ArrowUpRight size={14} /></Link></div>
        <Link className="help-link" to="/diagnostics" onClick={() => setMenuOpen(false)}><HelpCircle size={17} />Ayuda y diagnóstico<ArrowUpRight size={14} /></Link>
        <div className="sidebar-environment"><StatusIndicator compact status={status} /><span>{config.apiMode === 'mock' ? 'LOCAL' : 'REMOTE'}</span></div></div>
    </aside>
    <div className="app-body"><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Abrir menú" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><Menu size={22} /></button><span className="breadcrumb-workspace">Workspace</span><span className="breadcrumb-slash">/</span><strong>{current.label}</strong></div>
      <div className="topbar-actions"><button className="global-search" onClick={() => navigate('/items')} aria-label="Buscar elementos"><Search size={16} /><span>Buscar…</span><kbd><Command size={11} /> K</kbd></button><span className="topbar-status"><StatusIndicator compact status={status} /></span><div className="avatar" aria-label="Equipo CoroDev">CD</div></div></header>
      <main id="main-content" tabIndex={-1}><Outlet /></main>
      <footer className="app-footer"><span>Hecho para empezar. Preparado para evolucionar.</span><span><span className="footer-dot" />{brand.team} <span className="muted">/</span> v{brand.version}</span></footer>
    </div></div>;
}
