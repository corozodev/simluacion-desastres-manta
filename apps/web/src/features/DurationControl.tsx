import { Button } from '../components/ui';

/** Bounds come from the server; presets only prepare the next explicit run. */
export function DurationControl({ label = 'Duración de la simulación', value, min, max, official = false, disabled = false, onChange }: { label?: string; value: string; min: number; max: number; official?: boolean; disabled?: boolean; onChange: (value: string) => void }) {
  return <div className="duration-control">
    <label>{label}<input aria-label={label} type="number" required min={official ? 150 : min} max={official ? 150 : max} step="1" value={official ? '150' : value} disabled={official || disabled} onChange={event => onChange(event.target.value)} /><small>{official ? 'Preset oficial · 150 turnos, 2 s por turno, cinco minutos.' : `${min.toLocaleString('es-EC')}–${max.toLocaleString('es-EC')} turnos. Se aplica al iniciar.`}</small></label>
    {!official && <div className="duration-presets" role="group" aria-label="Duraciones rápidas">{[150, 300, 600, 1200].filter(turns => turns >= min && turns <= max).map(turns => <Button type="button" key={turns} variant="secondary" disabled={disabled} aria-pressed={Number(value) === turns} onClick={() => onChange(String(turns))}>{turns} turnos</Button>)}</div>}
  </div>;
}
