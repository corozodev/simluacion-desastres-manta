import { lazy, Suspense } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { LoadingState } from '../components/ui';
import { Escape } from './Escape';

const FloodLab = lazy(() => import('./flood/FloodLab').then(module => ({ default: module.FloodLab })));

export function ScenarioScreen() {
  const [search] = useSearchParams();
  const location = useLocation();
  const flood = search.get('scenario') === 'urban_flood' || location.pathname === '/flood-lab';
  return flood ? <Suspense fallback={<LoadingState label="Abriendo laboratorio de inundaciones…" />}><FloodLab /></Suspense> : <Escape />;
}
