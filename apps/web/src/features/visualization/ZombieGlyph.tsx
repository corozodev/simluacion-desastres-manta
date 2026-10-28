import catalog from '../../../../../packages/visualization/catalog.json';
import type { ZombieVariant } from './model';

export const zombieVariants = catalog.zombie_variants;
export const zombieHalos: Record<ZombieVariant, string> = {
  walker: 'M-9,-7L-4,-14L7,-12L10,-4L8,13L-8,13Z',
  runner: 'M-14,8L-3,-10L12,-13L15,-3L5,11Z',
  horde: 'M-15,7Q-18,-10,-8,-10Q0,-21,8,-10Q18,-10,15,7L8,14H-8Z',
  sleeper: 'M-15,-3Q-17,-9,-9,-9H10Q17,-9,16,0L12,8H-12Z',
};

/** Shared by map symbols and legend. No positions, clocks or engine state. */
export function ZombieGlyph({ variant }: { variant: ZombieVariant }) {
  return <g className={`zombie-glyph zombie-${variant}`} data-zombie-glyph={variant}>
    {variant === 'walker' && <><circle cx={-1} cy={-8} r={3} /><path d="M-2,-4L-4,3L2,4L2,-2ZM-3,-2L-8,1L-10,-1M1,-2L6,0L8,-2M-3,4L-5,10M1,4L4,10" /></>}
    {variant === 'runner' && <><circle cx={6} cy={-8} r={3} /><path d="M3,-5L-3,1L1,4L6,-3ZM2,-4L-3,-5L-6,-2M4,-2L9,1L12,-1M-2,2L-8,5L-11,4M0,4L4,8L9,8M-12,-4H-8M-14,0H-10" /></>}
    {variant === 'horde' && <>{[-8, 0, 8].map((x, i) => <g key={x} transform={`translate(${x},${i === 1 ? -3 : 1})`}><circle cy={-6} r={2.8} /><path d="M-2,-2H2L3,4H-3ZM-2,4L-3,9M2,4L3,9" /></g>)}<text className="zombie-indicator" x={9} y={-10}>H</text></>}
    {variant === 'sleeper' && <><circle cx={-10} cy={1} r={3} /><path d="M-6,1L3,-1L6,3L-5,4ZM4,1L10,1L13,4M-2,3L3,6L8,6" /><text className="zombie-indicator" x={0} y={-5}>Zz</text></>}
  </g>;
}

export function ZombieLegend() {
  return <div className="zombie-legend" aria-label="Tipos de zombis">
    {zombieVariants.map(variant => <span key={variant.id}><svg viewBox="-18 -18 36 36" width="28" height="28" aria-hidden="true"><ZombieGlyph variant={variant.id as ZombieVariant} /></svg>{variant.label}</span>)}
    <small>Los dormidos permanecen ocultos; al activarse se representan como caminantes.</small>
    <small>H: su nodo y vecinos viales están bloqueados; los aros violetas señalan esos nodos.</small>
  </div>;
}
