import { Cloud, MapPinned, Menu, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { brand } from '@corodev/design-tokens/brand';
import { useFloodState } from '../services/queries';
import { api } from '../services/api';
import { StatusIndicator } from './ui';

export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  // The shell observes the executor's cache without a second polling clock.
  const capabilities = useQuery({ queryKey: ['simulation-capabilities'], queryFn: ({ signal }) => api.simulationCapabilities(signal), enabled: false });
  const flood = useFloodState(false);
  const [search] = useSearchParams();
  const location = useLocation();
  const floodSelected = search.get('scenario') === 'urban_flood' || location.pathname === '/flood-lab';
  const active = floodSelected ? flood : capabilities;
  const status = active.isError ? 'offline' : active.isPending ? 'checking' : 'online';
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return <div className="app-shell"><a className="skip-link" href="#main-content">Saltar al contenido</a>
    {menuOpen && <button className="sidebar-backdrop" aria-label="Cerrar navegación" onClick={() => setMenuOpen(false)} />}
    <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`} aria-label="Navegación principal">
      <Link to="/escape" className="brand" onClick={() => setMenuOpen(false)}><span className="brand-symbol"><Cloud size={23} strokeWidth={2} /><span /></span><span>{brand.team}<span className="brand-dot">.</span></span></Link>
      <button className="icon-button sidebar-close" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)}><X size={20} /></button>
      <div className="workspace-switch"><span className="workspace-icon"><MapPinned size={17} /></span><span><strong>Escape de Manta</strong><small>Observación de evacuación</small></span></div>
      <p className="nav-label">EVACUACIÓN</p>
      <nav><NavLink to="/escape" onClick={() => setMenuOpen(false)} className={({ isActive }) => `nav-item ${isActive ? 'nav-item-active' : ''}`}><MapPinned size={19} strokeWidth={1.75} /><span>Escape de Manta</span></NavLink></nav>
      <div className="sidebar-bottom"><div className="build-card"><span className="build-card-icon"><Cloud size={22} /></span><strong>Estado observable.</strong><p>Mapa, turnos y rutas publicados por el servicio de evacuación.</p></div><div className="sidebar-environment"><StatusIndicator compact status={status} /></div></div>
    </aside>
    <div className="app-body"><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Abrir menú" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><Menu size={22} /></button><span className="breadcrumb-workspace">CoroDev</span><span className="breadcrumb-slash">/</span><strong>Escape de Manta</strong></div>
      <div className="topbar-actions"><span className="topbar-status"><StatusIndicator compact status={status} /></span><div className="avatar" aria-label="Equipo CoroDev">CD</div></div></header>
      <main id="main-content" tabIndex={-1}><Outlet /></main>
      <footer className="app-footer"><span>Simulaciones independientes de evacuación bajo demanda.</span><span><span className="footer-dot" />{brand.team} <span className="muted">/</span> v{brand.version}</span></footer>
    </div></div>;
}
