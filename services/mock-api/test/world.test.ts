import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });

describe('fixtures observables del mundo', () => {
  it('sirve el mismo contrato, sin simular datos reales de Manta ni requerir secretos', async () => {
    const app = buildApp(); apps.push(app);
    const graph = await app.inject({ method: 'GET', url: '/grafo' });
    expect(graph.statusCode).toBe(200);
    expect(graph.json().source).toContain('SYNTHETIC');
    expect(graph.json().shelters).toHaveLength(4);
    const world = await app.inject({ method: 'GET', url: '/estado' });
    expect(world.statusCode).toBe(200);
    expect(world.json().survivors).toHaveLength(2);
    expect(world.json().metrics.active).toBe(2);
    expect(world.json().graph_version).toBe(graph.json().version);
    expect(world.json().events[0].type).toBe('synthetic_fixture');
    expect(world.json().survivors[0].planned_route).toEqual(['N-0000', 'N-0001']);
    expect(world.json().shelters.every((shelter: { capacity: number; occupancy: number; reserved: number; available: number }) => shelter.occupancy + shelter.reserved + shelter.available === shelter.capacity)).toBe(true);
    expect(world.headers['x-request-id']).toBeTruthy();
    const health = await app.inject({ method: 'GET', url: '/healthz' });
    expect(health.statusCode).toBe(200);
    expect(health.json().service).toBe('corodev-mock-api');
  });
});
