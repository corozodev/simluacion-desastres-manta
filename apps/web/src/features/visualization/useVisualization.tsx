import { useEffect, useState } from 'react';
import type { Observation } from './model';
import './visualization.css';

export function useVisualization(observation?: Observation) {
  const [animations, setAnimations] = useState(true);
  const [clustering, setClustering] = useState(true);
  const [reduced, setReduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  const [visible, setVisible] = useState(() => !document.hidden);
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const motion = () => setReduced(media?.matches ?? false);
    const visibility = () => setVisible(!document.hidden);
    const connectivity = () => setOnline(navigator.onLine);
    window.addEventListener('online', connectivity); window.addEventListener('offline', connectivity);
    media?.addEventListener('change', motion); document.addEventListener('visibilitychange', visibility);
    return () => { media?.removeEventListener('change', motion); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('online', connectivity); window.removeEventListener('offline', connectivity); };
  }, []);
  return { animations, setAnimations, clustering, setClustering, reduced, active: animations && !reduced && visible && online && Boolean(observation?.running && observation.connected) };
}
export function VisualizationControls({ controls }: { controls: ReturnType<typeof useVisualization> }) {
  return <fieldset className="visual-controls"><legend>Visualización</legend><label><input type="checkbox" checked={controls.animations} onChange={e => controls.setAnimations(e.target.checked)} />Animaciones</label><label><input type="checkbox" checked={controls.clustering} onChange={e => controls.setClustering(e.target.checked)} />Agrupación automática</label>{controls.reduced && <span>Movimiento reducido: efectos detenidos</span>}<span>Los contadores agrupan entidades observadas; no estiman población.</span></fieldset>;
}
