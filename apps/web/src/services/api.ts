import type { ErrorResponse, HealthResponse, Graph, WorldSnapshot, Survivor, Shelter, Zombie, SimulationInfo, SimulationCatalog, OperatorSession, StartSimulation } from '@corodev/contracts';
import type { ScenarioSnapshot, EvacuationMetrics, LabState, LabCatalog, LabSession, LabCandidate, LabRunConfig, LabCandidateValidation, LabComparison, LabAction } from '@corodev/contracts';
import type { Incident, IncidentCreate, IncidentList, IncidentServiceInfo, IncidentLocation, IncidentResolution, IncidentApplication, IncidentApplyResult, IncidentStatusUpdate } from '@corodev/contracts';
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
  if (baseUrl === config.worldApiBaseUrl && config.error) throw new ApiError(config.error, 'CONFIGURATION_ERROR');
  if (baseUrl === config.floodApiBaseUrl && config.floodError) throw new ApiError(config.floodError, 'CONFIGURATION_ERROR');
  if (baseUrl === config.incidentsApiBaseUrl && config.incidentsError) throw new ApiError(config.incidentsError, 'CONFIGURATION_ERROR');
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
    if (!validate(value)) throw new ApiError('La respuesta no coincide con el contrato de la API.', 'INVALID_RESPONSE', response.status, response.headers.get('x-request-id') ?? undefined);
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

function isEvacuationMetrics(value: unknown): value is EvacuationMetrics {
  return isObject(value)
    && ['total_agents', 'evacuated_agents', 'isolated_agents', 'waiting_agents', 'blocked_edges', 'caution_edges', 'shelters_at_capacity', 'reroute_count'].every(key => isNatural(value[key]))
    && ['average_evacuation_time', 'simulation_total_duration'].every(key => isNumber(value[key]) && Number(value[key]) >= 0)
    && Number(value.evacuated_agents) + Number(value.isolated_agents) + Number(value.waiting_agents) <= Number(value.total_agents);
}

function isScenario(value: unknown): value is ScenarioSnapshot {
  if (!isObject(value) || !isObject(value.performance) || !isObject(value.data_provenance)) return false;
  const performance = value.performance, provenance = value.data_provenance;
  return value.scenario_type === 'urban_flood' && isNatural(value.simulation_step) && isNatural(value.world_version)
    && typeof value.graph_version === 'string'
    && ['simulation_time', 'simulation_duration', 'time_step', 'rainfall'].every(key => isNumber(value[key]) && Number(value[key]) >= 0)
    && Number(value.rainfall) <= 1 && Number(value.time_step) > 0
    && Array.isArray(value.flood_zones) && value.flood_zones.length <= 32 && value.flood_zones.every(zone => isObject(zone)
      && typeof zone.id === 'string' && isPoint(zone.center) && isNumber(zone.radius_m) && zone.radius_m > 0
      && isNumber(zone.intensity) && zone.intensity >= 0 && zone.intensity <= 1)
    && Array.isArray(value.road_conditions) && value.road_conditions.length <= 20000 && value.road_conditions.every(road => isObject(road)
      && typeof road.edge_id === 'string' && ['passable', 'caution', 'blocked'].includes(String(road.state))
      && typeof road.risk_source === 'string' && isNumber(road.risk_score) && road.risk_score >= 0 && road.risk_score <= 1
      && isNatural(road.updated_at_simulation_step) && isNumber(road.cost_multiplier) && road.cost_multiplier >= 1)
    && Array.isArray(value.shelter_conditions) && value.shelter_conditions.length === 4 && value.shelter_conditions.every(shelter => isObject(shelter)
      && typeof shelter.shelter_id === 'string' && ['available', 'full', 'exposed', 'inaccessible'].includes(String(shelter.state))
      && isNumber(shelter.risk_score) && shelter.risk_score >= 0 && shelter.risk_score <= 1 && isNatural(shelter.updated_at_simulation_step))
    && Array.isArray(value.agents) && value.agents.length <= 200 && value.agents.every(agent => isObject(agent)
      && typeof agent.id === 'string' && typeof agent.current_node === 'string' && typeof agent.target_shelter_id === 'string'
      && ['moving', 'waiting', 'isolated', 'evacuated'].includes(String(agent.state))
      && ['preventive', 'late', 'adaptive'].includes(String(agent.behavior)) && isStrings(agent.planned_route)
      && (agent.evacuation_time === undefined || isNumber(agent.evacuation_time) && agent.evacuation_time >= 0))
    && isEvacuationMetrics(value.evacuation_metrics) && value.evacuation_metrics.total_agents === value.agents.length
    && ['simulation_step_latency_ms', 'simulation_total_duration_ms'].every(key => isNumber(performance[key]) && Number(performance[key]) >= 0)
    && ['graph_source', 'model', 'elevation_source', 'disclaimer'].every(key => typeof provenance[key] === 'string');
}

function isCandidate(value: unknown): value is LabCandidate {
  return isPoint(value) && isObject(value) && typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 64
    && typeof value.label === 'string' && value.label.length > 0 && value.label.length <= 120
    && isNatural(value.capacity) && value.capacity >= 1 && value.capacity <= 200;
}

function isLabConfig(value: unknown): value is LabRunConfig {
  return isObject(value) && ['competition', 'full'].includes(String(value.mode)) && Number.isSafeInteger(value.seed)
    && ['storm', 'constant', 'pulse'].includes(String(value.rainfall_profile))
    && isNumber(value.rainfall_intensity) && value.rainfall_intensity >= 0 && value.rainfall_intensity <= 1
    && isNumber(value.simulation_duration) && value.simulation_duration >= 1 && value.simulation_duration <= 10000
    && ['preventive', 'late', 'adaptive'].includes(String(value.evacuation_behavior))
    && isNatural(value.agents) && value.agents >= 1 && value.agents <= 200
    && isNatural(value.interval_ms) && value.interval_ms <= 5000
    && Array.isArray(value.shelters) && value.shelters.length === 4 && value.shelters.every(isCandidate);
}

function isLabComparison(value: unknown): value is LabComparison {
  if (!isObject(value) || typeof value.id !== 'string' || !['running', 'finished', 'failed'].includes(String(value.state))
    || !isNatural(value.progress) || value.progress > 2 || typeof value.message !== 'string' || !Array.isArray(value.results) || value.results.length > 2) return false;
  const results = value.results;
  if (!results.every(result => isObject(result) && ['original', 'custom'].includes(String(result.strategy))
    && ['competition', 'full'].includes(String(result.mode)) && Number.isSafeInteger(result.seed)
    && ['graph_version', 'origins_hash', 'config_hash'].every(key => typeof result[key] === 'string')
    && isNatural(result.total_agents) && result.total_agents > 0 && isEvacuationMetrics(result.evacuation_metrics)
    && result.total_agents === result.evacuation_metrics.total_agents
    && isNumber(result.evacuated_percentage) && Math.abs(result.evacuated_percentage - result.evacuation_metrics.evacuated_agents / result.total_agents * 100) < 1e-6
    && isNumber(result.step_latency_ms) && result.step_latency_ms >= 0)) return false;
  if (value.state === 'finished') {
    const [a, b] = results;
    if (results.length !== 2 || !isObject(a) || !isObject(b) || a.strategy === b.strategy
      || ['mode', 'seed', 'total_agents', 'origins_hash', 'config_hash'].some(key => a[key] !== b[key])) return false;
  }
  return true;
}

function isLabState(value: unknown): value is LabState {
  return isObject(value) && typeof value.run_id === 'string' && value.run_id.length > 0
    && ['idle', 'running', 'paused', 'finished', 'failed'].includes(String(value.state)) && isLabConfig(value.config)
    && value.mode === value.config.mode && typeof value.graph_version === 'string'
    && isScenario(value.scenario) && value.graph_version === value.scenario.graph_version
    && Array.isArray(value.shelters) && value.shelters.length === 4 && value.shelters.every(isShelter)
    && Array.isArray(value.origins) && value.origins.length === value.config.agents && value.origins.every(origin => isObject(origin)
      && typeof origin.id === 'string' && typeof origin.node_id === 'string' && isPoint(origin)
      && isNumber(origin.snap_distance_m) && origin.snap_distance_m >= 0)
    && Array.isArray(value.timeline) && value.timeline.length <= 1024 && value.timeline.every(entry => isObject(entry)
      && isNatural(entry.step) && isNumber(entry.simulation_time) && entry.simulation_time >= 0
      && isEvacuationMetrics(entry.evacuation_metrics) && isNumber(entry.step_latency_ms) && entry.step_latency_ms >= 0)
    && (value.comparison === undefined || isLabComparison(value.comparison))
    && (value.incident_applications === undefined || Array.isArray(value.incident_applications)
      && value.incident_applications.every(application => isIncidentApplication(application) && application.run_id === value.run_id));
}

const incidentTypes = ['flooded_road', 'road_closed', 'landslide', 'fallen_tree', 'bridge_damage', 'other'];
const incidentStates = ['pending', 'corroborated', 'verified', 'rejected', 'expired'];
const incidentSources = ['citizen', 'synthetic', 'official'];
const isId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
const isDate = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
function isIncident(value: unknown): value is Incident {
  if (!isObject(value) || !isObject(value.evidence_metadata)) return false;
  return value.schema_version === 1 && isId(value.incident_id) && incidentTypes.includes(String(value.incident_type))
    && isNumber(value.latitude) && Math.abs(value.latitude) <= 90 && isNumber(value.longitude) && Math.abs(value.longitude) <= 180
    && typeof value.description === 'string' && Array.from(value.description).length <= 500
    && ['low', 'moderate', 'high', 'unknown'].includes(String(value.severity_reported))
    && ['passable', 'restricted', 'blocked', 'unknown'].includes(String(value.road_passability_reported))
    && ['event_time', 'received_at', 'expires_at', 'updated_at'].every(key => isDate(value[key]))
    && incidentSources.includes(String(value.source_type)) && incidentStates.includes(String(value.verification_status))
    && value.evidence_metadata.attachment_count === 0 && value.evidence_metadata.storage_status === 'not_supported'
    && isStrings(value.affected_edge_ids) && value.affected_edge_ids.length <= 5 && typeof value.graph_version === 'string'
    && isNumber(value.snap_distance_m) && value.snap_distance_m >= 0 && isNumber(value.location_precision_m) && value.location_precision_m >= 0
    && ['manual', 'device'].includes(String(value.location_method));
}

function isIncidentList(value: unknown): value is IncidentList {
  return isObject(value) && Array.isArray(value.incidents) && value.incidents.every(isIncident)
    && isNatural(value.total) && value.total >= value.incidents.length && isNatural(value.limit) && value.limit >= 1 && value.limit <= 200
    && value.incidents.length <= value.limit && isNatural(value.offset) && typeof value.has_more === 'boolean';
}

function isIncidentInfo(value: unknown): value is IncidentServiceInfo {
  if (!isObject(value) || !isObject(value.bounds)) return false;
  const bounds = value.bounds;
  return typeof value.enabled === 'boolean' && value.schema_version === 1
    && ['min_latitude', 'max_latitude', 'min_longitude', 'max_longitude'].every(key => isNumber(bounds[key]))
    && Number(bounds.min_latitude) < Number(bounds.max_latitude) && Number(bounds.min_longitude) < Number(bounds.max_longitude)
    && isNatural(value.max_description_length) && value.max_description_length > 0 && isNumber(value.max_snap_distance_m) && value.max_snap_distance_m > 0
    && typeof value.verification_notice === 'string' && value.photo_uploads_enabled === false;
}

function isResolution(value: unknown): value is IncidentResolution {
  return isObject(value) && typeof value.matched === 'boolean' && typeof value.ambiguous === 'boolean'
    && typeof value.message === 'string' && typeof value.graph_version === 'string' && isNumber(value.max_snap_distance_m)
    && value.max_snap_distance_m > 0 && Array.isArray(value.candidates) && value.candidates.length <= 5
    && value.candidates.every(edge => isObject(edge) && ['edge_id', 'road_type', 'from_node_id', 'to_node_id'].every(key => typeof edge[key] === 'string')
      && isNumber(edge.distance_m) && edge.distance_m >= 0 && isNumber(edge.latitude) && Math.abs(edge.latitude) <= 90
      && isNumber(edge.longitude) && Math.abs(edge.longitude) <= 180)
    && (!value.matched || !value.ambiguous && value.candidates.length > 0);
}

function isIncidentApplication(value: unknown): value is IncidentApplication {
  return isObject(value) && ['application_id', 'incident_id', 'run_id'].every(key => isId(value[key]))
    && isStrings(value.affected_edge_ids) && value.affected_edge_ids.length >= 1 && value.affected_edge_ids.length <= 5
    && isNatural(value.simulation_step) && isNatural(value.world_version) && incidentSources.includes(String(value.source_type))
    && incidentStates.includes(String(value.verification_status_at_application)) && ['blocked', 'caution'].includes(String(value.effect))
    && isNatural(value.expires_at_simulation_step) && value.expires_at_simulation_step > value.simulation_step && isDate(value.applied_at);
}

function isIncidentApplyResult(value: unknown): value is IncidentApplyResult {
  return isObject(value) && isIncident(value.incident) && isIncidentApplication(value.application) && isLabState(value.state)
    && typeof value.already_applied === 'boolean' && value.application.incident_id === value.incident.incident_id
    && value.application.run_id === value.state.run_id && value.application.world_version <= value.state.scenario.world_version;
}

export interface IncidentFilters {
  bbox?: string;
  incident_type?: Incident['incident_type'];
  verification_status?: Incident['verification_status'];
  received_after?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}

function incidentRequest<T>(path: string, validate: (value: unknown) => value is T, init?: RequestInit, signal?: AbortSignal): Promise<T> {
  return request(path, validate, init, signal, config.incidentsApiBaseUrl);
}

function isLabCatalog(value: unknown): value is LabCatalog {
  return isObject(value) && isLabConfig(value.default_config) && Array.isArray(value.modes) && value.modes.length === 2
    && value.modes.every(mode => isObject(mode) && ['competition', 'full'].includes(String(mode.id))
      && ['name', 'graph_version', 'source', 'coverage', 'disabled_reason'].every(key => typeof mode[key] === 'string')
      && isNatural(mode.nodes) && isNatural(mode.edges) && ['enabled', 'experimental', 'preview_available'].every(key => typeof mode[key] === 'boolean'))
    && Array.isArray(value.presets) && value.presets.every(preset => isObject(preset)
      && ['id', 'name', 'description'].every(key => typeof preset[key] === 'string') && isLabConfig(preset.config))
    && Array.isArray(value.original_shelters) && value.original_shelters.length === 4 && value.original_shelters.every(isCandidate)
    && isNumber(value.max_snap_distance_m) && value.max_snap_distance_m > 0 && typeof value.disclaimer === 'string';
}

function isLabValidation(value: unknown): value is LabCandidateValidation {
  return isObject(value) && typeof value.valid === 'boolean' && Array.isArray(value.candidates) && value.candidates.length <= 4
    && value.candidates.every(candidate => isObject(candidate) && typeof candidate.id === 'string' && typeof candidate.label === 'string'
      && isNumber(candidate.lat) && isNumber(candidate.lng) && isNumber(candidate.capacity)
      && typeof candidate.node_id === 'string' && isNumber(candidate.snapped_lat) && isNumber(candidate.snapped_lng)
      && isNumber(candidate.snap_distance_m) && candidate.snap_distance_m >= 0 && typeof candidate.valid === 'boolean' && typeof candidate.message === 'string')
    && (!value.valid || value.candidates.length === 4 && value.candidates.every(candidate => isObject(candidate) && candidate.valid));
}

function labRequest<T>(path: string, validate: (value: unknown) => value is T, init?: RequestInit, signal?: AbortSignal): Promise<T> {
  return request(path, validate, init, signal, config.floodApiBaseUrl);
}

function labMutation<T>(path: string, validate: (value: unknown) => value is T, body: unknown, csrf: string): Promise<T> {
  return labRequest(path, validate, { method: 'POST', credentials: 'include', headers: { 'X-CSRF-Token': csrf }, body: JSON.stringify(body) });
}

export const api = {
  incidentInfo: (signal?: AbortSignal) => incidentRequest('/v1/incidents/config', isIncidentInfo, undefined, signal),
  incidents: (filters: IncidentFilters = {}, signal?: AbortSignal) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== '') query.set(key, String(value));
    return incidentRequest(`/v1/incidents${query.size ? `?${query}` : ''}`, isIncidentList, undefined, signal);
  },
  incident: (id: string, signal?: AbortSignal) => incidentRequest(`/v1/incidents/${encodeURIComponent(id)}`, isIncident, undefined, signal),
  resolveIncident: (input: IncidentLocation) => incidentRequest('/v1/incidents/resolve', isResolution, { method: 'POST', body: JSON.stringify(input) }),
  createIncident: (input: IncidentCreate, key: string) => incidentRequest('/v1/incidents', isIncident,
    { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(input) }),
  createSyntheticIncident: (input: IncidentCreate, key: string, csrf: string) => labRequest('/lab/incidents/synthetic', isIncident,
    { method: 'POST', credentials: 'include', headers: { 'X-CSRF-Token': csrf, 'Idempotency-Key': key }, body: JSON.stringify(input) }),
  reviewIncident: (id: string, input: IncidentStatusUpdate, csrf: string) => labMutation(`/lab/incidents/${encodeURIComponent(id)}/status`, isIncident, input, csrf),
  applyFloodIncident: (id: string, expectedRunId: string, csrf: string, durationSteps = 20, effect: 'blocked' | 'caution' = 'blocked') => labMutation(`/lab/incidents/${encodeURIComponent(id)}/apply`, isIncidentApplyResult,
    { expected_run_id: expectedRunId, duration_steps: durationSteps, effect, experimental_ack: true }, csrf),
  floodCatalog: (signal?: AbortSignal) => labRequest('/lab/catalog', isLabCatalog, undefined, signal),
  floodState: (signal?: AbortSignal) => labRequest('/lab/state', isLabState, undefined, signal),
  floodSession: (signal?: AbortSignal) => labRequest<LabSession>('/lab/session', (value): value is LabSession => isObject(value)
    && typeof value.enabled === 'boolean' && typeof value.authenticated === 'boolean' && typeof value.csrf_token === 'string', { credentials: 'include' }, signal),
  floodGraph: (signal?: AbortSignal, options?: { runId?: string; mode?: string }) => {
    const query = new URLSearchParams(options?.mode ? { mode: options.mode } : options?.runId ? { run_id: options.runId } : {});
    return labRequest<Graph>(`/lab/graph${query.size ? `?${query}` : ''}`, isGraph, undefined, signal);
  },
  startFlood: (runConfig: LabRunConfig, expectedRunId: string, csrf: string) => labMutation('/lab/runs', isLabState, { config: runConfig, expected_run_id: expectedRunId }, csrf),
  floodAction: (action: LabAction['action'], expectedRunId: string, csrf: string, intervalMs?: number) => labMutation('/lab/actions', isLabState,
    { action, expected_run_id: expectedRunId, ...(intervalMs === undefined ? {} : { interval_ms: intervalMs }) }, csrf),
  validateFloodCandidates: (mode: LabRunConfig['mode'], candidates: LabCandidate[], csrf: string) => labMutation('/lab/candidates/validate', isLabValidation, { mode, candidates }, csrf),
  compareFlood: (runConfig: LabRunConfig, expectedRunId: string, csrf: string) => labMutation('/lab/comparisons', isLabState, { config: runConfig, expected_run_id: expectedRunId }, csrf),
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
