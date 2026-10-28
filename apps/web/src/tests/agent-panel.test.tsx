import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AgentShelterPanel, type PanelAgent } from '../features/maps/AgentShelterPanel';
import { AnimatedEntities } from '../features/visualization/AnimatedEntities';
import type { Observation } from '../features/visualization/model';
import { graph } from './simulation-fixtures';

const agents = [
  { id: 'S-0001', state: 'active', shelterId: 'R-2', current_node: 'OSM-technical-private-presentation', planned_route: ['OSM-technical-route'] },
  { id: 'S-0002', state: 'evacuated', shelterId: 'R-1' },
  { id: 'S-0003', state: 'bitten' },
];
function SelectionPanel() {
  const [selected, select] = useState('');
  const [search, setSearch] = useState('');
  return <AgentShelterPanel shelters={graph.shelters} agents={agents} selectedAgentId={selected} onSelectAgent={select} search={search} onSearch={setSearch} />;
}

describe('panel portátil de refugios y supervivientes', () => {
  it('presenta sólo cuatro columnas, mantiene búsqueda, selección y cambio/ocultación de ruta', async () => {
    render(<SelectionPanel />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Refugios y agentes' }));
    await userEvent.click(screen.getByRole('tab', { name: /Supervivientes/ }));
    expect(screen.getAllByRole('columnheader').map(header => header.textContent)).toEqual(['Superviviente', 'Estado', 'Refugio', 'Acción']);
    expect(screen.queryByText(/OSM-technical/)).not.toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Sin asignar' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ver ruta de S-0001' }));
    expect(screen.getByRole('status')).toHaveTextContent('S-0001 · Ruta resaltada en el mapa');
    expect(screen.getByRole('rowheader', { name: 'S-0001' }).closest('tr')).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Ver ruta de S-0002' }));
    expect(screen.getByRole('status')).toHaveTextContent('S-0002 · Ruta resaltada en el mapa');
    expect(screen.getByRole('rowheader', { name: 'S-0001' }).closest('tr')).toHaveAttribute('aria-selected', 'false');
    await userEvent.click(screen.getByRole('button', { name: 'Ocultar ruta' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar por ID' }), 'S-0003');
    expect(screen.getAllByRole('rowheader')).toHaveLength(1);
    expect(screen.getByRole('cell', { name: 'Mordido' })).toBeInTheDocument();
    expect(screen.queryByText(/Posición|Siguiente movimiento|Zona de origen|Ruta publicada/)).not.toBeInTheDocument();
  });

  it('mantiene el foco al ocultar ruta y permite cerrar con Escape', async () => {
    render(<SelectionPanel />);
    const trigger = screen.getByRole('button', { name: 'Refugios y agentes' });
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('tab', { name: /Supervivientes/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Ver ruta de S-0001' }));
    await userEvent.click(screen.getByRole('button', { name: 'Ocultar ruta' }));
    expect(screen.getByRole('searchbox', { name: 'Buscar por ID' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });

  it('limita el DOM a 25 filas y filtra desde la población completa', async () => {
    const population: PanelAgent[] = Array.from({ length: 200 }, (_, index) => ({ id: `S-${String(index + 1).padStart(4, '0')}`, state: 'active' }));
    const select = vi.fn();
    render(<AgentShelterPanel shelters={graph.shelters} agents={population} onSelectAgent={select} />);
    await userEvent.click(screen.getByRole('button', { name: 'Refugios y agentes' }));
    await userEvent.click(screen.getByRole('tab', { name: /Supervivientes/ }));
    expect(screen.getAllByRole('rowheader')).toHaveLength(25);
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(screen.getByRole('rowheader', { name: 'S-0026' })).toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox'), 'S-0199');
    expect(screen.getAllByRole('rowheader')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Ver ruta de S-0199' }));
    expect(select).toHaveBeenCalledWith('S-0199');
  });

  it('muestra ocupación y reservas coherentes y conserva edición sin desplegar supervivientes', async () => {
    const selectShelter = vi.fn();
    render(<AgentShelterPanel shelters={[{ ...graph.shelters[0]!, capacity: 10, occupancy: 2, reserved: 3 }]} agents={agents} onSelectAgent={() => undefined} onSelectShelter={selectShelter} editor={<button>Editar refugios existentes</button>} />);
    await userEvent.click(screen.getByRole('button', { name: 'Refugios y agentes' }));
    expect(screen.getByText('5 libres · 3 reservadas')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Ocupación de R-1' })).toHaveAttribute('value', '2');
    expect(screen.getByRole('button', { name: 'Editar refugios existentes' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Localizar refugio R-1' }));
    expect(selectShelter).toHaveBeenCalledWith('R-1');
  });

  it('permite pestañas por teclado y Escape devuelve el foco al disparador', async () => {
    render(<AgentShelterPanel shelters={graph.shelters} agents={agents} onSelectAgent={() => undefined} />);
    const trigger = screen.getByRole('button', { name: 'Refugios y agentes' });
    await userEvent.click(trigger);
    const refuges = screen.getByRole('tab', { name: /Refugios/ });
    refuges.focus();
    fireEvent.keyDown(refuges, { key: 'ArrowRight' });
    const survivors = screen.getByRole('tab', { name: /Supervivientes/ });
    expect(survivors).toHaveFocus();
    expect(survivors).toHaveAttribute('aria-selected', 'true');
    expect(within(screen.getByRole('tabpanel')).getByRole('searchbox')).toBeInTheDocument();
    fireEvent.keyDown(survivors, { key: 'Escape' });
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('abre la selección inicial y sólo vuelve a abrir al cambiar realmente de selección', () => {
    const props = { shelters: graph.shelters, agents, onSelectAgent: vi.fn(), onSelectShelter: vi.fn() };
    const { rerender } = render(<AgentShelterPanel {...props} selectedAgentId="S-0001" />);
    expect(screen.getByRole('tab', { name: /Supervivientes/ })).toHaveAttribute('aria-selected', 'true');
    rerender(<AgentShelterPanel {...props} selectedAgentId="S-0001" selectingPosition />);
    expect(screen.queryByRole('region', { name: 'Refugios y agentes' })).not.toBeInTheDocument();
    rerender(<AgentShelterPanel {...props} selectedAgentId="S-0001" />);
    expect(screen.getByRole('button', { name: 'Refugios y agentes' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: 'Refugios y agentes' })).not.toBeInTheDocument();
    rerender(<AgentShelterPanel {...props} selectedAgentId="S-0002" />);
    expect(screen.getByRole('rowheader', { name: 'S-0002' }).closest('tr')).toHaveAttribute('aria-selected', 'true');
    rerender(<AgentShelterPanel {...props} selectedAgentId="S-0002" selectedShelterId="R-1" />);
    expect(screen.getByRole('tab', { name: /Refugios/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('cierra el panel durante selección geográfica para permitir confirmar fuera del drawer', async () => {
    const props = { shelters: graph.shelters, agents, onSelectAgent: vi.fn() };
    const { rerender } = render(<AgentShelterPanel {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'Refugios y agentes' }));
    rerender(<AgentShelterPanel {...props} selectingPosition />);
    expect(screen.getByRole('button', { name: 'Refugios y agentes' })).toBeDisabled();
    expect(screen.queryByRole('region', { name: 'Refugios y agentes' })).not.toBeInTheDocument();
  });
});

it('distingue zombis vectoriales y supervivientes y conserva el fallback del atlas', () => {
  const observation: Observation = { id: 'shape-test', graphVersion: graph.version, scenario: 'zombie_outbreak', tick: 1, running: false, connected: true, interval: 2000, entities: [
    { key: 'survivor:S1', id: 'S1', kind: 'survivor', state: 'active', node: graph.nodes[0]!.id },
    { key: 'zombie:Z1', id: 'Z1', kind: 'zombie', state: 'moving', node: graph.nodes[1]!.id },
  ] };
  const { container } = render(<svg><AnimatedEntities graph={graph} observation={observation} project={point => ({ x: point.lng * 10000, y: point.lat * 10000 })} view={{ x: -100, y: -100, width: 400, height: 200 }} active={false} clustering={false} /></svg>);
  expect(container.querySelector('[data-kind-shape="walker"]')?.tagName).toBe('path');
  expect(container.querySelector('[data-kind-shape="survivor"]')?.tagName).toBe('circle');
  expect(container.querySelectorAll('[data-sprite]')).toHaveLength(2);
  expect(container.querySelector('defs image[href="/visualization/zombie.png"]')).not.toBeInTheDocument();
  fireEvent.error(container.querySelector('defs image[href="/visualization/survivor.png"]')!);
  const zombie = container.querySelector('[data-zombie-glyph="walker"] path')!;
  const survivor = container.querySelector('[data-fallback="survivor"] path')!;
  expect(zombie.getAttribute('d')).not.toBe(survivor.getAttribute('d'));
  expect(container.querySelectorAll('[data-agent-id]')).toHaveLength(2);
});

it('muestra inmovilidad publicada y una recogida real sin inventar espera de rescate', () => {
  const props = { shelters: graph.shelters, selectedAgentId: 'S1', onSelectAgent: vi.fn() };
  const { rerender } = render(<AgentShelterPanel {...props} agents={[{ id: 'S1', state: 'active', stationaryTurns: 3, immobilityReason: 'timeout', rescueVehicleId: 'V-01' }]} />);
  expect(screen.getByRole('status')).toHaveTextContent('Se agotó el plazo de decisión');
  expect(screen.getByRole('status')).toHaveTextContent('V-01 · conserva su decisión peatonal');
  expect(screen.getByText('Turnos sin desplazamiento').nextElementSibling).toHaveTextContent('3');
  rerender(<AgentShelterPanel {...props} agents={[{ id: 'S1', state: 'active' }]} />);
  expect(screen.queryByText('Turnos sin desplazamiento')).not.toBeInTheDocument();
  expect(screen.queryByText('Recogida asignada')).not.toBeInTheDocument();
  expect(screen.queryByText('Motivo')).not.toBeInTheDocument();
});

it('informa cuando el servidor no publica recorrido sin inventar una ruta resaltada', async () => {
  render(<AgentShelterPanel shelters={graph.shelters} agents={[{ id: 'S-0001', state: 'evacuated', shelterId: 'R-1', routeAvailable: false }]} selectedAgentId="S-0001" onSelectAgent={() => undefined} />);
  expect(await screen.findByRole('status')).toHaveTextContent('Sin ruta publicada; agente seleccionado en el mapa');
  expect(screen.getByRole('status')).not.toHaveTextContent('Ruta resaltada');
});
