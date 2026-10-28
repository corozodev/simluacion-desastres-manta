import { useRef, useState } from 'react';
import type { SimulationZombieCounts } from '@corodev/contracts';
import { Button } from '../components/ui';

export const zombieLabels = { walker: 'Caminantes', runner: 'Corredores', horde: 'Hordas', sleeper: 'Dormidos' } as const;
export type CountDraft = Record<keyof SimulationZombieCounts, string>;
export const zombieKinds = Object.keys(zombieLabels) as (keyof SimulationZombieCounts)[];
export const countDraft = (counts: SimulationZombieCounts): CountDraft => ({ walker: String(counts.walker), runner: String(counts.runner), horde: String(counts.horde), sleeper: String(counts.sleeper) });
export const resolvedCounts = (draft: CountDraft): SimulationZombieCounts => ({ walker: Number(draft.walker), runner: Number(draft.runner), horde: Number(draft.horde), sleeper: Number(draft.sleeper) });
export const requiredZombie = (round: string, kind: keyof SimulationZombieCounts) => kind === 'walker' || (kind === 'sleeper' ? round === 'round3' : round !== 'round1');
export const validCounts = (round: string, draft: CountDraft) => zombieKinds.every(kind => draft[kind].trim() !== '' && Number.isSafeInteger(Number(draft[kind])) && (requiredZombie(round, kind) ? Number(draft[kind]) >= 1 : Number(draft[kind]) === 0)) && Number.isSafeInteger(zombieKinds.reduce((n, kind) => n + Number(draft[kind]), 0));

export function CopySeed({ seed }: { seed: number }) {
  const [message, setMessage] = useState('');
  return <><Button type="button" variant="secondary" onClick={async () => {
    try { await navigator.clipboard.writeText(String(seed)); setMessage('Semilla copiada.'); }
    catch { setMessage(`No se pudo copiar. Semilla: ${seed}`); }
  }}>Copiar seed</Button>{message && <span role="status">{message}</span>}</>;
}

export function GenerationParameters({ round, counts, seed, disabled, onCounts, onSeed, onReset }: { round: string; counts?: CountDraft; seed: string; disabled: boolean; onCounts: (counts: CountDraft) => void; onSeed: (seed: string) => void; onReset: () => void }) {
  const details = useRef<HTMLDetailsElement>(null);
  const total = counts ? zombieKinds.reduce((n, kind) => n + Number(counts[kind]), 0) : 0;
  const valid = !counts || validCounts(round, counts);
  return <details ref={details} className="workspace-advanced"><summary>Parámetros de generación</summary><div className="config-popover"><fieldset disabled={disabled}><legend className="sr-only">Población inicial y semilla</legend>
    {counts && <><div className="generation-counts">{zombieKinds.map(kind => <label key={kind}>{zombieLabels[kind]}<input type="number" required step="1" min={requiredZombie(round, kind) ? 1 : 0} max={requiredZombie(round, kind) ? Number.MAX_SAFE_INTEGER : 0} disabled={!requiredZombie(round, kind)} value={counts[kind]} onChange={event => onCounts({ ...counts, [kind]: event.target.value })} /></label>)}</div><p>Total de zombies: {Number.isSafeInteger(total) && total >= 0 ? total : 'Revisa las cantidades'}</p><p>Cantidades predeterminadas del proyecto; no son cantidades oficiales del organizador.</p>{!valid && <p role="alert">Cada tipo incluido en la ronda requiere un entero de al menos 1; los demás deben ser cero.</p>}</>}
    <label>Semilla<input type="number" step="1" min={-Number.MAX_SAFE_INTEGER} max={Number.MAX_SAFE_INTEGER} placeholder="Automática" value={seed} onChange={event => onSeed(event.target.value)} /></label><p>Vacía: generar una nueva. La semilla efectiva se muestra al iniciar.</p>
    <Button type="button" variant="secondary" onClick={onReset}>Restaurar configuración predeterminada</Button><Button type="button" variant="secondary" onClick={() => { if (details.current) details.current.open = false; }}>Conservar valores</Button>
  </fieldset></div></details>;
}
