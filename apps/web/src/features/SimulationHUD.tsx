import type { ReactNode } from 'react';
import './simulation-hud.css';

/** Presentation only: progress is always taken from the last server snapshot. */
export function SimulationHUD({ label = 'Estado de simulación', status, tick, maxTicks, elapsed, children, progressLabel = 'Turno' }: { label?: string; status: string; tick?: number; maxTicks?: number; elapsed?: string; progressLabel?: string; children?: ReactNode }) {
  const progress = tick !== undefined && maxTicks !== undefined && maxTicks > 0;
  return <div className="simulation-hud" role="group" aria-label={label}>
    <div className="hud-state"><strong>{status}</strong>{progress && <><span>{progressLabel} {tick}/{maxTicks}{elapsed ? ` · ${elapsed}` : ''}</span><progress aria-label="Progreso de simulación" value={tick} max={maxTicks} /></>}</div>
    <div className="hud-actions">{children}</div>
  </div>;
}

export function MetricsOverlay({ items }: { items: { label: string; value: ReactNode; detail?: string }[] }) {
  return <details className="hud-metrics" open><summary>Métricas</summary><dl>{items.map(item => <div key={item.label} title={item.detail}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl></details>;
}
