import { useEffect, useRef, useState } from 'react';
import type { GeoPoint, Graph, Shelter, SimulationCustomShelter } from '@corodev/contracts';
import { Button } from '../components/ui';

// Same experimental selection radius as the existing flood laboratory. It is
// a configuration constraint, never an evacuation distance recommendation.
export const shelterSnapDistanceM = 500;
export function snapShelter(graph: Graph, point: GeoPoint, excluded: string[]) {
  const reverse = new Map<string, string[]>();
  const legal = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.blocked) continue;
    legal.add(edge.from); legal.add(edge.to);
    reverse.set(edge.to, [...reverse.get(edge.to) ?? [], edge.from]);
    if (!edge.directed) reverse.set(edge.from, [...reverse.get(edge.from) ?? [], edge.to]);
  }
  let nearest: Graph['nodes'][number] | undefined;
  let distance = Infinity;
  for (const node of graph.nodes) {
    if (!legal.has(node.id)) continue;
    const radians = Math.PI / 180;
    const next = Math.hypot((point.lng - node.lng) * radians * Math.cos((point.lat + node.lat) * radians / 2), (point.lat - node.lat) * radians) * 6371000;
    if (next < distance || next === distance && node.id < (nearest?.id ?? '')) { nearest = node; distance = next; }
  }
  if (!nearest || distance > shelterSnapDistanceM) return { error: 'No hay una intersección transitable a 500 m o menos.' };
  if (excluded.includes(nearest.id)) return { error: 'Esta intersección ya pertenece a otro refugio.' };
  const reached = new Set([nearest.id]);
  const queue = [nearest.id];
  for (let index = 0; index < queue.length; index++) for (const node of reverse.get(queue[index]!) ?? []) if (!reached.has(node)) { reached.add(node); queue.push(node); }
  if (reached.size !== graph.nodes.length) return { error: 'El candidato no es accesible desde todos los nodos de la red.' };
  return { node: nearest, distance };
}

export function useShelterDraft(graph?: Graph) {
  const [custom, setCustom] = useState<SimulationCustomShelter[] | undefined>();
  const [picking, setPicking] = useState<string>();
  const [proposal, setProposal] = useState<{ point: GeoPoint; node?: Graph['nodes'][number]; distance?: number; error?: string }>();
  useEffect(() => { setCustom(undefined); setPicking(undefined); setProposal(undefined); }, [graph?.version]);
  const cancel = () => { setPicking(undefined); setProposal(undefined); };
  useEffect(() => {
    if (!picking) return;
    const listener = (event: KeyboardEvent) => { if (event.key === 'Escape') { setPicking(undefined); setProposal(undefined); } };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [picking]);
  const defaults = graph?.shelters.map(shelter => ({ id: shelter.id, node_id: shelter.node_id, capacity: shelter.capacity })) ?? [];
  const effective = custom ?? defaults;
  return {
    custom, effective, picking, proposal,
    valid: !custom || custom.length === 4 && custom.every(item => graph?.nodes.some(node => node.id === item.node_id) && Number.isInteger(item.capacity) && item.capacity >= 1 && item.capacity <= 200),
    reset: () => { setCustom(undefined); cancel(); }, cancel,
    pick: (id: string) => { setPicking(id); setProposal(undefined); },
    select: (point: GeoPoint) => {
      if (!graph || !picking) return;
      setProposal({ point, ...snapShelter(graph, point, effective.filter(item => item.id !== picking).map(item => item.node_id)) });
    },
    confirm: () => {
      if (!proposal?.node || !picking) return;
      setCustom(effective.map(item => item.id === picking ? { ...item, node_id: proposal.node!.id } : item)); cancel();
    },
    capacity: (id: string, capacity: number) => setCustom(effective.map(item => item.id === id ? { ...item, capacity } : item)),
    shelters: (graph?.shelters ?? []).map(shelter => ({ ...shelter, ...effective.find(item => item.id === shelter.id), occupancy: 0, reserved: 0, available: effective.find(item => item.id === shelter.id)?.capacity ?? shelter.capacity })) as Shelter[],
  };
}

export function ShelterEditor({ draft, disabled, originalIds, selectedIds, onSelectedIds }: { draft: ReturnType<typeof useShelterDraft>; disabled: boolean; originalIds: string[]; selectedIds: string[]; onSelectedIds: (value: string[]) => void }) {
  const panel = useRef<HTMLDetailsElement>(null);
  return <><details ref={panel} className="map-shelter-panel compact-disclosure"><summary>Refugios · {draft.effective.length} ubicaciones</summary>
    <p className="muted">Puntos experimentales. Los cambios se aplican al iniciar; se conservan los orígenes del brote.</p>
    <fieldset disabled={disabled}><legend className="sr-only">Configurar refugios sobre el mapa</legend>
      {draft.effective.map(shelter => <div className="shelter-edit-row" key={shelter.id}>
        <strong>{shelter.id}</strong><label>Capacidad de {shelter.id}<input type="number" min="1" max="200" step="1" value={Number.isFinite(shelter.capacity) ? shelter.capacity : ''} onChange={event => { onSelectedIds([]); draft.capacity(shelter.id, event.target.valueAsNumber); }} /></label>
        <Button variant="secondary" onClick={() => { onSelectedIds([]); draft.pick(shelter.id); if (panel.current) panel.current.open = false; }}>Editar ubicación de {shelter.id}</Button>
      </div>)}
      {!draft.custom && <details><summary>Elegir refugios originales activos</summary><p>Sin selección se utilizan los cuatro.</p>{originalIds.map(id => <label key={id}><input type="checkbox" checked={selectedIds.includes(id)} onChange={event => onSelectedIds(event.target.checked ? [...selectedIds, id] : selectedIds.filter(item => item !== id))} />{id}</label>)}</details>}
      <Button variant="ghost" onClick={() => { draft.reset(); onSelectedIds([]); }}>Restaurar refugios originales</Button>
    </fieldset>
    {!draft.valid && <p role="alert">La capacidad debe ser un entero entre 1 y 200 por refugio.</p>}
  </details>

  </>;
}

export function ShelterSelectionNotice({ draft, disabled }: { draft: ReturnType<typeof useShelterDraft>; disabled: boolean }) {
  return <>{draft.picking && <div className="shelter-selection-notice" role="status"><p>Selecciona una ubicación en el mapa para {draft.picking}. Escape cancela.</p>{draft.proposal?.error && <p role="alert">{draft.proposal.error}</p>}{draft.proposal?.node && <p>Intersección válida · ajuste {draft.proposal.distance!.toFixed(1)} m.</p>}
      <Button disabled={!draft.proposal?.node || disabled} onClick={draft.confirm}>Confirmar ubicación</Button><Button variant="secondary" onClick={draft.cancel}>Cancelar selección</Button>
    </div>}</>;
}
