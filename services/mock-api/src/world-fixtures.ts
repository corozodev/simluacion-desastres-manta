import { readFileSync } from 'node:fs';
import type { Graph, WorldSnapshot } from '@corodev/contracts';

// Contract examples are explicitly synthetic and never presented as Manta data.
export const demoGraph = JSON.parse(readFileSync(new URL('../../../packages/contracts/examples/graph.json', import.meta.url), 'utf8')) as Graph;
export const demoWorld = JSON.parse(readFileSync(new URL('../../../packages/contracts/examples/world.json', import.meta.url), 'utf8')) as WorldSnapshot;
demoGraph.shelters = demoGraph.shelters.map(shelter => ({ ...shelter, reserved: 0, available: shelter.capacity - shelter.occupancy }));
demoGraph.edges = demoGraph.edges.map(edge => ({ ...edge, geometry: [demoGraph.nodes.find(node => node.id === edge.from)!, demoGraph.nodes.find(node => node.id === edge.to)!].map(node => ({ lat: node.lat, lng: node.lng })) }));
demoWorld.survivors = [
  { id: 'S-MOCK-1', current_node: 'N-0000', status: 'active', target_shelter_id: 'R-2', planned_route: ['N-0000', 'N-0001'] },
  { id: 'S-MOCK-2', current_node: 'N-0002', status: 'active', target_shelter_id: 'R-4', planned_route: ['N-0002', 'N-0003'] },
];
demoWorld.shelters = demoWorld.shelters.map(shelter => {
  const reserved = demoWorld.survivors.filter(survivor => survivor.target_shelter_id === shelter.id).length;
  return { ...shelter, reserved, available: shelter.capacity - shelter.occupancy - reserved };
});
demoWorld.zombies = [{ id: 'Z-MOCK-1', type: 'walker', current_node: 'N-0003', awake: true, movement_state: 'resting', path: ['N-0003'] }];
demoWorld.metrics.active = 2;
demoWorld.events = [{ turn: 0, type: 'synthetic_fixture', entity_id: '', edge_id: '', message: 'Fixture sintética estática; no corresponde a Manta ni ejecuta turnos.' }];
