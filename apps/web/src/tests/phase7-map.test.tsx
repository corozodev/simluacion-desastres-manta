import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { RunnerForecast } from '@corodev/contracts';
import { WorldMap } from '../features/WorldMap';
import { entitiesFromWorld } from '../features/visualization/model';
import { graph, world } from './simulation-fixtures';

const forecast: RunnerForecast = { turn: world.turn, horizon: 2, node_risks: [{ node_id: graph.nodes[0]!.id, one_turn_probability: .5, two_turn_probability: .3 }], edge_risks: [] };
describe('capas PRO observables', () => {
  it('muestra camionetas en su nodo real y a los pasajeros en su ocupación sin contarlos como evacuados', () => {
    const snapshot = structuredClone(world);
    const node = graph.nodes[0]!.id;
    snapshot.survivors = [{ id: 'S-1', current_node: node, status: 'active', target_shelter_id: '', planned_route: [node] }];
    snapshot.fleet = [{ id: 'V-1', current_node: node, path: [node], passenger_ids: [snapshot.survivors[0]!.id], target_survivor_id: '', target_shelter_id: graph.shelters[0]!.id, state: 'transporting', capacity: 4 }];
    snapshot.survivors[0]!.vehicle_id = 'V-1';
    render(<WorldMap graph={graph} world={snapshot} />);
    expect(document.querySelector('[data-vehicle-id="V-1"]')).toBeInTheDocument();
    expect(screen.getByText('1/4')).toBeInTheDocument();
    expect(screen.getByText(/Camioneta V-1 · 1\/4 pasajeros/)).toBeInTheDocument();
    expect(entitiesFromWorld(snapshot).find(entity => entity.id === snapshot.survivors[0]!.id)).toBeUndefined();
    expect(snapshot.survivors[0]!.status).toBe('active');
  });
  it('predicciones requieren activación explícita y un turno compatible; no inventa marcadores ante datos ausentes', async () => {
    const view = render(<WorldMap graph={graph} world={world} forecast={forecast} />);
    expect(document.querySelector('[data-forecast-node]')).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('Capas'));
    await userEvent.click(screen.getByLabelText('Mostrar predicción de corredores'));
    expect(document.querySelector('[data-forecast-node]')).toBeInTheDocument();
    expect(screen.getAllByText(/Predicción del modelo, no calibrada/)).toHaveLength(2);
    view.rerender(<WorldMap graph={graph} world={world} forecast={{ ...forecast, turn: world.turn + 1 }} />);
    expect(document.querySelector('[data-forecast-node]')).not.toBeInTheDocument();
  });
});
