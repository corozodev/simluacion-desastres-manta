import type { LabRunConfig } from '@corodev/contracts';

type Hydrology = NonNullable<LabRunConfig['hydrology']>;
export const hydrologyDefaults = {
  seconds_per_turn: 60, antecedent_rain_hours: 0, initial_saturation: 0, initial_water_depth_m: 0,
  sea_level_m: 0, channel_inflow_m3_s: 0, cell_size_m: 200, infiltration_mm_h: 8, drainage_mm_h: 6,
  caution_depth_m: .1, blocked_depth_m: .3, hysteresis_m: .03,
} satisfies Hydrology;

const controls = [
  ['antecedent_rain_hours', 'Lluvia antecedente (horas)', 0, 24, .25],
  ['initial_saturation', 'Saturación inicial (0–1)', 0, 1, .05],
  ['initial_water_depth_m', 'Profundidad inicial sintética (m)', 0, 2, .01],
  ['seconds_per_turn', 'Tiempo hidrológico por turno (s)', 1, 300, 1],
  ['cell_size_m', 'Resolución de malla solicitada (m)', 50, 1000, 50],
  ['infiltration_mm_h', 'Infiltración máxima (mm/h)', 0, 100, 1],
  ['drainage_mm_h', 'Capacidad de drenaje (mm/h)', 0, 100, 1],
  ['caution_depth_m', 'Profundidad de precaución vial (m)', .01, 1, .01],
  ['blocked_depth_m', 'Profundidad de bloqueo vial (m)', .02, 2, .01],
  ['hysteresis_m', 'Histéresis de reapertura (m)', 0, 1, .01],
] as const;
const coastalControls = [
  ['sea_level_m', 'Nivel marítimo experimental (m)', -2, 5, .1],
  ['channel_inflow_m3_s', 'Aporte de cauce experimental (m³/s)', 0, 50, .5],
] as const;

export function validHydrology(config: Hydrology | undefined): boolean {
  const value = { ...hydrologyDefaults, ...config };
  return [...controls, ...coastalControls].every(([key, , min, max]) => Number.isFinite(value[key]) && value[key]! >= min && value[key]! <= max)
    && value.blocked_depth_m! > value.caution_depth_m! && value.hysteresis_m! < value.caution_depth_m!;
}

export function HydrologyControls({ value, compound, onChange }: { value: Hydrology | undefined; compound: boolean; onChange: (value: Hydrology) => void }) {
  const current = { ...hydrologyDefaults, ...value };
  return <fieldset className="hydrology-parameters"><legend>Condiciones antecedentes e hidráulica experimental</legend>
    <p className="muted">Relieve sintético; profundidades calculadas aproximadas. El tiempo de tormenta, los turnos de evacuación y la velocidad visual son independientes. La malla se ajusta al límite de celdas del servidor.</p>
    <div className="flood-configuration-grid">{[...controls, ...(compound ? coastalControls : [])].map(([key, label, min, max, step]) => <label key={key}>{label}<input type="number" min={min} max={max} step={step} value={Number.isFinite(current[key]) ? current[key] : ''} onChange={event => onChange({ ...current, [key]: event.target.value.trim() === '' ? Number.NaN : Number(event.target.value) })} /></label>)}</div>
    {compound && <p className="muted">Inundación compuesta con borde costero sintético. No representa un tsunami ni la cota real del mar de Manta.</p>}
  </fieldset>;
}
