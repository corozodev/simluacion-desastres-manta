import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { MapPin, Route, Users, X } from 'lucide-react';
import type { Shelter } from '@corodev/contracts';
import { immobilityLabels } from './mobilityLabels';
import './agent-panel.css';

export interface PanelAgent {
  id: string;
  state: string;
  shelterId?: string;
  routeAvailable?: boolean;
  stationaryTurns?: number;
  immobilityReason?: string;
  vehicleId?: string;
  rescueVehicleId?: string;
}

export interface AgentShelterPanelProps {
  shelters: Shelter[];
  agents?: PanelAgent[];
  selectedAgentId?: string;
  onSelectAgent: (id: string) => void;
  selectedShelterId?: string;
  onSelectShelter?: (id: string) => void;
  search?: string;
  onSearch?: (value: string) => void;
  shelterStates?: Record<string, string>;
  editor?: ReactNode;
  selectingPosition?: boolean;
}

const agentStates: Record<string, string> = {
  active: 'Activo', moving: 'En movimiento', evacuated: 'Evacuado', bitten: 'Mordido', waiting: 'Esperando', isolated: 'Aislado',
};
const shelterStates: Record<string, string> = { available: 'Disponible', full: 'Completo', exposed: 'Expuesto', inaccessible: 'Sin acceso' };
const pageSize = 25;

/** A presentation-only observer. Routes and selection remain owned by the scenario. */
export function AgentShelterPanel({ shelters, agents = [], selectedAgentId = '', onSelectAgent, selectedShelterId = '', onSelectShelter, search, onSearch, shelterStates: conditions, editor, selectingPosition = false }: AgentShelterPanelProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'shelters' | 'agents'>('shelters');
  const [draftSearch, setDraftSearch] = useState('');
  const [page, setPage] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const shelterTab = useRef<HTMLButtonElement>(null);
  const agentTab = useRef<HTMLButtonElement>(null);
  const previousSelection = useRef({ agent: '', shelter: '' });
  const query = search ?? draftSearch;
  const matching = useMemo(() => agents.filter(agent => agent.id.toLowerCase().includes(query.trim().toLowerCase())), [agents, query]);
  const pages = Math.max(1, Math.ceil(matching.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const selected = agents.find(agent => agent.id === selectedAgentId);
  const rows = open && tab === 'agents' ? matching.slice(currentPage * pageSize, (currentPage + 1) * pageSize) : [];
  useEffect(() => {
    const agentChanged = previousSelection.current.agent !== selectedAgentId;
    const shelterChanged = previousSelection.current.shelter !== selectedShelterId;
    previousSelection.current = { agent: selectedAgentId, shelter: selectedShelterId };
    if (selectingPosition) { setOpen(false); return; }
    if (agentChanged && selectedAgentId) { setTab('agents'); setOpen(true); }
    else if (shelterChanged && selectedShelterId) { setTab('shelters'); setOpen(true); }
  }, [selectedAgentId, selectedShelterId, selectingPosition]);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const keyboardTab = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'shelters' : event.key === 'End' ? 'agents' : tab === 'shelters' ? 'agents' : 'shelters';
    setTab(next); (next === 'shelters' ? shelterTab : agentTab).current?.focus();
  };
  return <div className="agent-panel" data-map-ui onPointerDown={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Escape' && open) { event.stopPropagation(); close(); } }}>
    <button ref={trigger} type="button" className="agent-panel-trigger" aria-expanded={open && !selectingPosition} aria-controls={`${id}-body`} disabled={selectingPosition} onClick={() => setOpen(value => !value)}><Users size={16} aria-hidden="true" />Refugios y agentes</button>
    {open && !selectingPosition && <section id={`${id}-body`} className="agent-panel-body" aria-label="Refugios y agentes">
      <header><strong>Refugios y agentes</strong><button type="button" aria-label="Cerrar refugios y agentes" onClick={close}><X size={17} aria-hidden="true" /></button></header>
      <div className="agent-panel-tabs" role="tablist" aria-label="Explorar refugios y supervivientes">
        <button ref={shelterTab} type="button" role="tab" id={`${id}-shelters-tab`} aria-controls={`${id}-shelters`} aria-selected={tab === 'shelters'} tabIndex={tab === 'shelters' ? 0 : -1} onClick={() => setTab('shelters')} onKeyDown={keyboardTab}>Refugios <span>{shelters.length}</span></button>
        <button ref={agentTab} type="button" role="tab" id={`${id}-agents-tab`} aria-controls={`${id}-agents`} aria-selected={tab === 'agents'} tabIndex={tab === 'agents' ? 0 : -1} onClick={() => setTab('agents')} onKeyDown={keyboardTab}>Supervivientes <span>{agents.length}</span></button>
      </div>
      {tab === 'shelters' ? <div role="tabpanel" id={`${id}-shelters`} aria-labelledby={`${id}-shelters-tab`} className="agent-panel-scroll">
        <ul className="agent-panel-shelters">{shelters.map(shelter => {
          const reserved = shelter.reserved ?? 0;
          const available = shelter.available ?? Math.max(0, shelter.capacity - shelter.occupancy - reserved);
          const condition = conditions?.[shelter.id] ?? (available === 0 ? 'full' : 'available');
          return <li key={shelter.id} className={shelter.id === selectedShelterId ? 'agent-shelter-selected' : undefined}>
            <div className="agent-shelter-heading"><button type="button" className="agent-shelter-location" disabled={!onSelectShelter} aria-label={`Localizar refugio ${shelter.id}`} aria-pressed={shelter.id === selectedShelterId} onClick={() => onSelectShelter?.(shelter.id)}><MapPin size={14} aria-hidden="true" /><strong>{shelter.id}</strong></button><span>{shelter.occupancy}/{shelter.capacity} ocupadas</span></div>
            <progress value={shelter.occupancy} max={shelter.capacity} aria-label={`Ocupación de ${shelter.id}`} />
            <div className="agent-shelter-availability"><span>{available} libres · {reserved} reservadas</span><span className={`agent-shelter-state agent-shelter-${condition}`}>{shelterStates[condition] ?? condition}</span></div>
          </li>;
        })}</ul>
        {!shelters.length && <p className="agent-panel-empty">No hay refugios publicados para esta cobertura.</p>}
        {editor && <div className="agent-panel-editor">{editor}</div>}
      </div> : <div role="tabpanel" id={`${id}-agents`} aria-labelledby={`${id}-agents-tab`} className="agent-panel-agents">
        <label className="agent-panel-search">Buscar por ID<input ref={searchInput} type="search" value={query} placeholder="S-0001" onChange={event => { setPage(0); if (onSearch) onSearch(event.target.value); else setDraftSearch(event.target.value); }} /></label>
        {selected && <div className="agent-panel-selection" role="status"><span><Route size={13} aria-hidden="true" />{selected.id} · {selected.routeAvailable === false ? 'Sin ruta publicada; agente seleccionado en el mapa' : 'Ruta resaltada en el mapa'}</span><button type="button" onClick={() => { onSelectAgent(''); searchInput.current?.focus(); }}>Ocultar ruta</button>
          <dl className="agent-mobility-details"><dt>Estado</dt><dd>{agentStates[selected.state] ?? selected.state}</dd><dt>Destino</dt><dd>{selected.shelterId || 'Sin asignar'}</dd>
            {selected.stationaryTurns !== undefined && <><dt>Turnos sin desplazamiento</dt><dd>{selected.stationaryTurns}</dd></>}
            {selected.immobilityReason && <><dt>Motivo</dt><dd>{immobilityLabels[selected.immobilityReason] ?? selected.immobilityReason}</dd></>}
            {selected.vehicleId ? <><dt>A bordo</dt><dd>{selected.vehicleId}</dd></> : selected.rescueVehicleId && <><dt>Recogida asignada</dt><dd>{selected.rescueVehicleId} · conserva su decisión peatonal</dd></>}
          </dl>
        </div>}
        <div className="agent-panel-scroll agent-panel-table-scroll"><table className="agent-panel-table"><thead><tr><th>Superviviente</th><th>Estado</th><th>Refugio</th><th>Acción</th></tr></thead><tbody>{rows.map(agent => <tr key={agent.id} aria-selected={agent.id === selectedAgentId} className={agent.id === selectedAgentId ? 'agent-row-selected' : undefined}><th scope="row">{agent.id}</th><td>{agentStates[agent.state] ?? agent.state}</td><td>{agent.shelterId || 'Sin asignar'}</td><td><button type="button" aria-label={`Ver ruta de ${agent.id}`} aria-pressed={agent.id === selectedAgentId} onClick={() => onSelectAgent(agent.id)}>Ver ruta</button></td></tr>)}</tbody></table>{!matching.length && <p className="agent-panel-empty">{agents.length ? 'No hay supervivientes para esta búsqueda.' : 'Todavía no hay supervivientes publicados.'}</p>}</div>
        {pages > 1 && <nav className="agent-panel-pagination" aria-label="Páginas de supervivientes"><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Anterior</button><span>{currentPage + 1}/{pages} · {matching.length} resultados</span><button type="button" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Siguiente</button></nav>}
      </div>}
    </section>}
  </div>;
}
