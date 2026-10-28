import type { ErrorResponse, HealthResponse, Graph, WorldSnapshot, Survivor, Shelter, Zombie, SimulationInfo, SimulationCatalog, OperatorSession, StartSimulation } from '@corodev/contracts';
import type { ScenarioSnapshot, EvacuationMetrics, LabState, LabCatalog, LabSession, LabCandidate, LabRunConfig, LabCandidateValidation, LabComparison, LabAction } from '@corodev/contracts';
import type { IncidentCreate, IncidentServiceInfo, IncidentLocation, IncidentResolution, IncidentApplication, IncidentApplyResult } from '@corodev/contracts';
import type { ReferenceStatus, ReferenceCollection, ReferenceProvenance, OfficialRainEvents, LabTelemetry } from '@corodev/contracts';
import type { SimulationCapabilities, SimulationCreateRequest, SimulationCreated, SimulationMetadata, SimulationState, SimulationResults, PublishedSimulation } from '@corodev/contracts';
import { config } from '../lib/config';
import type { ModeratedIncident as Incident, ModeratedIncidentList as IncidentList, IncidentModerationUpdate as IncidentStatusUpdate, IncidentModerationPermissions } from './incidentTypes';
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

const publicResponses = new Map<string, { etag: string; value: unknown }>();

async function request<T>(path: string, validate: (value: unknown) => value is T, init?: RequestInit, signal?: AbortSignal, baseUrl = config.worldApiBaseUrl, conditional = false): Promise<T> {
  if (baseUrl === config.worldApiBaseUrl && config.error) throw new ApiError(config.error, 'CONFIGURATION_ERROR');
  if (baseUrl === config.floodApiBaseUrl && config.floodError) throw new ApiError(config.floodError, 'CONFIGURATION_ERROR');
  if (baseUrl === config.incidentsApiBaseUrl && config.incidentsError) throw new ApiError(config.incidentsError, 'CONFIGURATION_ERROR');
  const cacheKey = `${baseUrl}${path}`;
  const cached = conditional ? publicResponses.get(cacheKey) : undefined;
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, config.timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init, signal: controller.signal,
      headers: { Accept: 'application/json', ...(cached ? { 'If-None-Match': cached.etag } : {}), ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
    });
    if (response.status === 304 && cached && validate(cached.value)) return cached.value;
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      if (isErrorResponse(value)) {
        const { code, message, requestId, details } = value.error;
        throw new ApiError(message, code, response.status, requestId, details);
      }
      throw new ApiError('La API devolvió un error. Inténtalo de nuevo.', 'HTTP_ERROR', response.status, response.headers.get('x-request-id') ?? undefined);
    }
    if (!validate(value)) throw new ApiError('La respuesta no coincide con el contrato de la API.', 'INVALID_RESPONSE', response.status, response.headers.get('x-request-id') ?? undefined);
    if (conditional && response.headers.get('ETag')) {
      if (publicResponses.size > 8) publicResponses.clear();
      publicResponses.set(cacheKey, { etag: response.headers.get('ETag')!, value });
    }
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
    && (value.spawn_zone_id === undefined || typeof value.spawn_zone_id === 'string')
    && (value.vehicle_id === undefined || typeof value.vehicle_id === 'string');
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
function isProbability(value: unknown): value is number { return isNumber(value) && value >= 0 && value <= 1; }
function isForecast(value: unknown): boolean {
  return isObject(value) && isNatural(value.turn) && (value.horizon === 1 || value.horizon === 2)
    && Array.isArray(value.node_risks) && value.node_risks.every(node => isObject(node) && typeof node.node_id === 'string' && isProbability(node.one_turn_probability) && isProbability(node.two_turn_probability))
    && Array.isArray(value.edge_risks) && value.edge_risks.every(edge => isObject(edge) && typeof edge.from === 'string' && typeof edge.to === 'string' && isProbability(edge.probability));
}
function isAgentPolicies(value: Record<string, unknown>): boolean {
  const pro = value.pro;
  return (value.mode === undefined || ['official', 'experimental'].includes(String(value.mode)))
    && (value.zombie_policy === undefined || ['classic_random', 'correlated_random_walk', 'adaptive_exploration'].includes(String(value.zombie_policy)))
    && (value.evacuation_algorithm === undefined || ['legacy_current', 'baseline_shortest_path', 'dynamic_risk_astar', 'predictive_temporal_astar'].includes(String(value.evacuation_algorithm)))
    && (pro === undefined || isObject(pro) && ['runner_prediction', 'shelter_assignment', 'rescue_fleet'].every(key => pro[key] === undefined || typeof pro[key] === 'boolean'));
}
function isAnalytics(value: unknown): boolean {
  if (!isObject(value)) return false;
  const prediction = value.prediction;
  return ['deaths_by_type', 'deaths_by_cause'].every(key => isObject(value[key]) && Object.values(value[key]).every(isNatural))
    && isNatural(value.replans) && isNatural(value.oscillations) && isNumber(value.mean_arrival_turn) && value.mean_arrival_turn >= 0 && isNumber(value.mean_route_efficiency) && value.mean_route_efficiency >= 0
    && Array.isArray(value.agents) && value.agents.every(agent => isObject(agent) && typeof agent.id === 'string' && ['arrival_turn', 'moves', 'oscillations', 'replans'].every(key => isNatural(agent[key])) && isNumber(agent.route_efficiency) && agent.route_efficiency >= 0)
    && isObject(prediction) && ['samples', 'hits', 'misses', 'false_positives'].every(key => isNatural(prediction[key])) && isProbability(prediction.brier_score);
}
function isWorld(value: unknown): value is WorldSnapshot {
  if (!isObject(value) || !isObject(value.metrics)) return false;
  const metrics = value.metrics, fleetMetrics = value.fleet_metrics;
  return isNatural(value.turn) && isNatural(value.world_version) && typeof value.graph_version === 'string'
    && Array.isArray(value.zombies) && value.zombies.every(isZombie)
    && Array.isArray(value.survivors) && value.survivors.every(isSurvivor)
    && Array.isArray(value.shelters) && value.shelters.every(isShelter) && isStrings(value.blocked_edges)
    && Array.isArray(value.events) && value.events.every(event => isObject(event) && isNatural(event.turn)
      && ['type', 'entity_id', 'edge_id', 'message'].every(field => typeof event[field] === 'string'))
    && ['evacuated', 'bitten', 'active', 'turns', 'requests_success', 'requests_invalid', 'requests_timeout'].every(field => isNatural(metrics[field]))
    && ['http_p50_ms', 'http_p95_ms', 'http_p99_ms', 'availability'].every(field => isNumber(metrics[field]) && Number(metrics[field]) >= 0)
    && Number(metrics.availability) <= 1
    && (value.fleet === undefined || Array.isArray(value.fleet) && value.fleet.length <= 5 && value.fleet.every(vehicle => isObject(vehicle)
      && ['id', 'current_node', 'target_survivor_id', 'target_shelter_id', 'state'].every(key => typeof vehicle[key] === 'string')
      && isStrings(vehicle.path) && isStrings(vehicle.passenger_ids) && isNatural(vehicle.capacity) && vehicle.capacity <= 4
      && vehicle.passenger_ids.length <= vehicle.capacity && new Set(vehicle.passenger_ids).size === vehicle.passenger_ids.length))
    && (fleetMetrics === undefined || isObject(fleetMetrics) && ['pickups', 'delivered', 'moves', 'useful_trips'].every(key => isNatural(fleetMetrics[key])))
    && (value.simulation === undefined || isSimulation(value.simulation));
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
      && typeof round.name === 'string' && isNatural(round.survivors) && isNatural(round.turns) && (round.zombie_counts === undefined || isZombieCounts(round.zombie_counts)));
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

function isHydraulic(value: unknown): boolean {
  if (!isObject(value) || !isObject(value.grid) || !isObject(value.mass_balance)) return false;
  const grid = value.grid, mass = value.mass_balance;
  const count = Number(grid.rows) * Number(grid.cols);
  return ['rainfall_runoff_2d', 'compound_flood_2d'].includes(String(value.model)) && typeof value.terrain_source === 'string'
    && isPoint(grid.origin) && isNatural(grid.rows) && Number(grid.rows) > 0 && isNatural(grid.cols) && Number(grid.cols) > 0
    && count <= 4096 && isObject(grid.origin) && Number(grid.origin.lat) + Number(grid.lat_step) * Number(grid.rows) <= 90 && Number(grid.origin.lng) + Number(grid.lng_step) * Number(grid.cols) <= 180
    && ['cell_size_m', 'lat_step', 'lng_step'].every(key => isNumber(grid[key]) && Number(grid[key]) > 0)
    && Array.isArray(value.depths_m) && value.depths_m.length === count && value.depths_m.every(depth => isNumber(depth) && depth >= 0)
    && ['flooded_area_m2', 'max_depth_m', 'rainfall_mm_h', 'hydrological_time_seconds'].every(key => isNumber(value[key]) && Number(value[key]) >= 0)
    && Number(value.rainfall_mm_h) <= 120
    && ['initial_storage_m3', 'rainfall_m3', 'channel_inflow_m3', 'sea_inflow_m3', 'infiltration_m3', 'drainage_m3', 'sea_outflow_m3', 'stored_m3'].every(key => isNumber(mass[key]) && Number(mass[key]) >= 0)
    && isNumber(mass.residual_m3);
}

function isHydrologyConfig(value: unknown): boolean {
  if (!isObject(value)) return false;
  const ranges: Record<string, [number, number]> = { seconds_per_turn: [1, 300], antecedent_rain_hours: [0, 24], initial_saturation: [0, 1], initial_water_depth_m: [0, 2], sea_level_m: [-2, 5], channel_inflow_m3_s: [0, 50], cell_size_m: [50, 1000], infiltration_mm_h: [0, 100], drainage_mm_h: [0, 100], caution_depth_m: [.01, 1], blocked_depth_m: [.02, 2], hysteresis_m: [0, 1] };
  return Object.entries(value).every(([key, parameter]) => ranges[key] && isNumber(parameter) && parameter >= ranges[key][0] && parameter <= ranges[key][1])
    && Number(value.blocked_depth_m ?? .3) > Number(value.caution_depth_m ?? .1)
    && Number(value.hysteresis_m ?? .03) < Number(value.caution_depth_m ?? .1);
}

function isScenario(value: unknown): value is ScenarioSnapshot {
  if (!isObject(value) || !isObject(value.performance) || !isObject(value.data_provenance)) return false;
  const performance = value.performance, provenance = value.data_provenance;
  return value.scenario_type === 'urban_flood' && isNatural(value.simulation_step) && isNatural(value.world_version)
    && typeof value.graph_version === 'string'
    && ['simulation_time', 'simulation_duration', 'time_step', 'rainfall'].every(key => isNumber(value[key]) && Number(value[key]) >= 0)
    && Number(value.rainfall) <= 1 && Number(value.time_step) > 0
    && (value.hydraulic === undefined || isHydraulic(value.hydraulic))
    && Array.isArray(value.flood_zones) && value.flood_zones.length <= 32 && value.flood_zones.every(zone => isObject(zone)
      && typeof zone.id === 'string' && isPoint(zone.center) && isNumber(zone.radius_m) && zone.radius_m > 0
      && isNumber(zone.intensity) && zone.intensity >= 0 && zone.intensity <= 1)
    && Array.isArray(value.road_conditions) && value.road_conditions.length <= 20000 && value.road_conditions.every(road => isObject(road)
      && typeof road.edge_id === 'string' && ['passable', 'caution', 'blocked'].includes(String(road.state))
      && typeof road.risk_source === 'string' && isNumber(road.risk_score) && road.risk_score >= 0 && road.risk_score <= 1
      && (road.depth_m === undefined || isNumber(road.depth_m) && road.depth_m >= 0)
      && isNatural(road.updated_at_simulation_step) && isNumber(road.cost_multiplier) && road.cost_multiplier >= 1)
    && Array.isArray(value.shelter_conditions) && value.shelter_conditions.length >= 1 && value.shelter_conditions.length <= 4 && value.shelter_conditions.every(shelter => isObject(shelter)
      && typeof shelter.shelter_id === 'string' && ['available', 'full', 'exposed', 'inaccessible'].includes(String(shelter.state))
      && isNumber(shelter.risk_score) && shelter.risk_score >= 0 && shelter.risk_score <= 1 && isNatural(shelter.updated_at_simulation_step))
    && Array.isArray(value.agents) && value.agents.length <= 200 && value.agents.every(agent => isObject(agent)
      && typeof agent.id === 'string' && typeof agent.current_node === 'string' && typeof agent.target_shelter_id === 'string'
      && ['moving', 'waiting', 'isolated', 'evacuated'].includes(String(agent.state))
      && ['preventive', 'late', 'adaptive'].includes(String(agent.behavior)) && isStrings(agent.planned_route)
      && (agent.evacuation_time === undefined || isNumber(agent.evacuation_time) && agent.evacuation_time >= 0))
    && isEvacuationMetrics(value.evacuation_metrics) && value.evacuation_metrics.total_agents === value.agents.length
    && ['hydraulic_step_latency_ms', 'evacuation_step_latency_ms'].every(key => performance[key] === undefined || isNumber(performance[key]) && Number(performance[key]) >= 0)
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
    && isNatural(value.simulation_duration) && value.simulation_duration >= 30 && value.simulation_duration <= 3000
    && (value.hydraulic_model === undefined || ['rainfall_runoff_2d', 'compound_flood_2d'].includes(String(value.hydraulic_model)))
    && (value.hydrology === undefined || isHydrologyConfig(value.hydrology))
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
    && ['idle', 'running', 'paused', 'finished', 'failed', 'cancelled'].includes(String(value.state)) && isLabConfig(value.config)
    && value.mode === value.config.mode && typeof value.graph_version === 'string'
    && (value.runtime_elapsed_ms === undefined || isNumber(value.runtime_elapsed_ms) && value.runtime_elapsed_ms >= 0)
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
function isHttpsLink(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try { const url = new URL(value); return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password; } catch { return false; }
}
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
    && ['manual', 'device'].includes(String(value.location_method))
    && (value.map_withdrawn === undefined || typeof value.map_withdrawn === 'boolean')
    && (value.moderation_note === undefined || typeof value.moderation_note === 'string' && Array.from(value.moderation_note).length <= 280)
    && (value.official_source === undefined || isObject(value.official_source) && typeof value.official_source.title === 'string' && Array.from(value.official_source.title).length >= 3 && Array.from(value.official_source.title).length <= 160 && isHttpsLink(value.official_source.url) && isDate(value.official_source.recorded_at));
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
  map_visibility?: 'active' | 'withdrawn';
  received_after?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}

// Keep confirmed moderation newer than any in-flight poll. Go timestamps may
// differ by one nanosecond; Date.parse alone would collapse those versions.
const confirmedIncidents = new Map<string, Incident>();
function compareIncidentTime(left: string, right: string): number {
  const difference = Date.parse(left) - Date.parse(right);
  if (difference) return difference;
  const fraction = (value: string) => (value.match(/\.(\d{1,9})/)?.[1] ?? '').padEnd(9, '0');
  return fraction(left).localeCompare(fraction(right));
}
function rememberIncident(value: Incident): Incident {
  const confirmed = confirmedIncidents.get(value.incident_id);
  if (confirmed && compareIncidentTime(value.updated_at, confirmed.updated_at) <= 0) return confirmed;
  confirmedIncidents.set(value.incident_id, value);
  if (confirmedIncidents.size > 1024) confirmedIncidents.delete(confirmedIncidents.keys().next().value!);
  return value;
}
export function reconcileIncidentList(value: IncidentList, filters: IncidentFilters = {}): IncidentList {
  const incidents = value.incidents.map(rememberIncident).filter(incident => {
    if (Boolean(incident.map_withdrawn) !== (filters.map_visibility === 'withdrawn')) return false;
    if (filters.verification_status) return incident.verification_status === filters.verification_status;
    return filters.map_visibility === 'withdrawn' || !['rejected', 'expired'].includes(incident.verification_status);
  });
  return { ...value, incidents, total: Math.max(incidents.length, value.total - (value.incidents.length - incidents.length)) };
}

function incidentRequest<T>(path: string, validate: (value: unknown) => value is T, init?: RequestInit, signal?: AbortSignal): Promise<T> {
  return request(path, validate, init, signal, config.incidentsApiBaseUrl);
}

function isDurationLimits(value: unknown): boolean {
  return isObject(value) && ['min_ticks', 'max_ticks', 'default_ticks'].every(key => isNatural(value[key]) && Number(value[key]) > 0)
    && Number(value.min_ticks) <= Number(value.default_ticks) && Number(value.default_ticks) <= Number(value.max_ticks);
}

function isLabCatalog(value: unknown): value is LabCatalog {
  return isObject(value) && isLabConfig(value.default_config) && (value.duration_limits === undefined || isDurationLimits(value.duration_limits)) && Array.isArray(value.modes) && value.modes.length === 2
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
function floodControl<T>(path: string, validate: (value: unknown) => value is T, body: unknown): Promise<T> {
  return labRequest(path, validate, { method: 'POST', credentials: 'omit', body: JSON.stringify(body) });
}

function isProvenance(value: unknown): value is ReferenceProvenance {
  return isObject(value) && ['synthetic', 'official_reference', 'official_observation', 'citizen_report'].includes(String(value.category))
    && ['source', 'url', 'attribution', 'license', 'original_crs', 'dataset_version', 'temporal_scope'].every(key => typeof value[key] === 'string')
    && isDate(value.consulted_at) && value.output_crs === 'EPSG:4326' && Array.isArray(value.source_years) && value.source_years.every(isNatural)
    && (value.portal_modified_at === undefined || isDate(value.portal_modified_at));
}
function isReferenceStatus(value: unknown): value is ReferenceStatus {
  if (!isObject(value) || !isObject(value.metrics)) return false;
  const metrics = value.metrics;
  return isObject(value) && value.schema_version === 1 && ['offline', 'online', 'disabled'].includes(String(value.mode))
    && ['cached', 'stale', 'unavailable', 'disabled'].includes(String(value.availability)) && typeof value.refreshing === 'boolean'
    && ['unknown', 'ok', 'error', 'offline'].includes(String(value.provider_status)) && typeof value.message === 'string'
    && isNatural(value.feature_count) && isNatural(value.vertex_count) && isObject(value.metrics)
    && ['queries', 'provider_errors', 'cache_hits', 'cache_misses', 'last_query_ms', 'total_query_ms', 'response_bytes', 'last_refresh_ms'].every(key => isNumber(metrics[key]) && metrics[key] >= 0)
    && (value.provenance === undefined || isProvenance(value.provenance) && value.provenance.category === 'official_reference' && value.dataset_version === value.provenance.dataset_version);
}
function isReferenceCollection(value: unknown): value is ReferenceCollection {
  if (!isObject(value) || value.schema_version !== 1 || value.type !== 'FeatureCollection' || !isProvenance(value.provenance) || value.provenance.category !== 'official_reference'
    || !Array.isArray(value.features) || value.features.length > 500 || value.feature_count !== value.features.length || !isNatural(value.vertex_count)
    || !isNumber(value.generalization_degrees) || !Array.isArray(value.bbox) || value.bbox.length !== 4 || !value.bbox.every(isNumber)) return false;
  let vertices = 0;
  const valid = value.features.every(feature => isObject(feature) && feature.type === 'Feature' && typeof feature.id === 'string' && isObject(feature.properties)
    && feature.properties.object_id === feature.id && ['ALTA', 'MEDIA', 'BAJA'].includes(String(feature.properties.susceptibility))
    && isObject(feature.geometry) && feature.geometry.type === 'MultiPolygon' && Array.isArray(feature.geometry.coordinates) && feature.geometry.coordinates.length > 0
    && feature.geometry.coordinates.every(polygon => Array.isArray(polygon) && polygon.length > 0 && polygon.every(ring => Array.isArray(ring) && ring.length >= 4
      && JSON.stringify(ring[0]) === JSON.stringify(ring.at(-1)) && ring.every(point => { vertices++; return Array.isArray(point) && point.length === 2 && isNumber(point[0]) && Math.abs(point[0]) <= 180 && isNumber(point[1]) && Math.abs(point[1]) <= 90; }))));
  return valid && vertices === value.vertex_count && vertices <= 120000;
}
function isRainEvents(value: unknown): value is OfficialRainEvents {
  return isObject(value) && value.schema_version === 1 && isProvenance(value.provenance) && value.provenance.category === 'official_observation'
    && Array.isArray(value.events) && value.events.length <= 500 && value.events.every(event => isObject(event)
      && ['object_id', 'event', 'canton', 'event_date', 'closed_date'].every(key => typeof event[key] === 'string')
      && isNumber(event.latitude) && Math.abs(event.latitude) <= 90 && isNumber(event.longitude) && Math.abs(event.longitude) <= 180);
}

function isZombieCounts(value: unknown): boolean {
  return isObject(value) && ['walker', 'runner', 'horde', 'sleeper'].every(kind => Number.isSafeInteger(value[kind]) && Number(value[kind]) >= 0);
}
function isManagedMetadata(value: unknown): value is SimulationMetadata {
  return isObject(value) && typeof value.simulation_id === 'string' && value.simulation_id.length > 0
    && ['CREATED', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED'].includes(String(value.status))
    && ['zombie_outbreak', 'urban_flood'].includes(String(value.scenario)) && ['BASE', 'FULL_MANTA'].includes(String(value.graph_profile))
    && ['graph_version', 'created_at', 'started_at', 'updated_at', 'expires_at'].every(key => typeof value[key] === 'string')
    && ['tick', 'max_ticks', 'state_version', 'tick_interval_ms'].every(key => isNatural(value[key])) && Number.isSafeInteger(value.seed)
    && isObject(value.config) && (value.config.zombie_counts === undefined || isZombieCounts(value.config.zombie_counts)) && isAgentPolicies(value.config) && isNatural(value.config.survivors) && typeof value.config.round === 'string' && isStrings(value.config.refuge_ids)
    && (value.config.custom_shelters === undefined || Array.isArray(value.config.custom_shelters) && value.config.custom_shelters.length === 4 && value.config.custom_shelters.every(shelter => isObject(shelter) && typeof shelter.id === 'string' && typeof shelter.node_id === 'string' && isNatural(shelter.capacity) && shelter.capacity >= 1 && shelter.capacity <= 200))
    && (value.config.rainfall_intensity === undefined || isNumber(value.config.rainfall_intensity) && value.config.rainfall_intensity >= 0 && value.config.rainfall_intensity <= 1)
    && (value.access_token === undefined || typeof value.access_token === 'string' && value.access_token.length > 0);
}
function isManagedCreated(value: unknown): value is SimulationCreated {
  if (!isObject(value)) return false;
  const token = value.access_token;
  return isManagedMetadata(value) && typeof token === 'string' && token.length > 0;
}
function isManagedState(value: unknown): value is SimulationState {
  if (!isObject(value)) return false;
  const snapshot = value.snapshot, scenario = value.scenario_state, forecast = value.runner_forecast;
  return isManagedMetadata(value) && isWorld(snapshot)
    && snapshot.graph_version === value.graph_version && snapshot.turn === value.tick
    && (forecast === undefined || isForecast(forecast) && isObject(forecast) && forecast.turn === value.tick)
    && (value.scenario === 'urban_flood' ? isScenario(scenario) && scenario.graph_version === value.graph_version : scenario === undefined);
}
function isManagedResults(value: unknown): value is SimulationResults {
  if (!isObject(value) || !isObject(value.results)) return false;
  const results = value.results;
  return isManagedState(value)
    && ['initial_survivors', 'evacuated', 'bitten', 'active', 'refuges_used'].every(key => isNatural(results[key]))
    && isNumber(results.survival_rate) && results.survival_rate >= 0 && results.survival_rate <= 1
    && (results.analytics === undefined || isAnalytics(results.analytics));
}
function isCapabilities(value: unknown): value is SimulationCapabilities {
  if (!isObject(value) || !isObject(value.defaults) || !isObject(value.limits)) return false;
  const defaults = value.defaults, limits = value.limits;
  return Array.isArray(value.scenarios) && value.scenarios.every(scenario => isObject(scenario)
    && ['zombie_outbreak', 'urban_flood'].includes(String(scenario.id)) && typeof scenario.name === 'string' && typeof scenario.available === 'boolean' && typeof scenario.synthetic === 'boolean')
    && Array.isArray(value.graph_profiles) && value.graph_profiles.every(profile => isObject(profile)
      && ['BASE', 'FULL_MANTA'].includes(String(profile.id)) && typeof profile.name === 'string' && typeof profile.available === 'boolean'
      && typeof profile.graph_version === 'string' && isNatural(profile.nodes) && isNatural(profile.edges)
      && (profile.disabled_reason === undefined || typeof profile.disabled_reason === 'string'))
    && ['zombie_outbreak', 'urban_flood'].includes(String(defaults.scenario))
    && ['BASE', 'FULL_MANTA'].includes(String(defaults.graph_profile)) && Number.isSafeInteger(defaults.seed)
    && ['max_ticks', 'tick_interval_ms', 'survivors'].every(key => isNatural(defaults[key])) && typeof defaults.round === 'string'
    && (limits.min_ticks === undefined || isNatural(limits.min_ticks) && limits.min_ticks > 0 && limits.min_ticks <= Number(limits.max_ticks))
    && (limits.official_max_ticks === undefined || limits.official_max_ticks === 150)
    && ['max_active', 'max_full_active', 'max_retained', 'max_memory_bytes', 'min_tick_interval_ms', 'max_tick_interval_ms', 'max_ticks', 'max_survivors'].every(key => isNatural(limits[key]))
    && Array.isArray(value.rounds) && value.rounds.every(round => isObject(round) && typeof round.id === 'string' && typeof round.name === 'string' && isNatural(round.survivors) && isNatural(round.turns) && (round.zombie_counts === undefined || isZombieCounts(round.zombie_counts)));
}
const simulationPath = (id: string) => `/v1/simulations/${encodeURIComponent(id)}`;
const simulationAuth = (token: string) => ({ Authorization: `Bearer ${token}` });

function isPublished(value: unknown): value is PublishedSimulation {
  return isObject(value) && ['zombie_outbreak', 'urban_flood'].includes(String(value.scenario))
    && ['none', 'available', 'unavailable'].includes(String(value.availability))
    && (value.availability === 'available' ? isManagedState(value.simulation) && value.simulation.scenario === value.scenario
      && !('access_token' in value.simulation) : value.simulation === undefined);
}

export const api = {
  publishedSimulation: (scenario: 'zombie_outbreak' | 'urban_flood', signal?: AbortSignal) => request<PublishedSimulation>(`/v1/simulations/published/${scenario}`, (value): value is PublishedSimulation => isPublished(value) && value.scenario === scenario, { credentials: 'omit' }, signal, config.worldApiBaseUrl, true),
  publishedFlood: (signal?: AbortSignal) => request('/lab/published', isLabState, { credentials: 'omit' }, signal, config.floodApiBaseUrl, true),
  simulationCapabilities: (signal?: AbortSignal) => request<SimulationCapabilities>('/v1/simulations/capabilities', isCapabilities, undefined, signal),
  createSimulation: (input: SimulationCreateRequest, key: string) => request<SimulationCreated>('/v1/simulations', isManagedCreated,
    { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(input) }),
  simulationState: (id: string, token: string, signal?: AbortSignal) => request<SimulationState>(`${simulationPath(id)}/state`, isManagedState,
    { headers: simulationAuth(token) }, signal),
  simulationResults: (id: string, token: string, signal?: AbortSignal) => request<SimulationResults>(`${simulationPath(id)}/results`, isManagedResults,
    { headers: simulationAuth(token) }, signal),
  controlSimulation: (id: string, token: string, action: 'pause' | 'resume' | 'cancel') => request<SimulationMetadata>(`${simulationPath(id)}/${action}`, isManagedMetadata,
    { method: 'POST', headers: simulationAuth(token) }),
  restartSimulation: (id: string, token: string, key: string) => request<SimulationCreated>(`${simulationPath(id)}/restart`, isManagedCreated,
    { method: 'POST', headers: { ...simulationAuth(token), 'Idempotency-Key': key } }),
  referenceStatus: (signal?: AbortSignal) => labRequest('/v1/reference/status', isReferenceStatus, undefined, signal),
  susceptibilityReference: async (version: string, signal?: AbortSignal) => {
    const value = await labRequest(`/v1/reference/susceptibility?${new URLSearchParams({ version })}`, isReferenceCollection, undefined, signal);
    if (value.provenance.dataset_version !== version) throw new ApiError('La versión de referencia cambió. Actualiza su procedencia.', 'REFERENCE_CHANGED');
    return value;
  },
  rainEvents: (signal?: AbortSignal) => labRequest('/v1/reference/rain-events', isRainEvents, undefined, signal),
  refreshReference: (csrf: string) => labMutation('/lab/reference/refresh', isReferenceStatus, {}, csrf),
  labTelemetry: (signal?: AbortSignal) => labRequest<LabTelemetry>('/lab/telemetry', (value): value is LabTelemetry => isObject(value) && typeof value.run_id === 'string' && ['simulation_step', 'world_version', 'agents', 'edges', 'overlay_edges', 'overlay_update_ms', 'replanning_ms', 'simulation_step_ms', 'planning_calls'].every(key => isNumber(value[key]) && value[key] >= 0) && isObject(value.reference), undefined, signal),
  incidentInfo: (signal?: AbortSignal) => incidentRequest('/v1/incidents/config', isIncidentInfo, undefined, signal),
  incidents: async (filters: IncidentFilters = {}, signal?: AbortSignal) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== '') query.set(key, String(value));
    return reconcileIncidentList(await incidentRequest(`/v1/incidents${query.size ? `?${query}` : ''}`, isIncidentList, undefined, signal), filters);
  },
  incident: async (id: string, signal?: AbortSignal) => rememberIncident(await incidentRequest(`/v1/incidents/${encodeURIComponent(id)}`, isIncident, undefined, signal)),
  resolveIncident: (input: IncidentLocation) => incidentRequest('/v1/incidents/resolve', isResolution, { method: 'POST', body: JSON.stringify(input) }),
  createIncident: (input: IncidentCreate, key: string) => incidentRequest('/v1/incidents', isIncident,
    { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(input) }),
  createSyntheticIncident: (input: IncidentCreate, key: string, csrf: string) => labRequest('/lab/incidents/synthetic', isIncident,
    { method: 'POST', credentials: 'include', headers: { 'X-CSRF-Token': csrf, 'Idempotency-Key': key }, body: JSON.stringify(input) }),
  incidentModerationPermissions: (signal?: AbortSignal) => labRequest<IncidentModerationPermissions>('/lab/incidents/permissions', (value): value is IncidentModerationPermissions => isObject(value) && ['can_review', 'can_withdraw', 'can_mark_official', 'operator_login_available'].every(key => typeof value[key] === 'boolean'), { credentials: 'include' }, signal),
  reviewIncident: async (id: string, input: IncidentStatusUpdate, csrf: string) => rememberIncident(await labMutation(`/lab/incidents/${encodeURIComponent(id)}/status`, isIncident, input, csrf)),
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
  startFlood: (runConfig: LabRunConfig, expectedRunId: string) => floodControl('/lab/runs', isLabState, { config: runConfig, expected_run_id: expectedRunId }),
  floodAction: (action: LabAction['action'], expectedRunId: string, intervalMs?: number) => floodControl('/lab/actions', isLabState,
    { action, expected_run_id: expectedRunId, ...(intervalMs === undefined ? {} : { interval_ms: intervalMs }) }),
  validateFloodCandidates: (mode: LabRunConfig['mode'], candidates: LabCandidate[]) => floodControl('/lab/candidates/validate', isLabValidation, { mode, candidates }),
  compareFlood: (runConfig: LabRunConfig, expectedRunId: string) => floodControl('/lab/comparisons', isLabState, { config: runConfig, expected_run_id: expectedRunId }),
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
