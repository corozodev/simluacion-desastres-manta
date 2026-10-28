// GENERATED from packages/contracts/openapi.yaml. Do not edit.

// ignore_for_file: always_put_required_named_parameters_first, use_null_aware_elements

class RescueVehicle {
  const RescueVehicle({
    required this.id,
    required this.currentNode,
    required this.path,
    required this.passengerIds,
    required this.targetSurvivorId,
    required this.targetShelterId,
    required this.state,
    required this.capacity,
    this.waitReason,
  });

  final String id;
  final String currentNode;
  final List<String> path;
  final List<String> passengerIds;
  final String targetSurvivorId;
  final String targetShelterId;
  final String state;
  final int capacity;
  final String? waitReason;

  factory RescueVehicle.fromJson(Map<String, dynamic> json) => RescueVehicle(
    id: json['id'] as String,
    currentNode: json['current_node'] as String,
    path: (json['path'] as List).map((value) => value as String).toList(),
    passengerIds: (json['passenger_ids'] as List).map((value) => value as String).toList(),
    targetSurvivorId: json['target_survivor_id'] as String,
    targetShelterId: json['target_shelter_id'] as String,
    state: json['state'] as String,
    capacity: json['capacity'] as int,
    waitReason: json['wait_reason'] == null ? null : json['wait_reason'] as String,
  );

  Map<String, dynamic> toJson() => {
    'id': id,
    'current_node': currentNode,
    'path': path.map((value) => value).toList(),
    'passenger_ids': passengerIds.map((value) => value).toList(),
    'target_survivor_id': targetSurvivorId,
    'target_shelter_id': targetShelterId,
    'state': state,
    'capacity': capacity,
    if (waitReason != null) 'wait_reason': waitReason!,
  };
}

class RescueFleetMetrics {
  const RescueFleetMetrics({
    required this.pickups,
    required this.delivered,
    required this.moves,
    required this.usefulTrips,
  });

  final int pickups;
  final int delivered;
  final int moves;
  final int usefulTrips;

  factory RescueFleetMetrics.fromJson(Map<String, dynamic> json) => RescueFleetMetrics(
    pickups: json['pickups'] as int,
    delivered: json['delivered'] as int,
    moves: json['moves'] as int,
    usefulTrips: json['useful_trips'] as int,
  );

  Map<String, dynamic> toJson() => {
    'pickups': pickups,
    'delivered': delivered,
    'moves': moves,
    'useful_trips': usefulTrips,
  };
}

class GraphNode {
  const GraphNode({
    required this.id,
    required this.lat,
    required this.lng,
  });

  final String id;
  final double lat;
  final double lng;

  factory GraphNode.fromJson(Map<String, dynamic> json) => GraphNode(
    id: json['id'] as String,
    lat: (json['lat'] as num).toDouble(),
    lng: (json['lng'] as num).toDouble(),
  );

  Map<String, dynamic> toJson() => {
    'id': id,
    'lat': lat,
    'lng': lng,
  };
}

class GeoPoint {
  const GeoPoint({
    required this.lat,
    required this.lng,
  });

  final double lat;
  final double lng;

  factory GeoPoint.fromJson(Map<String, dynamic> json) => GeoPoint(
    lat: (json['lat'] as num).toDouble(),
    lng: (json['lng'] as num).toDouble(),
  );

  Map<String, dynamic> toJson() => {
    'lat': lat,
    'lng': lng,
  };
}

class SpawnZone {
  const SpawnZone({
    required this.id,
    required this.name,
    required this.source,
    required this.geometry,
    required this.nodeIds,
    required this.weight,
  });

  final String id;
  final String name;
  final String source;
  final List<GeoPoint> geometry;
  final List<String> nodeIds;
  final double weight;

  factory SpawnZone.fromJson(Map<String, dynamic> json) => SpawnZone(
    id: json['id'] as String,
    name: json['name'] as String,
    source: json['source'] as String,
    geometry: (json['geometry'] as List).map((value) => GeoPoint.fromJson(Map<String, dynamic>.from(value as Map))).toList(),
    nodeIds: (json['node_ids'] as List).map((value) => value as String).toList(),
    weight: (json['weight'] as num).toDouble(),
  );

  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'source': source,
    'geometry': geometry.map((value) => value.toJson()).toList(),
    'node_ids': nodeIds.map((value) => value).toList(),
    'weight': weight,
  };
}

class GraphEdge {
  const GraphEdge({
    required this.id,
    required this.from,
    required this.to,
    required this.distanceM,
    required this.roadType,
    required this.speedMps,
    required this.blocked,
    required this.directed,
    this.bridge,
    this.geometry,
  });

  final String id;
  final String from;
  final String to;
  final double distanceM;
  final String roadType;
  final double speedMps;
  final bool blocked;
  final bool directed;
  final bool? bridge;
  final List<GeoPoint>? geometry;

  factory GraphEdge.fromJson(Map<String, dynamic> json) => GraphEdge(
    id: json['id'] as String,
    from: json['from'] as String,
    to: json['to'] as String,
    distanceM: (json['distance_m'] as num).toDouble(),
    roadType: json['road_type'] as String,
    speedMps: (json['speed_mps'] as num).toDouble(),
    blocked: json['blocked'] as bool,
    directed: json['directed'] as bool,
    bridge: json['bridge'] == null ? null : json['bridge'] as bool,
    geometry: json['geometry'] == null ? null : (json['geometry'] as List).map((value) => GeoPoint.fromJson(Map<String, dynamic>.from(value as Map))).toList(),
  );

  Map<String, dynamic> toJson() => {
    'id': id,
    'from': from,
    'to': to,
    'distance_m': distanceM,
    'road_type': roadType,
    'speed_mps': speedMps,
    'blocked': blocked,
    'directed': directed,
    if (bridge != null) 'bridge': bridge!,
    if (geometry != null) 'geometry': geometry!.map((value) => value.toJson()).toList(),
  };
}

class Shelter {
  const Shelter({
    required this.id,
    required this.nodeId,
    required this.capacity,
    required this.occupancy,
    this.reserved,
    this.available,
  });

  final String id;
  final String nodeId;
  final int capacity;
  final int occupancy;
  final int? reserved;
  final int? available;

  factory Shelter.fromJson(Map<String, dynamic> json) => Shelter(
    id: json['id'] as String,
    nodeId: json['node_id'] as String,
    capacity: json['capacity'] as int,
    occupancy: json['occupancy'] as int,
    reserved: json['reserved'] == null ? null : json['reserved'] as int,
    available: json['available'] == null ? null : json['available'] as int,
  );

  Map<String, dynamic> toJson() => {
    'id': id,
    'node_id': nodeId,
    'capacity': capacity,
    'occupancy': occupancy,
    if (reserved != null) 'reserved': reserved!,
    if (available != null) 'available': available!,
  };
}

class Graph {
  const Graph({
    required this.version,
    required this.source,
    required this.nodes,
    required this.edges,
    required this.shelters,
    this.spawnZones,
    this.coverage,
  });

  final String version;
  final String source;
  final List<GraphNode> nodes;
  final List<GraphEdge> edges;
  final List<Shelter> shelters;
  final List<SpawnZone>? spawnZones;
  final List<GeoPoint>? coverage;

  factory Graph.fromJson(Map<String, dynamic> json) => Graph(
    version: json['version'] as String,
    source: json['source'] as String,
    nodes: (json['nodes'] as List).map((value) => GraphNode.fromJson(Map<String, dynamic>.from(value as Map))).toList(),
    edges: (json['edges'] as List).map((value) => GraphEdge.fromJson(Map<String, dynamic>.from(value as Map))).toList(),
    shelters: (json['shelters'] as List).map((value) => Shelter.fromJson(Map<String, dynamic>.from(value as Map))).toList(),
    spawnZones: json['spawn_zones'] == null ? null : (json['spawn_zones'] as List).map((value) => SpawnZone.fromJson(Map<String, dynamic>.from(value as Map))).toList(),
    coverage: json['coverage'] == null ? null : (json['coverage'] as List).map((value) => GeoPoint.fromJson(Map<String, dynamic>.from(value as Map))).toList(),
  );

  Map<String, dynamic> toJson() => {
    'version': version,
    'source': source,
    'nodes': nodes.map((value) => value.toJson()).toList(),
    'edges': edges.map((value) => value.toJson()).toList(),
    'shelters': shelters.map((value) => value.toJson()).toList(),
    if (spawnZones != null) 'spawn_zones': spawnZones!.map((value) => value.toJson()).toList(),
    if (coverage != null) 'coverage': coverage!.map((value) => value.toJson()).toList(),
  };
}

class Zombie {
  const Zombie({
    required this.id,
    required this.type,
    required this.currentNode,
    required this.movementState,
    required this.awake,
    required this.path,
  });

  final String id;
  final String type;
  final String currentNode;
  final String movementState;
  final bool awake;
  final List<String> path;

  factory Zombie.fromJson(Map<String, dynamic> json) => Zombie(
    id: json['id'] as String,
    type: json['type'] as String,
    currentNode: json['current_node'] as String,
    movementState: json['movement_state'] as String,
    awake: json['awake'] as bool,
    path: (json['path'] as List).map((value) => value as String).toList(),
  );

  Map<String, dynamic> toJson() => {
    'id': id,
    'type': type,
    'current_node': currentNode,
    'movement_state': movementState,
    'awake': awake,
    'path': path.map((value) => value).toList(),
  };
}

class Survivor {
  const Survivor({
    required this.id,
    required this.currentNode,
    required this.status,
    required this.targetShelterId,
    this.spawnZoneId,
    this.vehicleId,
    this.stationaryTurns,
    this.immobilityReason,
    required this.plannedRoute,
  });

  final String id;
  final String currentNode;
  final String status;
  final String targetShelterId;
  final String? spawnZoneId;
  final String? vehicleId;
  final int? stationaryTurns;
  final String? immobilityReason;
  final List<String> plannedRoute;

  factory Survivor.fromJson(Map<String, dynamic> json) => Survivor(
    id: json['id'] as String,
    currentNode: json['current_node'] as String,
    status: json['status'] as String,
    targetShelterId: json['target_shelter_id'] as String,
    spawnZoneId: json['spawn_zone_id'] == null ? null : json['spawn_zone_id'] as String,
    vehicleId: json['vehicle_id'] == null ? null : json['vehicle_id'] as String,
    stationaryTurns: json['stationary_turns'] == null ? null : json['stationary_turns'] as int,
    immobilityReason: json['immobility_reason'] == null ? null : json['immobility_reason'] as String,
    plannedRoute: (json['planned_route'] as List).map((value) => value as String).toList(),
  );

  Map<String, dynamic> toJson() => {
    'id': id,
    'current_node': currentNode,
    'status': status,
    'target_shelter_id': targetShelterId,
    if (spawnZoneId != null) 'spawn_zone_id': spawnZoneId!,
    if (vehicleId != null) 'vehicle_id': vehicleId!,
    if (stationaryTurns != null) 'stationary_turns': stationaryTurns!,
    if (immobilityReason != null) 'immobility_reason': immobilityReason!,
    'planned_route': plannedRoute.map((value) => value).toList(),
  };
}

class WorldEvent {
  const WorldEvent({
    required this.turn,
    required this.type,
    required this.entityId,
    required this.edgeId,
    required this.message,
  });

  final int turn;
  final String type;
  final String entityId;
  final String edgeId;
  final String message;

  factory WorldEvent.fromJson(Map<String, dynamic> json) => WorldEvent(
    turn: json['turn'] as int,
    type: json['type'] as String,
    entityId: json['entity_id'] as String,
    edgeId: json['edge_id'] as String,
    message: json['message'] as String,
  );

  Map<String, dynamic> toJson() => {
    'turn': turn,
    'type': type,
    'entity_id': entityId,
    'edge_id': edgeId,
    'message': message,
  };
}

class WorldMetrics {
  const WorldMetrics({
    required this.evacuated,
    required this.bitten,
    required this.active,
    required this.turns,
    required this.requestsSuccess,
    required this.requestsInvalid,
    required this.requestsTimeout,
    required this.httpP50Ms,
    required this.httpP95Ms,
    required this.httpP99Ms,
    required this.availability,
  });

  final int evacuated;
  final int bitten;
  final int active;
  final int turns;
  final int requestsSuccess;
  final int requestsInvalid;
  final int requestsTimeout;
  final double httpP50Ms;
  final double httpP95Ms;
  final double httpP99Ms;
  final double availability;

  factory WorldMetrics.fromJson(Map<String, dynamic> json) => WorldMetrics(
    evacuated: json['evacuated'] as int,
    bitten: json['bitten'] as int,
    active: json['active'] as int,
    turns: json['turns'] as int,
    requestsSuccess: json['requests_success'] as int,
    requestsInvalid: json['requests_invalid'] as int,
    requestsTimeout: json['requests_timeout'] as int,
    httpP50Ms: (json['http_p50_ms'] as num).toDouble(),
    httpP95Ms: (json['http_p95_ms'] as num).toDouble(),
    httpP99Ms: (json['http_p99_ms'] as num).toDouble(),
    availability: (json['availability'] as num).toDouble(),
  );

  Map<String, dynamic> toJson() => {
    'evacuated': evacuated,
    'bitten': bitten,
    'active': active,
    'turns': turns,
    'requests_success': requestsSuccess,
    'requests_invalid': requestsInvalid,
    'requests_timeout': requestsTimeout,
    'http_p50_ms': httpP50Ms,
    'http_p95_ms': httpP95Ms,
    'http_p99_ms': httpP99Ms,
    'availability': availability,
  };
}

class WorldSnapshot {
  const WorldSnapshot({
    this.fleet,
    this.fleetMetrics,
    this.scenarioType,
    required this.turn,
    required this.worldVersion,
    required this.graphVersion,
    required this.zombies,
    required this.survivors,
    required this.shelters,
    required this.blockedEdges,
    required this.events,
    required this.metrics,
    this.simulation,
  });

  final List<RescueVehicle>? fleet;
  final RescueFleetMetrics? fleetMetrics;
  final String? scenarioType;
  final int turn;
  final int worldVersion;
  final String graphVersion;
  final List<Zombie> zombies;
  final List<Survivor> survivors;
  final List<Shelter> shelters;
  final List<String> blockedEdges;
  final List<WorldEvent> events;
  final WorldMetrics metrics;
  final SimulationInfo? simulation;

  factory WorldSnapshot.fromJson(Map<String, dynamic> json) => WorldSnapshot(
    fleet: json['fleet'] == null ? null : (json['fleet'] as List).map((value) => RescueVehicle.fromJson(Map<String, dynamic>.from(value as Map))).toList(),
    fleetMetrics: json['fleet_metrics'] == null ? null : RescueFleetMetrics.fromJson(Map<String, dynamic>.from(json['fleet_metrics'] as Map)),
    scenarioType: json['scenario_type'] == null ? null : json['scenario_type'] as String,
    turn: json['turn'] as int,
    worldVersion: json['world_version'] as int,
    graphVersion: json['graph_version'] as String,
    zombies: (json['zombies'] as List).map((value) => Zombie.fromJson(Map<String, dynamic>.from(value as Map))).toList(),
    survivors: (json['survivors'] as List).map((value) => Survivor.fromJson(Map<String, dynamic>.from(value as Map))).toList(),
    shelters: (json['shelters'] as List).map((value) => Shelter.fromJson(Map<String, dynamic>.from(value as Map))).toList(),
    blockedEdges: (json['blocked_edges'] as List).map((value) => value as String).toList(),
    events: (json['events'] as List).map((value) => WorldEvent.fromJson(Map<String, dynamic>.from(value as Map))).toList(),
    metrics: WorldMetrics.fromJson(Map<String, dynamic>.from(json['metrics'] as Map)),
    simulation: json['simulation'] == null ? null : SimulationInfo.fromJson(Map<String, dynamic>.from(json['simulation'] as Map)),
  );

  Map<String, dynamic> toJson() => {
    if (fleet != null) 'fleet': fleet!.map((value) => value.toJson()).toList(),
    if (fleetMetrics != null) 'fleet_metrics': fleetMetrics!.toJson(),
    if (scenarioType != null) 'scenario_type': scenarioType!,
    'turn': turn,
    'world_version': worldVersion,
    'graph_version': graphVersion,
    'zombies': zombies.map((value) => value.toJson()).toList(),
    'survivors': survivors.map((value) => value.toJson()).toList(),
    'shelters': shelters.map((value) => value.toJson()).toList(),
    'blocked_edges': blockedEdges.map((value) => value).toList(),
    'events': events.map((value) => value.toJson()).toList(),
    'metrics': metrics.toJson(),
    if (simulation != null) 'simulation': simulation!.toJson(),
  };
}

class FloodZone {
  const FloodZone({
    required this.id,
    required this.center,
    required this.radiusM,
    required this.intensity,
  });

  final String id;
  final GeoPoint center;
  final double radiusM;
  final double intensity;

  factory FloodZone.fromJson(Map<String, dynamic> json) => FloodZone(
    id: json['id'] as String,
    center: GeoPoint.fromJson(Map<String, dynamic>.from(json['center'] as Map)),
    radiusM: (json['radius_m'] as num).toDouble(),
    intensity: (json['intensity'] as num).toDouble(),
  );

  Map<String, dynamic> toJson() => {
    'id': id,
    'center': center.toJson(),
    'radius_m': radiusM,
    'intensity': intensity,
  };
}

class RoadCondition {
  const RoadCondition({
    required this.edgeId,
    required this.state,
    required this.riskScore,
    this.depthM,
    required this.riskSource,
    required this.updatedAtSimulationStep,
    required this.costMultiplier,
  });

  final String edgeId;
  final String state;
  final double riskScore;
  final double? depthM;
  final String riskSource;
  final int updatedAtSimulationStep;
  final double costMultiplier;

  factory RoadCondition.fromJson(Map<String, dynamic> json) => RoadCondition(
    edgeId: json['edge_id'] as String,
    state: json['state'] as String,
    riskScore: (json['risk_score'] as num).toDouble(),
    depthM: json['depth_m'] == null ? null : (json['depth_m'] as num).toDouble(),
    riskSource: json['risk_source'] as String,
    updatedAtSimulationStep: json['updated_at_simulation_step'] as int,
    costMultiplier: (json['cost_multiplier'] as num).toDouble(),
  );

  Map<String, dynamic> toJson() => {
    'edge_id': edgeId,
    'state': state,
    'risk_score': riskScore,
    if (depthM != null) 'depth_m': depthM!,
    'risk_source': riskSource,
    'updated_at_simulation_step': updatedAtSimulationStep,
    'cost_multiplier': costMultiplier,
  };
}

class ShelterCondition {
  const ShelterCondition({
    required this.shelterId,
    required this.state,
    required this.riskScore,
    required this.updatedAtSimulationStep,
  });

  final String shelterId;
  final String state;
  final double riskScore;
  final int updatedAtSimulationStep;

  factory ShelterCondition.fromJson(Map<String, dynamic> json) => ShelterCondition(
    shelterId: json['shelter_id'] as String,
    state: json['state'] as String,
    riskScore: (json['risk_score'] as num).toDouble(),
    updatedAtSimulationStep: json['updated_at_simulation_step'] as int,
  );

  Map<String, dynamic> toJson() => {
    'shelter_id': shelterId,
    'state': state,
    'risk_score': riskScore,
    'updated_at_simulation_step': updatedAtSimulationStep,
  };
}

class FloodAgent {
  const FloodAgent({
    required this.id,
    required this.currentNode,
    required this.state,
    required this.behavior,
    required this.targetShelterId,
    required this.plannedRoute,
    this.evacuationTime,
  });

  final String id;
  final String currentNode;
  final String state;
  final String behavior;
  final String targetShelterId;
  final List<String> plannedRoute;
  final double? evacuationTime;

  factory FloodAgent.fromJson(Map<String, dynamic> json) => FloodAgent(
    id: json['id'] as String,
    currentNode: json['current_node'] as String,
    state: json['state'] as String,
    behavior: json['behavior'] as String,
    targetShelterId: json['target_shelter_id'] as String,
    plannedRoute: (json['planned_route'] as List).map((value) => value as String).toList(),
    evacuationTime: json['evacuation_time'] == null ? null : (json['evacuation_time'] as num).toDouble(),
  );

  Map<String, dynamic> toJson() => {
    'id': id,
    'current_node': currentNode,
    'state': state,
    'behavior': behavior,
    'target_shelter_id': targetShelterId,
    'planned_route': plannedRoute.map((value) => value).toList(),
    if (evacuationTime != null) 'evacuation_time': evacuationTime!,
  };
}

class EvacuationMetrics {
  const EvacuationMetrics({
    required this.totalAgents,
    required this.evacuatedAgents,
    required this.isolatedAgents,
    required this.waitingAgents,
    required this.averageEvacuationTime,
    required this.blockedEdges,
    required this.cautionEdges,
    required this.sheltersAtCapacity,
    required this.rerouteCount,
    required this.simulationTotalDuration,
  });

  final int totalAgents;
  final int evacuatedAgents;
  final int isolatedAgents;
  final int waitingAgents;
  final double averageEvacuationTime;
  final int blockedEdges;
  final int cautionEdges;
  final int sheltersAtCapacity;
  final int rerouteCount;
  final double simulationTotalDuration;

  factory EvacuationMetrics.fromJson(Map<String, dynamic> json) => EvacuationMetrics(
    totalAgents: json['total_agents'] as int,
    evacuatedAgents: json['evacuated_agents'] as int,
    isolatedAgents: json['isolated_agents'] as int,
    waitingAgents: json['waiting_agents'] as int,
    averageEvacuationTime: (json['average_evacuation_time'] as num).toDouble(),
    blockedEdges: json['blocked_edges'] as int,
    cautionEdges: json['caution_edges'] as int,
    sheltersAtCapacity: json['shelters_at_capacity'] as int,
    rerouteCount: json['reroute_count'] as int,
    simulationTotalDuration: (json['simulation_total_duration'] as num).toDouble(),
  );

  Map<String, dynamic> toJson() => {
    'total_agents': totalAgents,
    'evacuated_agents': evacuatedAgents,
    'isolated_agents': isolatedAgents,
    'waiting_agents': waitingAgents,
    'average_evacuation_time': averageEvacuationTime,
    'blocked_edges': blockedEdges,
    'caution_edges': cautionEdges,
    'shelters_at_capacity': sheltersAtCapacity,
    'reroute_count': rerouteCount,
    'simulation_total_duration': simulationTotalDuration,
  };
}

class SimulationPerformance {
  const SimulationPerformance({
    this.hydraulicStepLatencyMs,
    this.evacuationStepLatencyMs,
    required this.simulationStepLatencyMs,
    required this.simulationTotalDurationMs,
  });

  final double? hydraulicStepLatencyMs;
  final double? evacuationStepLatencyMs;
  final double simulationStepLatencyMs;
  final double simulationTotalDurationMs;

  factory SimulationPerformance.fromJson(Map<String, dynamic> json) => SimulationPerformance(
    hydraulicStepLatencyMs: json['hydraulic_step_latency_ms'] == null ? null : (json['hydraulic_step_latency_ms'] as num).toDouble(),
    evacuationStepLatencyMs: json['evacuation_step_latency_ms'] == null ? null : (json['evacuation_step_latency_ms'] as num).toDouble(),
    simulationStepLatencyMs: (json['simulation_step_latency_ms'] as num).toDouble(),
    simulationTotalDurationMs: (json['simulation_total_duration_ms'] as num).toDouble(),
  );

  Map<String, dynamic> toJson() => {
    if (hydraulicStepLatencyMs != null) 'hydraulic_step_latency_ms': hydraulicStepLatencyMs!,
    if (evacuationStepLatencyMs != null) 'evacuation_step_latency_ms': evacuationStepLatencyMs!,
    'simulation_step_latency_ms': simulationStepLatencyMs,
    'simulation_total_duration_ms': simulationTotalDurationMs,
  };
}

class DataProvenance {
  const DataProvenance({
    required this.graphSource,
    required this.model,
    required this.elevationSource,
    required this.disclaimer,
    this.geographicReference,
  });

  final String graphSource;
  final String model;
  final String elevationSource;
  final String disclaimer;
  final ReferenceUse? geographicReference;

  factory DataProvenance.fromJson(Map<String, dynamic> json) => DataProvenance(
    graphSource: json['graph_source'] as String,
    model: json['model'] as String,
    elevationSource: json['elevation_source'] as String,
    disclaimer: json['disclaimer'] as String,
    geographicReference: json['geographic_reference'] == null ? null : ReferenceUse.fromJson(Map<String, dynamic>.from(json['geographic_reference'] as Map)),
  );

  Map<String, dynamic> toJson() => {
    'graph_source': graphSource,
    'model': model,
    'elevation_source': elevationSource,
    'disclaimer': disclaimer,
    if (geographicReference != null) 'geographic_reference': geographicReference!.toJson(),
  };
}

class ScenarioSnapshot {
  const ScenarioSnapshot({
    required this.scenarioType,
    required this.simulationStep,
    required this.worldVersion,
    required this.graphVersion,
    required this.simulationTime,
    required this.simulationDuration,
    required this.timeStep,
    required this.rainfall,
    required this.floodZones,
    required this.roadConditions,
    required this.shelterConditions,
    required this.agents,
    required this.evacuationMetrics,
    required this.performance,
    this.hydraulic,
    required this.dataProvenance,
  });

  final String scenarioType;
  final int simulationStep;
  final int worldVersion;
  final String graphVersion;
  final double simulationTime;
  final double simulationDuration;
  final double timeStep;
  final double rainfall;
  final List<FloodZone> floodZones;
  final List<RoadCondition> roadConditions;
  final List<ShelterCondition> shelterConditions;
  final List<FloodAgent> agents;
  final EvacuationMetrics evacuationMetrics;
  final SimulationPerformance performance;
  final HydraulicSnapshot? hydraulic;
  final DataProvenance dataProvenance;

  factory ScenarioSnapshot.fromJson(Map<String, dynamic> json) => ScenarioSnapshot(
    scenarioType: json['scenario_type'] as String,
    simulationStep: json['simulation_step'] as int,
    worldVersion: json['world_version'] as int,
    graphVersion: json['graph_version'] as String,
    simulationTime: (json['simulation_time'] as num).toDouble(),
    simulationDuration: (json['simulation_duration'] as num).toDouble(),
    timeStep: (json['time_step'] as num).toDouble(),
    rainfall: (json['rainfall'] as num).toDouble(),
    floodZones: (json['flood_zones'] as List).map((value) => FloodZone.fromJson(Map<String, dynamic>.from(value as Map))).toList(),
    roadConditions: (json['road_conditions'] as List).map((value) => RoadCondition.fromJson(Map<String, dynamic>.from(value as Map))).toList(),
    shelterConditions: (json['shelter_conditions'] as List).map((value) => ShelterCondition.fromJson(Map<String, dynamic>.from(value as Map))).toList(),
    agents: (json['agents'] as List).map((value) => FloodAgent.fromJson(Map<String, dynamic>.from(value as Map))).toList(),
    evacuationMetrics: EvacuationMetrics.fromJson(Map<String, dynamic>.from(json['evacuation_metrics'] as Map)),
    performance: SimulationPerformance.fromJson(Map<String, dynamic>.from(json['performance'] as Map)),
    hydraulic: json['hydraulic'] == null ? null : HydraulicSnapshot.fromJson(Map<String, dynamic>.from(json['hydraulic'] as Map)),
    dataProvenance: DataProvenance.fromJson(Map<String, dynamic>.from(json['data_provenance'] as Map)),
  );

  Map<String, dynamic> toJson() => {
    'scenario_type': scenarioType,
    'simulation_step': simulationStep,
    'world_version': worldVersion,
    'graph_version': graphVersion,
    'simulation_time': simulationTime,
    'simulation_duration': simulationDuration,
    'time_step': timeStep,
    'rainfall': rainfall,
    'flood_zones': floodZones.map((value) => value.toJson()).toList(),
    'road_conditions': roadConditions.map((value) => value.toJson()).toList(),
    'shelter_conditions': shelterConditions.map((value) => value.toJson()).toList(),
    'agents': agents.map((value) => value.toJson()).toList(),
    'evacuation_metrics': evacuationMetrics.toJson(),
    'performance': performance.toJson(),
    if (hydraulic != null) 'hydraulic': hydraulic!.toJson(),
    'data_provenance': dataProvenance.toJson(),
  };
}

class StepRequest {
  const StepRequest({
    required this.sobrevivienteId,
    required this.nodoActual,
    required this.turno,
  });

  final String sobrevivienteId;
  final String nodoActual;
  final int turno;

  factory StepRequest.fromJson(Map<String, dynamic> json) => StepRequest(
    sobrevivienteId: json['sobrevivienteId'] as String,
    nodoActual: json['nodoActual'] as String,
    turno: json['turno'] as int,
  );

  Map<String, dynamic> toJson() => {
    'sobrevivienteId': sobrevivienteId,
    'nodoActual': nodoActual,
    'turno': turno,
  };
}

class StepResponse {
  const StepResponse({
    required this.siguienteNodo,
  });

  final String siguienteNodo;

  factory StepResponse.fromJson(Map<String, dynamic> json) => StepResponse(
    siguienteNodo: json['siguienteNodo'] as String,
  );

  Map<String, dynamic> toJson() => {
    'siguienteNodo': siguienteNodo,
  };
}

class HealthResponse {
  const HealthResponse({
    required this.status,
    required this.service,
    required this.version,
  });

  final String status;
  final String service;
  final String version;

  factory HealthResponse.fromJson(Map<String, dynamic> json) => HealthResponse(
    status: json['status'] as String,
    service: json['service'] as String,
    version: json['version'] as String,
  );

  Map<String, dynamic> toJson() => {
    'status': status,
    'service': service,
    'version': version,
  };
}

class ErrorDetail {
  const ErrorDetail({
    required this.field,
    required this.message,
  });

  final String field;
  final String message;

  factory ErrorDetail.fromJson(Map<String, dynamic> json) => ErrorDetail(
    field: json['field'] as String,
    message: json['message'] as String,
  );

  Map<String, dynamic> toJson() => {
    'field': field,
    'message': message,
  };
}

class ErrorResponse {
  const ErrorResponse({
    required this.error,
  });

  final ErrorResponseError error;

  factory ErrorResponse.fromJson(Map<String, dynamic> json) => ErrorResponse(
    error: ErrorResponseError.fromJson(Map<String, dynamic>.from(json['error'] as Map)),
  );

  Map<String, dynamic> toJson() => {
    'error': error.toJson(),
  };
}

class ErrorResponseError {
  const ErrorResponseError({
    required this.code,
    required this.message,
    required this.requestId,
    required this.details,
  });

  final String code;
  final String message;
  final String requestId;
  final List<ErrorDetail> details;

  factory ErrorResponseError.fromJson(Map<String, dynamic> json) => ErrorResponseError(
    code: json['code'] as String,
    message: json['message'] as String,
    requestId: json['requestId'] as String,
    details: (json['details'] as List).map((value) => ErrorDetail.fromJson(Map<String, dynamic>.from(value as Map))).toList(),
  );

  Map<String, dynamic> toJson() => {
    'code': code,
    'message': message,
    'requestId': requestId,
    'details': details.map((value) => value.toJson()).toList(),
  };
}

class SimulationInfo {
  const SimulationInfo({
    required this.runId,
    required this.mode,
    required this.round,
    required this.state,
    required this.seed,
    required this.graphVersion,
    required this.turnLimit,
    required this.intervalMs,
    this.startedAt,
    this.endedAt,
    this.failure,
  });

  final String runId;
  final String mode;
  final String round;
  final String state;
  final int seed;
  final String graphVersion;
  final int turnLimit;
  final int intervalMs;
  final String? startedAt;
  final String? endedAt;
  final String? failure;

  factory SimulationInfo.fromJson(Map<String, dynamic> json) => SimulationInfo(
    runId: json['run_id'] as String,
    mode: json['mode'] as String,
    round: json['round'] as String,
    state: json['state'] as String,
    seed: json['seed'] as int,
    graphVersion: json['graph_version'] as String,
    turnLimit: json['turn_limit'] as int,
    intervalMs: json['interval_ms'] as int,
    startedAt: json['started_at'] == null ? null : json['started_at'] as String,
    endedAt: json['ended_at'] == null ? null : json['ended_at'] as String,
    failure: json['failure'] == null ? null : json['failure'] as String,
  );

  Map<String, dynamic> toJson() => {
    'run_id': runId,
    'mode': mode,
    'round': round,
    'state': state,
    'seed': seed,
    'graph_version': graphVersion,
    'turn_limit': turnLimit,
    'interval_ms': intervalMs,
    if (startedAt != null) 'started_at': startedAt!,
    if (endedAt != null) 'ended_at': endedAt!,
    if (failure != null) 'failure': failure!,
  };
}

class LabCandidate {
  const LabCandidate({
    required this.id,
    required this.label,
    required this.lat,
    required this.lng,
    required this.capacity,
  });

  final String id;
  final String label;
  final double lat;
  final double lng;
  final int capacity;

  factory LabCandidate.fromJson(Map<String, dynamic> json) => LabCandidate(
    id: json['id'] as String,
    label: json['label'] as String,
    lat: (json['lat'] as num).toDouble(),
    lng: (json['lng'] as num).toDouble(),
    capacity: json['capacity'] as int,
  );

  Map<String, dynamic> toJson() => {
    'id': id,
    'label': label,
    'lat': lat,
    'lng': lng,
    'capacity': capacity,
  };
}

class LabRunConfig {
  const LabRunConfig({
    this.hydraulicModel,
    this.hydrology,
    required this.mode,
    required this.seed,
    required this.rainfallProfile,
    required this.rainfallIntensity,
    required this.simulationDuration,
    required this.evacuationBehavior,
    required this.agents,
    required this.intervalMs,
    required this.shelters,
    this.geographicReference,
  });

  final String? hydraulicModel;
  final HydrologyConfig? hydrology;
  final String mode;
  final int seed;
  final String rainfallProfile;
  final double rainfallIntensity;
  final int simulationDuration;
  final String evacuationBehavior;
  final int agents;
  final int intervalMs;
  final List<LabCandidate> shelters;
  final LabGeographicReference? geographicReference;

  factory LabRunConfig.fromJson(Map<String, dynamic> json) => LabRunConfig(
    hydraulicModel: json['hydraulic_model'] == null ? null : json['hydraulic_model'] as String,
    hydrology: json['hydrology'] == null ? null : HydrologyConfig.fromJson(Map<String, dynamic>.from(json['hydrology'] as Map)),
    mode: json['mode'] as String,
    seed: json['seed'] as int,
    rainfallProfile: json['rainfall_profile'] as String,
    rainfallIntensity: (json['rainfall_intensity'] as num).toDouble(),
    simulationDuration: json['simulation_duration'] as int,
    evacuationBehavior: json['evacuation_behavior'] as String,
    agents: json['agents'] as int,
    intervalMs: json['interval_ms'] as int,
    shelters: (json['shelters'] as List).map((value) => LabCandidate.fromJson(Map<String, dynamic>.from(value as Map))).toList(),
    geographicReference: json['geographic_reference'] == null ? null : LabGeographicReference.fromJson(Map<String, dynamic>.from(json['geographic_reference'] as Map)),
  );

  Map<String, dynamic> toJson() => {
    if (hydraulicModel != null) 'hydraulic_model': hydraulicModel!,
    if (hydrology != null) 'hydrology': hydrology!.toJson(),
    'mode': mode,
    'seed': seed,
    'rainfall_profile': rainfallProfile,
    'rainfall_intensity': rainfallIntensity,
    'simulation_duration': simulationDuration,
    'evacuation_behavior': evacuationBehavior,
    'agents': agents,
    'interval_ms': intervalMs,
    'shelters': shelters.map((value) => value.toJson()).toList(),
    if (geographicReference != null) 'geographic_reference': geographicReference!.toJson(),
  };
}

class LabOrigin {
  const LabOrigin({
    required this.id,
    required this.nodeId,
    required this.lat,
    required this.lng,
    required this.snapDistanceM,
  });

  final String id;
  final String nodeId;
  final double lat;
  final double lng;
  final double snapDistanceM;

  factory LabOrigin.fromJson(Map<String, dynamic> json) => LabOrigin(
    id: json['id'] as String,
    nodeId: json['node_id'] as String,
    lat: (json['lat'] as num).toDouble(),
    lng: (json['lng'] as num).toDouble(),
    snapDistanceM: (json['snap_distance_m'] as num).toDouble(),
  );

  Map<String, dynamic> toJson() => {
    'id': id,
    'node_id': nodeId,
    'lat': lat,
    'lng': lng,
    'snap_distance_m': snapDistanceM,
  };
}

class LabTimelineEntry {
  const LabTimelineEntry({
    required this.step,
    required this.simulationTime,
    required this.evacuationMetrics,
    required this.stepLatencyMs,
  });

  final int step;
  final double simulationTime;
  final EvacuationMetrics evacuationMetrics;
  final double stepLatencyMs;

  factory LabTimelineEntry.fromJson(Map<String, dynamic> json) => LabTimelineEntry(
    step: json['step'] as int,
    simulationTime: (json['simulation_time'] as num).toDouble(),
    evacuationMetrics: EvacuationMetrics.fromJson(Map<String, dynamic>.from(json['evacuation_metrics'] as Map)),
    stepLatencyMs: (json['step_latency_ms'] as num).toDouble(),
  );

  Map<String, dynamic> toJson() => {
    'step': step,
    'simulation_time': simulationTime,
    'evacuation_metrics': evacuationMetrics.toJson(),
    'step_latency_ms': stepLatencyMs,
  };
}

class LabComparisonResult {
  const LabComparisonResult({
    required this.strategy,
    required this.mode,
    required this.seed,
    required this.graphVersion,
    required this.totalAgents,
    required this.evacuatedPercentage,
    required this.evacuationMetrics,
    required this.stepLatencyMs,
    required this.originsHash,
    required this.configHash,
  });

  final String strategy;
  final String mode;
  final int seed;
  final String graphVersion;
  final int totalAgents;
  final double evacuatedPercentage;
  final EvacuationMetrics evacuationMetrics;
  final double stepLatencyMs;
  final String originsHash;
  final String configHash;

  factory LabComparisonResult.fromJson(Map<String, dynamic> json) => LabComparisonResult(
    strategy: json['strategy'] as String,
    mode: json['mode'] as String,
    seed: json['seed'] as int,
    graphVersion: json['graph_version'] as String,
    totalAgents: json['total_agents'] as int,
    evacuatedPercentage: (json['evacuated_percentage'] as num).toDouble(),
    evacuationMetrics: EvacuationMetrics.fromJson(Map<String, dynamic>.from(json['evacuation_metrics'] as Map)),
    stepLatencyMs: (json['step_latency_ms'] as num).toDouble(),
    originsHash: json['origins_hash'] as String,
    configHash: json['config_hash'] as String,
  );

  Map<String, dynamic> toJson() => {
    'strategy': strategy,
    'mode': mode,
    'seed': seed,
    'graph_version': graphVersion,
    'total_agents': totalAgents,
    'evacuated_percentage': evacuatedPercentage,
    'evacuation_metrics': evacuationMetrics.toJson(),
    'step_latency_ms': stepLatencyMs,
    'origins_hash': originsHash,
    'config_hash': configHash,
  };
}

class LabComparison {
  const LabComparison({
    required this.id,
    required this.state,
    required this.progress,
    required this.message,
    required this.results,
  });

  final String id;
  final String state;
  final int progress;
  final String message;
  final List<LabComparisonResult> results;

  factory LabComparison.fromJson(Map<String, dynamic> json) => LabComparison(
    id: json['id'] as String,
    state: json['state'] as String,
    progress: json['progress'] as int,
    message: json['message'] as String,
    results: (json['results'] as List).map((value) => LabComparisonResult.fromJson(Map<String, dynamic>.from(value as Map))).toList(),
  );

  Map<String, dynamic> toJson() => {
    'id': id,
    'state': state,
    'progress': progress,
    'message': message,
    'results': results.map((value) => value.toJson()).toList(),
  };
}

class LabState {
  const LabState({
    this.runtimeElapsedMs,
    required this.runId,
    required this.state,
    required this.mode,
    required this.graphVersion,
    required this.config,
    required this.scenario,
    required this.shelters,
    required this.timeline,
    required this.origins,
    this.comparison,
    this.incidentApplications,
  });

  final double? runtimeElapsedMs;
  final String runId;
  final String state;
  final String mode;
  final String graphVersion;
  final LabRunConfig config;
  final ScenarioSnapshot scenario;
  final List<Shelter> shelters;
  final List<LabTimelineEntry> timeline;
  final List<LabOrigin> origins;
  final LabComparison? comparison;
  final List<IncidentApplication>? incidentApplications;

  factory LabState.fromJson(Map<String, dynamic> json) => LabState(
    runtimeElapsedMs: json['runtime_elapsed_ms'] == null ? null : (json['runtime_elapsed_ms'] as num).toDouble(),
    runId: json['run_id'] as String,
    state: json['state'] as String,
    mode: json['mode'] as String,
    graphVersion: json['graph_version'] as String,
    config: LabRunConfig.fromJson(Map<String, dynamic>.from(json['config'] as Map)),
    scenario: ScenarioSnapshot.fromJson(Map<String, dynamic>.from(json['scenario'] as Map)),
    shelters: (json['shelters'] as List).map((value) => Shelter.fromJson(Map<String, dynamic>.from(value as Map))).toList(),
    timeline: (json['timeline'] as List).map((value) => LabTimelineEntry.fromJson(Map<String, dynamic>.from(value as Map))).toList(),
    origins: (json['origins'] as List).map((value) => LabOrigin.fromJson(Map<String, dynamic>.from(value as Map))).toList(),
    comparison: json['comparison'] == null ? null : LabComparison.fromJson(Map<String, dynamic>.from(json['comparison'] as Map)),
    incidentApplications: json['incident_applications'] == null ? null : (json['incident_applications'] as List).map((value) => IncidentApplication.fromJson(Map<String, dynamic>.from(value as Map))).toList(),
  );

  Map<String, dynamic> toJson() => {
    if (runtimeElapsedMs != null) 'runtime_elapsed_ms': runtimeElapsedMs!,
    'run_id': runId,
    'state': state,
    'mode': mode,
    'graph_version': graphVersion,
    'config': config.toJson(),
    'scenario': scenario.toJson(),
    'shelters': shelters.map((value) => value.toJson()).toList(),
    'timeline': timeline.map((value) => value.toJson()).toList(),
    'origins': origins.map((value) => value.toJson()).toList(),
    if (comparison != null) 'comparison': comparison!.toJson(),
    if (incidentApplications != null) 'incident_applications': incidentApplications!.map((value) => value.toJson()).toList(),
  };
}

class IncidentBounds {
  const IncidentBounds({
    required this.minLatitude,
    required this.minLongitude,
    required this.maxLatitude,
    required this.maxLongitude,
  });

  final double minLatitude;
  final double minLongitude;
  final double maxLatitude;
  final double maxLongitude;

  factory IncidentBounds.fromJson(Map<String, dynamic> json) => IncidentBounds(
    minLatitude: (json['min_latitude'] as num).toDouble(),
    minLongitude: (json['min_longitude'] as num).toDouble(),
    maxLatitude: (json['max_latitude'] as num).toDouble(),
    maxLongitude: (json['max_longitude'] as num).toDouble(),
  );

  Map<String, dynamic> toJson() => {
    'min_latitude': minLatitude,
    'min_longitude': minLongitude,
    'max_latitude': maxLatitude,
    'max_longitude': maxLongitude,
  };
}

class IncidentEvidenceMetadata {
  const IncidentEvidenceMetadata({
    required this.attachmentCount,
    required this.storageStatus,
  });

  final int attachmentCount;
  final String storageStatus;

  factory IncidentEvidenceMetadata.fromJson(Map<String, dynamic> json) => IncidentEvidenceMetadata(
    attachmentCount: json['attachment_count'] as int,
    storageStatus: json['storage_status'] as String,
  );

  Map<String, dynamic> toJson() => {
    'attachment_count': attachmentCount,
    'storage_status': storageStatus,
  };
}

class IncidentServiceInfo {
  const IncidentServiceInfo({
    required this.enabled,
    required this.schemaVersion,
    required this.bounds,
    required this.maxDescriptionLength,
    required this.maxSnapDistanceM,
    required this.verificationNotice,
    required this.photoUploadsEnabled,
  });

  final bool enabled;
  final int schemaVersion;
  final IncidentBounds bounds;
  final int maxDescriptionLength;
  final double maxSnapDistanceM;
  final String verificationNotice;
  final bool photoUploadsEnabled;

  factory IncidentServiceInfo.fromJson(Map<String, dynamic> json) => IncidentServiceInfo(
    enabled: json['enabled'] as bool,
    schemaVersion: json['schema_version'] as int,
    bounds: IncidentBounds.fromJson(Map<String, dynamic>.from(json['bounds'] as Map)),
    maxDescriptionLength: json['max_description_length'] as int,
    maxSnapDistanceM: (json['max_snap_distance_m'] as num).toDouble(),
    verificationNotice: json['verification_notice'] as String,
    photoUploadsEnabled: json['photo_uploads_enabled'] as bool,
  );

  Map<String, dynamic> toJson() => {
    'enabled': enabled,
    'schema_version': schemaVersion,
    'bounds': bounds.toJson(),
    'max_description_length': maxDescriptionLength,
    'max_snap_distance_m': maxSnapDistanceM,
    'verification_notice': verificationNotice,
    'photo_uploads_enabled': photoUploadsEnabled,
  };
}

class IncidentLocation {
  const IncidentLocation({
    required this.latitude,
    required this.longitude,
    this.edgeIdHint,
  });

  final double latitude;
  final double longitude;
  final String? edgeIdHint;

  factory IncidentLocation.fromJson(Map<String, dynamic> json) => IncidentLocation(
    latitude: (json['latitude'] as num).toDouble(),
    longitude: (json['longitude'] as num).toDouble(),
    edgeIdHint: json['edge_id_hint'] == null ? null : json['edge_id_hint'] as String,
  );

  Map<String, dynamic> toJson() => {
    'latitude': latitude,
    'longitude': longitude,
    if (edgeIdHint != null) 'edge_id_hint': edgeIdHint!,
  };
}

class IncidentEdgeMatch {
  const IncidentEdgeMatch({
    required this.edgeId,
    required this.roadType,
    required this.distanceM,
    required this.fromNodeId,
    required this.toNodeId,
    required this.latitude,
    required this.longitude,
  });

  final String edgeId;
  final String roadType;
  final double distanceM;
  final String fromNodeId;
  final String toNodeId;
  final double latitude;
  final double longitude;

  factory IncidentEdgeMatch.fromJson(Map<String, dynamic> json) => IncidentEdgeMatch(
    edgeId: json['edge_id'] as String,
    roadType: json['road_type'] as String,
    distanceM: (json['distance_m'] as num).toDouble(),
    fromNodeId: json['from_node_id'] as String,
    toNodeId: json['to_node_id'] as String,
    latitude: (json['latitude'] as num).toDouble(),
    longitude: (json['longitude'] as num).toDouble(),
  );

  Map<String, dynamic> toJson() => {
    'edge_id': edgeId,
    'road_type': roadType,
    'distance_m': distanceM,
    'from_node_id': fromNodeId,
    'to_node_id': toNodeId,
    'latitude': latitude,
    'longitude': longitude,
  };
}

class IncidentResolution {
  const IncidentResolution({
    required this.matched,
    required this.ambiguous,
    required this.candidates,
    required this.message,
    required this.graphVersion,
    required this.maxSnapDistanceM,
  });

  final bool matched;
  final bool ambiguous;
  final List<IncidentEdgeMatch> candidates;
  final String message;
  final String graphVersion;
  final double maxSnapDistanceM;

  factory IncidentResolution.fromJson(Map<String, dynamic> json) => IncidentResolution(
    matched: json['matched'] as bool,
    ambiguous: json['ambiguous'] as bool,
    candidates: (json['candidates'] as List).map((value) => IncidentEdgeMatch.fromJson(Map<String, dynamic>.from(value as Map))).toList(),
    message: json['message'] as String,
    graphVersion: json['graph_version'] as String,
    maxSnapDistanceM: (json['max_snap_distance_m'] as num).toDouble(),
  );

  Map<String, dynamic> toJson() => {
    'matched': matched,
    'ambiguous': ambiguous,
    'candidates': candidates.map((value) => value.toJson()).toList(),
    'message': message,
    'graph_version': graphVersion,
    'max_snap_distance_m': maxSnapDistanceM,
  };
}

class IncidentCreate {
  const IncidentCreate({
    required this.incidentType,
    required this.latitude,
    required this.longitude,
    required this.description,
    required this.severityReported,
    required this.roadPassabilityReported,
    required this.eventTime,
    required this.locationMethod,
    this.edgeIdHint,
    this.evidenceMetadata,
  });

  final String incidentType;
  final double latitude;
  final double longitude;
  final String description;
  final String severityReported;
  final String roadPassabilityReported;
  final String eventTime;
  final String locationMethod;
  final String? edgeIdHint;
  final IncidentEvidenceMetadata? evidenceMetadata;

  factory IncidentCreate.fromJson(Map<String, dynamic> json) => IncidentCreate(
    incidentType: json['incident_type'] as String,
    latitude: (json['latitude'] as num).toDouble(),
    longitude: (json['longitude'] as num).toDouble(),
    description: json['description'] as String,
    severityReported: json['severity_reported'] as String,
    roadPassabilityReported: json['road_passability_reported'] as String,
    eventTime: json['event_time'] as String,
    locationMethod: json['location_method'] as String,
    edgeIdHint: json['edge_id_hint'] == null ? null : json['edge_id_hint'] as String,
    evidenceMetadata: json['evidence_metadata'] == null ? null : IncidentEvidenceMetadata.fromJson(Map<String, dynamic>.from(json['evidence_metadata'] as Map)),
  );

  Map<String, dynamic> toJson() => {
    'incident_type': incidentType,
    'latitude': latitude,
    'longitude': longitude,
    'description': description,
    'severity_reported': severityReported,
    'road_passability_reported': roadPassabilityReported,
    'event_time': eventTime,
    'location_method': locationMethod,
    if (edgeIdHint != null) 'edge_id_hint': edgeIdHint!,
    if (evidenceMetadata != null) 'evidence_metadata': evidenceMetadata!.toJson(),
  };
}

class Incident {
  const Incident({
    this.mapWithdrawn,
    this.moderationNote,
    this.officialSource,
    required this.schemaVersion,
    required this.incidentId,
    required this.incidentType,
    required this.latitude,
    required this.longitude,
    required this.description,
    required this.severityReported,
    required this.roadPassabilityReported,
    required this.eventTime,
    required this.receivedAt,
    required this.sourceType,
    required this.verificationStatus,
    required this.evidenceMetadata,
    required this.affectedEdgeIds,
    required this.graphVersion,
    required this.snapDistanceM,
    required this.locationMethod,
    required this.locationPrecisionM,
    required this.expiresAt,
    required this.updatedAt,
  });

  final bool? mapWithdrawn;
  final String? moderationNote;
  final IncidentOfficialSource? officialSource;
  final int schemaVersion;
  final String incidentId;
  final String incidentType;
  final double latitude;
  final double longitude;
  final String description;
  final String severityReported;
  final String roadPassabilityReported;
  final String eventTime;
  final String receivedAt;
  final String sourceType;
  final String verificationStatus;
  final IncidentEvidenceMetadata evidenceMetadata;
  final List<String> affectedEdgeIds;
  final String graphVersion;
  final double snapDistanceM;
  final String locationMethod;
  final double locationPrecisionM;
  final String expiresAt;
  final String updatedAt;

  factory Incident.fromJson(Map<String, dynamic> json) => Incident(
    mapWithdrawn: json['map_withdrawn'] == null ? null : json['map_withdrawn'] as bool,
    moderationNote: json['moderation_note'] == null ? null : json['moderation_note'] as String,
    officialSource: json['official_source'] == null ? null : IncidentOfficialSource.fromJson(Map<String, dynamic>.from(json['official_source'] as Map)),
    schemaVersion: json['schema_version'] as int,
    incidentId: json['incident_id'] as String,
    incidentType: json['incident_type'] as String,
    latitude: (json['latitude'] as num).toDouble(),
    longitude: (json['longitude'] as num).toDouble(),
    description: json['description'] as String,
    severityReported: json['severity_reported'] as String,
    roadPassabilityReported: json['road_passability_reported'] as String,
    eventTime: json['event_time'] as String,
    receivedAt: json['received_at'] as String,
    sourceType: json['source_type'] as String,
    verificationStatus: json['verification_status'] as String,
    evidenceMetadata: IncidentEvidenceMetadata.fromJson(Map<String, dynamic>.from(json['evidence_metadata'] as Map)),
    affectedEdgeIds: (json['affected_edge_ids'] as List).map((value) => value as String).toList(),
    graphVersion: json['graph_version'] as String,
    snapDistanceM: (json['snap_distance_m'] as num).toDouble(),
    locationMethod: json['location_method'] as String,
    locationPrecisionM: (json['location_precision_m'] as num).toDouble(),
    expiresAt: json['expires_at'] as String,
    updatedAt: json['updated_at'] as String,
  );

  Map<String, dynamic> toJson() => {
    if (mapWithdrawn != null) 'map_withdrawn': mapWithdrawn!,
    if (moderationNote != null) 'moderation_note': moderationNote!,
    if (officialSource != null) 'official_source': officialSource!.toJson(),
    'schema_version': schemaVersion,
    'incident_id': incidentId,
    'incident_type': incidentType,
    'latitude': latitude,
    'longitude': longitude,
    'description': description,
    'severity_reported': severityReported,
    'road_passability_reported': roadPassabilityReported,
    'event_time': eventTime,
    'received_at': receivedAt,
    'source_type': sourceType,
    'verification_status': verificationStatus,
    'evidence_metadata': evidenceMetadata.toJson(),
    'affected_edge_ids': affectedEdgeIds.map((value) => value).toList(),
    'graph_version': graphVersion,
    'snap_distance_m': snapDistanceM,
    'location_method': locationMethod,
    'location_precision_m': locationPrecisionM,
    'expires_at': expiresAt,
    'updated_at': updatedAt,
  };
}

class IncidentOfficialSource {
  const IncidentOfficialSource({
    required this.title,
    required this.url,
    required this.recordedAt,
  });

  final String title;
  final String url;
  final String recordedAt;

  factory IncidentOfficialSource.fromJson(Map<String, dynamic> json) => IncidentOfficialSource(
    title: json['title'] as String,
    url: json['url'] as String,
    recordedAt: json['recorded_at'] as String,
  );

  Map<String, dynamic> toJson() => {
    'title': title,
    'url': url,
    'recorded_at': recordedAt,
  };
}

class IncidentList {
  const IncidentList({
    required this.incidents,
    required this.total,
    required this.limit,
    required this.offset,
    required this.hasMore,
  });

  final List<Incident> incidents;
  final int total;
  final int limit;
  final int offset;
  final bool hasMore;

  factory IncidentList.fromJson(Map<String, dynamic> json) => IncidentList(
    incidents: (json['incidents'] as List).map((value) => Incident.fromJson(Map<String, dynamic>.from(value as Map))).toList(),
    total: json['total'] as int,
    limit: json['limit'] as int,
    offset: json['offset'] as int,
    hasMore: json['has_more'] as bool,
  );

  Map<String, dynamic> toJson() => {
    'incidents': incidents.map((value) => value.toJson()).toList(),
    'total': total,
    'limit': limit,
    'offset': offset,
    'has_more': hasMore,
  };
}

class IncidentApplication {
  const IncidentApplication({
    required this.applicationId,
    required this.incidentId,
    required this.runId,
    required this.affectedEdgeIds,
    required this.simulationStep,
    required this.worldVersion,
    required this.sourceType,
    required this.verificationStatusAtApplication,
    required this.effect,
    required this.expiresAtSimulationStep,
    required this.appliedAt,
  });

  final String applicationId;
  final String incidentId;
  final String runId;
  final List<String> affectedEdgeIds;
  final int simulationStep;
  final int worldVersion;
  final String sourceType;
  final String verificationStatusAtApplication;
  final String effect;
  final int expiresAtSimulationStep;
  final String appliedAt;

  factory IncidentApplication.fromJson(Map<String, dynamic> json) => IncidentApplication(
    applicationId: json['application_id'] as String,
    incidentId: json['incident_id'] as String,
    runId: json['run_id'] as String,
    affectedEdgeIds: (json['affected_edge_ids'] as List).map((value) => value as String).toList(),
    simulationStep: json['simulation_step'] as int,
    worldVersion: json['world_version'] as int,
    sourceType: json['source_type'] as String,
    verificationStatusAtApplication: json['verification_status_at_application'] as String,
    effect: json['effect'] as String,
    expiresAtSimulationStep: json['expires_at_simulation_step'] as int,
    appliedAt: json['applied_at'] as String,
  );

  Map<String, dynamic> toJson() => {
    'application_id': applicationId,
    'incident_id': incidentId,
    'run_id': runId,
    'affected_edge_ids': affectedEdgeIds.map((value) => value).toList(),
    'simulation_step': simulationStep,
    'world_version': worldVersion,
    'source_type': sourceType,
    'verification_status_at_application': verificationStatusAtApplication,
    'effect': effect,
    'expires_at_simulation_step': expiresAtSimulationStep,
    'applied_at': appliedAt,
  };
}

class LabGeographicReference {
  const LabGeographicReference({
    required this.enabled,
    this.datasetVersion,
    required this.strength,
  });

  final bool enabled;
  final String? datasetVersion;
  final double strength;

  factory LabGeographicReference.fromJson(Map<String, dynamic> json) => LabGeographicReference(
    enabled: json['enabled'] as bool,
    datasetVersion: json['dataset_version'] == null ? null : json['dataset_version'] as String,
    strength: (json['strength'] as num).toDouble(),
  );

  Map<String, dynamic> toJson() => {
    'enabled': enabled,
    if (datasetVersion != null) 'dataset_version': datasetVersion!,
    'strength': strength,
  };
}

class ReferenceZoneUse {
  const ReferenceZoneUse({
    required this.zoneId,
    required this.susceptibility,
    required this.factor,
    required this.featureIds,
  });

  final String zoneId;
  final String susceptibility;
  final double factor;
  final List<String> featureIds;

  factory ReferenceZoneUse.fromJson(Map<String, dynamic> json) => ReferenceZoneUse(
    zoneId: json['zone_id'] as String,
    susceptibility: json['susceptibility'] as String,
    factor: (json['factor'] as num).toDouble(),
    featureIds: (json['feature_ids'] as List).map((value) => value as String).toList(),
  );

  Map<String, dynamic> toJson() => {
    'zone_id': zoneId,
    'susceptibility': susceptibility,
    'factor': factor,
    'feature_ids': featureIds.map((value) => value).toList(),
  };
}

class ReferenceUse {
  const ReferenceUse({
    required this.category,
    required this.datasetVersion,
    required this.sourceUrl,
    required this.consultedAt,
    required this.strength,
    required this.zones,
  });

  final String category;
  final String datasetVersion;
  final String sourceUrl;
  final String consultedAt;
  final double strength;
  final List<ReferenceZoneUse> zones;

  factory ReferenceUse.fromJson(Map<String, dynamic> json) => ReferenceUse(
    category: json['category'] as String,
    datasetVersion: json['dataset_version'] as String,
    sourceUrl: json['source_url'] as String,
    consultedAt: json['consulted_at'] as String,
    strength: (json['strength'] as num).toDouble(),
    zones: (json['zones'] as List).map((value) => ReferenceZoneUse.fromJson(Map<String, dynamic>.from(value as Map))).toList(),
  );

  Map<String, dynamic> toJson() => {
    'category': category,
    'dataset_version': datasetVersion,
    'source_url': sourceUrl,
    'consulted_at': consultedAt,
    'strength': strength,
    'zones': zones.map((value) => value.toJson()).toList(),
  };
}

class HydrologyConfig {
  const HydrologyConfig({
    this.secondsPerTurn,
    this.antecedentRainHours,
    this.initialSaturation,
    this.initialWaterDepthM,
    this.seaLevelM,
    this.channelInflowM3S,
    this.cellSizeM,
    this.infiltrationMmH,
    this.drainageMmH,
    this.cautionDepthM,
    this.blockedDepthM,
    this.hysteresisM,
  });

  final double? secondsPerTurn;
  final double? antecedentRainHours;
  final double? initialSaturation;
  final double? initialWaterDepthM;
  final double? seaLevelM;
  final double? channelInflowM3S;
  final double? cellSizeM;
  final double? infiltrationMmH;
  final double? drainageMmH;
  final double? cautionDepthM;
  final double? blockedDepthM;
  final double? hysteresisM;

  factory HydrologyConfig.fromJson(Map<String, dynamic> json) => HydrologyConfig(
    secondsPerTurn: json['seconds_per_turn'] == null ? null : (json['seconds_per_turn'] as num).toDouble(),
    antecedentRainHours: json['antecedent_rain_hours'] == null ? null : (json['antecedent_rain_hours'] as num).toDouble(),
    initialSaturation: json['initial_saturation'] == null ? null : (json['initial_saturation'] as num).toDouble(),
    initialWaterDepthM: json['initial_water_depth_m'] == null ? null : (json['initial_water_depth_m'] as num).toDouble(),
    seaLevelM: json['sea_level_m'] == null ? null : (json['sea_level_m'] as num).toDouble(),
    channelInflowM3S: json['channel_inflow_m3_s'] == null ? null : (json['channel_inflow_m3_s'] as num).toDouble(),
    cellSizeM: json['cell_size_m'] == null ? null : (json['cell_size_m'] as num).toDouble(),
    infiltrationMmH: json['infiltration_mm_h'] == null ? null : (json['infiltration_mm_h'] as num).toDouble(),
    drainageMmH: json['drainage_mm_h'] == null ? null : (json['drainage_mm_h'] as num).toDouble(),
    cautionDepthM: json['caution_depth_m'] == null ? null : (json['caution_depth_m'] as num).toDouble(),
    blockedDepthM: json['blocked_depth_m'] == null ? null : (json['blocked_depth_m'] as num).toDouble(),
    hysteresisM: json['hysteresis_m'] == null ? null : (json['hysteresis_m'] as num).toDouble(),
  );

  Map<String, dynamic> toJson() => {
    if (secondsPerTurn != null) 'seconds_per_turn': secondsPerTurn!,
    if (antecedentRainHours != null) 'antecedent_rain_hours': antecedentRainHours!,
    if (initialSaturation != null) 'initial_saturation': initialSaturation!,
    if (initialWaterDepthM != null) 'initial_water_depth_m': initialWaterDepthM!,
    if (seaLevelM != null) 'sea_level_m': seaLevelM!,
    if (channelInflowM3S != null) 'channel_inflow_m3_s': channelInflowM3S!,
    if (cellSizeM != null) 'cell_size_m': cellSizeM!,
    if (infiltrationMmH != null) 'infiltration_mm_h': infiltrationMmH!,
    if (drainageMmH != null) 'drainage_mm_h': drainageMmH!,
    if (cautionDepthM != null) 'caution_depth_m': cautionDepthM!,
    if (blockedDepthM != null) 'blocked_depth_m': blockedDepthM!,
    if (hysteresisM != null) 'hysteresis_m': hysteresisM!,
  };
}

class HydraulicGrid {
  const HydraulicGrid({
    required this.origin,
    required this.rows,
    required this.cols,
    required this.cellSizeM,
    required this.latStep,
    required this.lngStep,
  });

  final GeoPoint origin;
  final int rows;
  final int cols;
  final double cellSizeM;
  final double latStep;
  final double lngStep;

  factory HydraulicGrid.fromJson(Map<String, dynamic> json) => HydraulicGrid(
    origin: GeoPoint.fromJson(Map<String, dynamic>.from(json['origin'] as Map)),
    rows: json['rows'] as int,
    cols: json['cols'] as int,
    cellSizeM: (json['cell_size_m'] as num).toDouble(),
    latStep: (json['lat_step'] as num).toDouble(),
    lngStep: (json['lng_step'] as num).toDouble(),
  );

  Map<String, dynamic> toJson() => {
    'origin': origin.toJson(),
    'rows': rows,
    'cols': cols,
    'cell_size_m': cellSizeM,
    'lat_step': latStep,
    'lng_step': lngStep,
  };
}

class HydraulicMassBalance {
  const HydraulicMassBalance({
    required this.initialStorageM3,
    required this.rainfallM3,
    required this.channelInflowM3,
    required this.seaInflowM3,
    required this.infiltrationM3,
    required this.drainageM3,
    required this.seaOutflowM3,
    required this.storedM3,
    required this.residualM3,
  });

  final double initialStorageM3;
  final double rainfallM3;
  final double channelInflowM3;
  final double seaInflowM3;
  final double infiltrationM3;
  final double drainageM3;
  final double seaOutflowM3;
  final double storedM3;
  final double residualM3;

  factory HydraulicMassBalance.fromJson(Map<String, dynamic> json) => HydraulicMassBalance(
    initialStorageM3: (json['initial_storage_m3'] as num).toDouble(),
    rainfallM3: (json['rainfall_m3'] as num).toDouble(),
    channelInflowM3: (json['channel_inflow_m3'] as num).toDouble(),
    seaInflowM3: (json['sea_inflow_m3'] as num).toDouble(),
    infiltrationM3: (json['infiltration_m3'] as num).toDouble(),
    drainageM3: (json['drainage_m3'] as num).toDouble(),
    seaOutflowM3: (json['sea_outflow_m3'] as num).toDouble(),
    storedM3: (json['stored_m3'] as num).toDouble(),
    residualM3: (json['residual_m3'] as num).toDouble(),
  );

  Map<String, dynamic> toJson() => {
    'initial_storage_m3': initialStorageM3,
    'rainfall_m3': rainfallM3,
    'channel_inflow_m3': channelInflowM3,
    'sea_inflow_m3': seaInflowM3,
    'infiltration_m3': infiltrationM3,
    'drainage_m3': drainageM3,
    'sea_outflow_m3': seaOutflowM3,
    'stored_m3': storedM3,
    'residual_m3': residualM3,
  };
}

class HydraulicSnapshot {
  const HydraulicSnapshot({
    required this.model,
    required this.terrainSource,
    required this.grid,
    required this.depthsM,
    required this.rainfallMmH,
    required this.hydrologicalTimeSeconds,
    required this.floodedAreaM2,
    required this.maxDepthM,
    required this.massBalance,
  });

  final String model;
  final String terrainSource;
  final HydraulicGrid grid;
  final List<double> depthsM;
  final double rainfallMmH;
  final double hydrologicalTimeSeconds;
  final double floodedAreaM2;
  final double maxDepthM;
  final HydraulicMassBalance massBalance;

  factory HydraulicSnapshot.fromJson(Map<String, dynamic> json) => HydraulicSnapshot(
    model: json['model'] as String,
    terrainSource: json['terrain_source'] as String,
    grid: HydraulicGrid.fromJson(Map<String, dynamic>.from(json['grid'] as Map)),
    depthsM: (json['depths_m'] as List).map((value) => (value as num).toDouble()).toList(),
    rainfallMmH: (json['rainfall_mm_h'] as num).toDouble(),
    hydrologicalTimeSeconds: (json['hydrological_time_seconds'] as num).toDouble(),
    floodedAreaM2: (json['flooded_area_m2'] as num).toDouble(),
    maxDepthM: (json['max_depth_m'] as num).toDouble(),
    massBalance: HydraulicMassBalance.fromJson(Map<String, dynamic>.from(json['mass_balance'] as Map)),
  );

  Map<String, dynamic> toJson() => {
    'model': model,
    'terrain_source': terrainSource,
    'grid': grid.toJson(),
    'depths_m': depthsM.map((value) => value).toList(),
    'rainfall_mm_h': rainfallMmH,
    'hydrological_time_seconds': hydrologicalTimeSeconds,
    'flooded_area_m2': floodedAreaM2,
    'max_depth_m': maxDepthM,
    'mass_balance': massBalance.toJson(),
  };
}
