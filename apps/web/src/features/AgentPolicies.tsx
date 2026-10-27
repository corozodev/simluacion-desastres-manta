import type { SimulationCreateRequest } from '@corodev/contracts';

export const algorithmLabels = {
  legacy_current: 'Planificador actual (baseline preservado)',
  baseline_shortest_path: 'Ruta mínima ponderada',
  dynamic_risk_astar: 'A* de riesgo dinámico',
  predictive_temporal_astar: 'A* temporal predictivo',
} as const;
export const zombiePolicyLabels = {
  classic_random: 'Aleatorio clásico',
  correlated_random_walk: 'Caminata aleatoria correlacionada',
  adaptive_exploration: 'Exploración adaptativa',
} as const;
export type AgentConfiguration = {
  mode: 'official' | 'experimental';
  zombie_policy: keyof typeof zombiePolicyLabels;
  evacuation_algorithm: keyof typeof algorithmLabels;
  pro: { runner_prediction: boolean; shelter_assignment: boolean; rescue_fleet: boolean };
};
export const defaultAgentConfiguration: AgentConfiguration = {
  mode: 'experimental', zombie_policy: 'classic_random', evacuation_algorithm: 'legacy_current',
  pro: { runner_prediction: true, shelter_assignment: true, rescue_fleet: false },
};

export function AgentPolicies({ value, onChange, disabled = false }: { value: AgentConfiguration; onChange: (value: AgentConfiguration) => void; disabled?: boolean }) {
  const official = value.mode === 'official';
  return <fieldset disabled={disabled} className="agent-policies"><legend>Políticas y funciones PRO</legend>
    <label>Modo de reglas<select value={value.mode} onChange={event => {
      const mode = event.target.value as AgentConfiguration['mode'];
      onChange({ ...value, mode, ...(mode === 'official' ? { zombie_policy: 'classic_random', pro: { ...value.pro, rescue_fleet: false } } : {}) });
    }}><option value="official">Oficial · reglas del reto</option><option value="experimental">Experimental · configuración editable</option></select></label>
    <label>Política de zombis<select value={value.zombie_policy} disabled={official} onChange={event => onChange({ ...value, zombie_policy: event.target.value as AgentConfiguration['zombie_policy'] })}>{Object.entries(zombiePolicyLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    <label>Algoritmo de evacuación<select value={value.evacuation_algorithm} onChange={event => onChange({ ...value, evacuation_algorithm: event.target.value as AgentConfiguration['evacuation_algorithm'] })}>{Object.entries(algorithmLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    <label className="policy-toggle"><input type="checkbox" checked={value.pro.runner_prediction} onChange={event => onChange({ ...value, pro: { ...value.pro, runner_prediction: event.target.checked } })} />Predicción de corredores</label>
    <label className="policy-toggle"><input type="checkbox" checked={value.pro.shelter_assignment} onChange={event => onChange({ ...value, pro: { ...value.pro, shelter_assignment: event.target.checked } })} />Asignación coordinada de refugios</label>
    <label className="policy-toggle"><input type="checkbox" checked={value.pro.rescue_fleet} disabled={official} onChange={event => onChange({ ...value, pro: { ...value.pro, rescue_fleet: event.target.checked } })} />Flota de rescate · experimental</label>
    {official && <p>BASE, población de la ronda, refugios originales y 150 turnos de 2 segundos. Las políticas y la flota experimentales quedan desactivadas.</p>}
  </fieldset>;
}

export function policyConfiguration(value: AgentConfiguration): NonNullable<SimulationCreateRequest['config']> {
  return { ...value, pro: { ...value.pro } };
}
