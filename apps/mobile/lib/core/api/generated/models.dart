// GENERATED from packages/contracts/openapi.yaml. Do not edit.

// ignore_for_file: always_put_required_named_parameters_first, use_null_aware_elements

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
    required this.plannedRoute,
  });

  final String id;
  final String currentNode;
  final String status;
  final String targetShelterId;
  final String? spawnZoneId;
  final List<String> plannedRoute;

  factory Survivor.fromJson(Map<String, dynamic> json) => Survivor(
    id: json['id'] as String,
    currentNode: json['current_node'] as String,
    status: json['status'] as String,
    targetShelterId: json['target_shelter_id'] as String,
    spawnZoneId: json['spawn_zone_id'] == null ? null : json['spawn_zone_id'] as String,
    plannedRoute: (json['planned_route'] as List).map((value) => value as String).toList(),
  );

  Map<String, dynamic> toJson() => {
    'id': id,
    'current_node': currentNode,
    'status': status,
    'target_shelter_id': targetShelterId,
    if (spawnZoneId != null) 'spawn_zone_id': spawnZoneId!,
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
