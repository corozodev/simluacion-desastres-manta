import type { ErrorResponse, HealthResponse, Graph, WorldSnapshot, Survivor, Shelter, Zombie, SimulationInfo, SimulationCatalog, OperatorSession, StartSimulation } from '@corodev/contracts';
import { config } from '../lib/config';
import { ApiError } from './errors';
export { ApiError } from './errors';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isErrorResponse(value: unknown): value is ErrorResponse {
  if (!isObject(value) || !isObject(value.error)) return false;
  const error = value.error;
  return typeof error.code === 'string' && typeof error.message === 'string' && typeof error.requestId === 'string'
    && Array.isArray(error.details) && error.details.every(detail => isObject(detail)
      && typeof detail.field === 'string' && typeof detail.message === 'string');
}

async function request<T>(path: string, validate: (value: unknown) => value is T, init?: RequestInit, signal?: AbortSignal, baseUrl = config.worldApiBaseUrl): Promise<T> {
  if (config.error) throw new ApiError(config.error, 'CONFIGURATION_ERROR');
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, config.timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init, signal: controller.signal,
      headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
    });
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      if (isErrorResponse(value)) {
        const { code, message, requestId, details } = value.error;
        throw new ApiError(message, code, response.status, requestId, details);
      }
      throw new ApiError('La API devolvió un error. Inténtalo de nuevo.', 'HTTP_ERROR', response.status, response.headers.get('x-request-id') ?? undefined);
    }
    if (!validate(value)) throw new ApiError('La respuesta no coincide con el contrato de la API.', 'INVALID_RESPONSE', response.status);
    return value;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (timedOut) throw new ApiError('La API tardó demasiado en responder. Inténtalo de nuevo.', 'TIMEOUT');
    if (signal?.aborted) throw error;
    throw new ApiError('No pudimos conectar con la API. Comprueba que el servidor esté disponible.', 'BACKEND_UNAVAILABLE');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

function isNatural(value: unknown): value is number { return Number.isInteger(value) && Number(value) >= 0; }
function isNumber(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function isStrings(value: unknown): value is string[] { return Array.isArray(value) && value.every(item => typeof item === 'string'); }
function isPoint(value: unknown): boolean { return isObject(value) && isNumber(value.lat) && Math.abs(value.lat) <= 90 && isNumber(value.lng) && Math.abs(value.lng) <= 180; }
function isGeometry(value: unknown): boolean { return Array.isArray(value) && value.every(isPoint); }
function isShelter(value: unknown): value is Shelter {
  return isObject(value) && typeof value.id === 'string' && typeof value.node_id === 'string'
    && isNatural(value.capacity) && isNatural(value.occupancy) && value.occupancy <= value.capacity
    && (value.reserved === undefined || isNatural(value.reserved) && value.reserved + value.occupancy <= value.capacity)
    && (value.available === undefined || isNatural(value.available) && value.available <= value.capacity)
    && (value.reserved === undefined || value.available === undefined || Number(value.reserved) + Number(value.available) + value.occupancy === value.capacity);
}
function isSurvivor(value: unknown): value is Survivor {
  return isObject(value) && typeof value.id === 'string' && typeof value.current_node === 'string'
    && ['active', 'bitten', 'evacuated'].includes(String(value.status))
    && typeof value.target_shelter_id === 'string' && isStrings(value.planned_route)
    && (value.spawn_zone_id === undefined || typeof value.spawn_zone_id === 'string');
}
function isZombie(value: unknown): value is Zombie {
  return isObject(value) && typeof value.id === 'string' && typeof value.current_node === 'string'
    && ['walker', 'runner', 'horde', 'sleeper'].includes(String(value.type))
    && typeof value.movement_state === 'string' && typeof value.awake === 'boolean'
    && !(value.type === 'sleeper' && !value.awake) && isStrings(value.path);
}
function isGraph(value: unknown): value is Graph {
  return isObject(value) && typeof value.version === 'string' && typeof value.source === 'string'
    && Array.isArray(value.nodes) && value.nodes.length > 0 && value.nodes.every(node => isObject(node)
      && typeof node.id === 'string' && isNumber(node.lat) && Math.abs(node.lat) <= 90 && isNumber(node.lng) && Math.abs(node.lng) <= 180)
    && Array.isArray(value.edges) && value.edges.every(edge => isObject(edge) && typeof edge.id === 'string'
      && typeof edge.from === 'string' && typeof edge.to === 'string' && isNumber(edge.distance_m) && edge.distance_m > 0
      && typeof edge.road_type === 'string' && isNumber(edge.speed_mps) && edge.speed_mps > 0
      && typeof edge.blocked === 'boolean' && typeof edge.directed === 'boolean'
      && (edge.geometry === undefined || isGeometry(edge.geometry)) && (edge.bridge === undefined || typeof edge.bridge === 'boolean'))
    && Array.isArray(value.shelters) && value.shelters.every(isShelter)
    && (value.coverage === undefined || isGeometry(value.coverage))
    && (value.spawn_zones === undefined || Array.isArray(value.spawn_zones) && value.spawn_zones.every(zone => isObject(zone)
      && typeof zone.id === 'string' && typeof zone.name === 'string' && typeof zone.source === 'string'
      && isGeometry(zone.geometry) && isStrings(zone.node_ids) && isNumber(zone.weight) && zone.weight >= 0));
}
function isWorld(value: unknown): value is WorldSnapshot {
  if (!isObject(value) || !isObject(value.metrics)) return false;
  const metrics = value.metrics;
  return isNatural(value.turn) && isNatural(value.world_version) && typeof value.graph_version === 'string'
    && Array.isArray(value.zombies) && value.zombies.every(isZombie)
    && Array.isArray(value.survivors) && value.survivors.every(isSurvivor)
    && Array.isArray(value.shelters) && value.shelters.every(isShelter) && isStrings(value.blocked_edges)
    && Array.isArray(value.events) && value.events.every(event => isObject(event) && isNatural(event.turn)
      && ['type', 'entity_id', 'edge_id', 'message'].every(field => typeof event[field] === 'string'))
    && ['evacuated', 'bitten', 'active', 'turns', 'requests_success', 'requests_invalid', 'requests_timeout'].every(field => isNatural(metrics[field]))
    && ['http_p50_ms', 'http_p95_ms', 'http_p99_ms', 'availability'].every(field => isNumber(metrics[field]) && Number(metrics[field]) >= 0)
    && Number(metrics.availability) <= 1 && (value.simulation === undefined || isSimulation(value.simulation));
}

function isSimulation(value: unknown): value is SimulationInfo {
  return isObject(value) && ['run_id', 'graph_version', 'round'].every(key => typeof value[key] === 'string')
    && ['competition', 'full', 'expanded'].includes(String(value.mode))
    && ['idle', 'starting', 'running', 'finished', 'failed'].includes(String(value.state))
    && Number.isSafeInteger(value.seed) && isNatural(value.turn_limit) && isNatural(value.interval_ms);
}
function isCatalog(value: unknown): value is SimulationCatalog {
  return isObject(value) && value.default_mode === 'competition' && typeof value.admin_enabled === 'boolean'
    && isNatural(value.history_limit) && Array.isArray(value.presets) && value.presets.every(preset => isObject(preset)
      && ['competition', 'full', 'expanded'].includes(String(preset.id))
      && ['name', 'graph_version', 'source', 'coverage', 'disabled_reason'].every(key => typeof preset[key] === 'string')
      && isNatural(preset.nodes) && isNatural(preset.edges)
      && ['enabled', 'experimental', 'preview_available'].every(key => typeof preset[key] === 'boolean'))
    && Array.isArray(value.rounds) && value.rounds.every(round => isObject(round) && typeof round.id === 'string'
      && typeof round.name === 'string' && isNatural(round.survivors) && isNatural(round.turns));
}
function isSession(value: unknown): value is OperatorSession {
  return isObject(value) && typeof value.enabled === 'boolean' && typeof value.authenticated === 'boolean'
    && (!value.authenticated || typeof value.operator === 'string' && typeof value.csrf_token === 'string' && typeof value.expires_at === 'string');
}

export const api = {
  world: (signal?: AbortSignal) => request<WorldSnapshot>('/estado', isWorld, undefined, signal),
  graph: (signal?: AbortSignal, options?: { runId?: string; mode?: string }) => {
    const query = new URLSearchParams(options?.mode ? { mode: options.mode } : options?.runId ? { run_id: options.runId } : {});
    return request<Graph>(`/grafo${query.size ? `?${query}` : ''}`, isGraph, undefined, signal);
  },
  catalog: (signal?: AbortSignal) => request<SimulationCatalog>('/simulation/catalog', isCatalog, undefined, signal),
  session: (signal?: AbortSignal) => request<OperatorSession>('/admin/session', isSession, { credentials: 'include' }, signal),
  login: (operator: string, accessCode: string) => request<OperatorSession>('/admin/session', isSession,
    { method: 'POST', credentials: 'include', body: JSON.stringify({ operator, access_code: accessCode }) }),
  logout: (csrf: string) => request<OperatorSession>('/admin/session', isSession,
    { method: 'DELETE', credentials: 'include', headers: { 'X-CSRF-Token': csrf } }),
  startRun: (input: StartSimulation, csrf: string) => request<SimulationInfo>('/admin/runs', isSimulation,
    { method: 'POST', credentials: 'include', headers: { 'X-CSRF-Token': csrf }, body: JSON.stringify(input) }),
  health: (signal?: AbortSignal) => request<HealthResponse>('/healthz', (value): value is HealthResponse =>
    isObject(value) && value.status === 'ok' && typeof value.service === 'string' && typeof value.version === 'string', undefined, signal),
};
