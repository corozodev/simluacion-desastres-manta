import { lazy, Suspense } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { LoadingState } from '../components/ui';
import { Escape } from './Escape';

const FloodLab = lazy(() => import('./flood/FloodLab').then(module => ({ default: module.FloodLab })));

export function ScenarioScreen() {
  const [search, setSearch] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const scenario = search.get('scenario') === 'urban_flood' || location.pathname === '/flood-lab' ? 'urban_flood' : 'zombie';
  if (scenario === 'zombie') return <><Escape /><p className="session-lab-link"><Link to="/flood-lab">Abrir laboratorio avanzado de inundaciones</Link></p></>;
  return <>
    <section className="scenario-selector" aria-label="Selección de escenario">
      <label><span>ESCENARIOS</span><select aria-label="Escenarios" value={scenario} onChange={event => {
        if (event.target.value !== 'urban_flood' && location.pathname === '/flood-lab') { navigate('/escape'); return; }
        const next = new URLSearchParams(search);
        if (event.target.value === 'urban_flood') next.set('scenario', 'urban_flood');
        else next.delete('scenario');
        setSearch(next);
      }}><option value="zombie">Apocalipsis zombi</option><option value="urban_flood">Inundaciones urbanas</option></select></label>
      {scenario === 'urban_flood' && <strong className="scenario-synthetic">SIMULACIÓN — DATOS SINTÉTICOS</strong>}
    </section>
    {scenario === 'urban_flood' ? <Suspense fallback={<LoadingState label="Abriendo laboratorio de inundaciones…" />}><FloodLab /></Suspense> : <Escape />}
  </>;
}
