import type { ScenarioSnapshot, SimulationState, WorldSnapshot } from '@corodev/contracts';
import { entitiesFromFlood, entitiesFromWorld } from './model';
import type { Observation } from './model';
export type VisualLifecycle = { id: string; running: boolean; connected: boolean; interval: number };
export function sessionLifecycle(state: SimulationState | undefined, connected: boolean): VisualLifecycle {
  return { id: state?.simulation_id ?? '', running: state?.status === 'RUNNING', connected, interval: state?.tick_interval_ms ?? 2000 };
}
export function observeWorld(world: WorldSnapshot | undefined, lifecycle?: VisualLifecycle): Observation | undefined {
  return world ? { id: lifecycle?.id ?? '', running: lifecycle?.running ?? false, connected: lifecycle?.connected ?? false, interval: lifecycle?.interval ?? 2000, graphVersion: world.graph_version, scenario: 'zombie_outbreak', tick: world.turn, entities: entitiesFromWorld(world) } : undefined;
}
export function observeFlood(scenario: ScenarioSnapshot | undefined, lifecycle?: VisualLifecycle): Observation | undefined {
  return scenario ? { id: lifecycle?.id ?? '', running: lifecycle?.running ?? false, connected: lifecycle?.connected ?? false, interval: lifecycle?.interval ?? 2000, graphVersion: scenario.graph_version, scenario: 'urban_flood', tick: scenario.simulation_step, entities: entitiesFromFlood(scenario) } : undefined;
}
