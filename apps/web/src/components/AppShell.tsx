import { Ghost, MapPinned, Menu, PanelLeftClose, PanelLeftOpen, RotateCw, Waves, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link, Outlet, useLocation, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { brand } from '@corodev/design-tokens/brand';
import { useFloodState } from '../services/queries';
import { api, ApiError } from '../services/api';
import { StatusIndicator } from './ui';

export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const sidebar = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const restoreMenuFocus = useRef(false);
  const client = useQueryClient();
  const cache = client.getQueryCache();
  // Observe the existing executor cache; the shell never starts another polling clock.
  const capabilities = useQuery({ queryKey: ['simulation-capabilities'], queryFn: ({ signal }) => api.simulationCapabilities(signal), enabled: false });
  const flood = useFloodState(false);
  const [search] = useSearchParams();
  const location = useLocation();
  const floodSelected = search.get('scenario') === 'urban_flood' || location.pathname === '/flood-lab';
  const sessionHealth = useSyncExternalStore(useCallback(listener => cache.subscribe(listener), [cache]), () => {
    const failed = cache.findAll({ queryKey: ['simulation-session'] }).find(query => query.queryKey[2] === 'state' && query.state.status === 'error'
      && !(query.state.error instanceof ApiError && [401, 403, 404, 410].includes(query.state.error.status ?? 0)));
    return failed ? failed.state.data ? 'degraded' : 'offline' : 'online';
  });
  const active = floodSelected ? flood : capabilities;
  const status = active.isError ? active.data ? 'degraded' : 'offline' : active.isPending ? 'checking' : !floodSelected ? sessionHealth : 'online';
  const retry = () => {
    void active.refetch();
    if (!floodSelected) void client.refetchQueries({ queryKey: ['simulation-session'], predicate: query => query.queryKey[2] === 'state' });
  };
  const closeMenu = () => { restoreMenuFocus.current = true; setMenuOpen(false); };
  useEffect(() => {
    if (!menuOpen) { if (restoreMenuFocus.current) { menuButton.current?.focus(); restoreMenuFocus.current = false; } return; }
    closeButton.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { restoreMenuFocus.current = true; setMenuOpen(false); }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(sidebar.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? []).filter(element => element.getClientRects().length > 0);
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    const onResize = () => { if (window.innerWidth > 760) setMenuOpen(false); };
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('resize', onResize); window.removeEventListener('keydown', onKey); document.body.style.overflow = previousOverflow; };
  }, [menuOpen]);
  const links = [
    { to: '/escape', name: 'Escape Manta Zombie', Icon: Ghost, active: !floodSelected, tone: 'zombie' },
    { to: '/flood-lab', name: 'Escape Manta Inundación', Icon: Waves, active: floodSelected, tone: 'flood' },
  ];
  return <div className={`app-shell mantasim-shell ${collapsed ? 'sidebar-collapsed' : ''} ${menuOpen ? 'navigation-open' : ''}`}>
    <a className="skip-link" href="#main-content">Saltar al contenido</a>
    {menuOpen && <button className="sidebar-backdrop" aria-label="Cerrar navegación" onClick={closeMenu} />}
    <aside ref={sidebar} id="scenario-navigation" className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`} aria-label="Navegación principal">
      <div className="sidebar-brand-row"><Link to="/escape" className="brand" aria-label={`${brand.webName}, inicio`} onClick={() => setMenuOpen(false)}><span className="brand-symbol"><MapPinned size={23} aria-hidden="true" /></span><span className="brand-name">{brand.webName}<small>{brand.team}</small></span></Link>
        <button ref={closeButton} className="icon-button sidebar-close" aria-label="Cerrar menú" onClick={closeMenu}><X size={20} /></button></div>
      <p className="sidebar-description">{brand.webSubtitle}</p>
      <p className="nav-label">ESCENARIOS</p>
      <nav aria-label="Escenarios">{links.map(({ to, name, Icon, active: selected, tone }) => <Link key={to} to={to} aria-label={name} aria-current={selected ? 'page' : undefined} title={collapsed ? name : undefined} onClick={() => setMenuOpen(false)} className={`nav-item nav-${tone} ${selected ? 'nav-item-active' : ''}`}><Icon size={21} strokeWidth={1.75} aria-hidden="true" /><span className="nav-item-label">{name}</span><span className="nav-tooltip" aria-hidden="true">{name}</span></Link>)}</nav>
      <div className="sidebar-bottom"><button className="sidebar-toggle" aria-label={collapsed ? 'Expandir barra lateral' : 'Colapsar barra lateral'} aria-expanded={!collapsed} aria-controls="scenario-navigation" onClick={() => setCollapsed(value => !value)}>{collapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}<span>Colapsar barra</span></button><p className="sidebar-credit">{brand.webCredit}</p></div>
    </aside>
    <div className="shell-api-status" role="status" aria-live="polite"><StatusIndicator compact status={status} />{(status === 'offline' || status === 'degraded') && <button className="icon-button" aria-label="Reintentar conexión de API" title="Reintentar conexión de API" onClick={retry}><RotateCw size={15} /></button>}</div>
    <div className="app-body" inert={menuOpen || undefined}><header className="topbar"><div className="breadcrumb"><button ref={menuButton} className="icon-button mobile-menu" aria-label="Abrir menú" aria-controls="scenario-navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><Menu size={22} /></button><span className="breadcrumb-workspace">{brand.webName}</span><span className="breadcrumb-slash">/</span><strong>{floodSelected ? 'Inundación urbana' : 'Brote zombi'}</strong></div><span className={`scenario-tag ${floodSelected ? 'scenario-tag-flood' : 'scenario-tag-zombie'}`}>{floodSelected ? <Waves size={15} /> : <Ghost size={15} />}<span>{floodSelected ? 'Datos sintéticos' : 'Simulación experimental'}</span></span></header>
      <main id="main-content" tabIndex={-1}><Outlet /></main>
      <footer className="app-footer"><div><strong>{brand.webName} · {brand.team}</strong><p>{brand.webLimits}</p></div><details className="footer-sources"><summary>Datos y fuentes</summary><p>Geografía: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>. Los refugios son experimentales y no representan sitios oficiales de evacuación. Las referencias territoriales y los reportes ciudadanos conservan su procedencia en las herramientas de cada mapa; no describen una inundación actual.</p></details></footer>
    </div>
  </div>;
}
