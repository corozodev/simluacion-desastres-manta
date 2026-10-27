import 'package:dio/dio.dart';

import 'generated/models.dart';
import 'http_request.dart';

/// Presentation data from the authoritative public snapshots. No local engine.
class PublishedView {
  const PublishedView({
    required this.scenario,
    required this.availability,
    this.id = '',
    this.status = 'idle',
    this.version = 0,
    this.tick = 0,
    this.maxTicks = 150,
    this.graphVersion = '',
    this.mode = 'competition',
    this.world,
    this.agents = const [],
    this.shelters = const [],
    this.roads = const {},
    this.agentStates = const {},
    this.shelterNames = const {},
    this.shelterStates = const {},
    this.hydraulic,
    this.rainfall = 0,
    this.evacuated = 0,
    this.waiting = 0,
    this.isolated = 0,
  });
  final String scenario, availability, id, status, graphVersion, mode;
  final int version, tick, maxTicks, evacuated, waiting, isolated;
  final WorldSnapshot? world;
  final List<Survivor> agents;
  final List<Shelter> shelters;
  final Map<String, String> roads, agentStates, shelterNames, shelterStates;
  final HydraulicSnapshot? hydraulic;
  final double rainfall;
  bool get terminal => const [
    'COMPLETED',
    'CANCELLED',
    'FAILED',
    'finished',
    'failed',
    'cancelled',
  ].contains(status);
  bool get active => availability == 'available';

  factory PublishedView.zombie(Map<String, dynamic> json) {
    if (json['scenario'] != 'zombie_outbreak' ||
        !const [
          'none',
          'available',
          'unavailable',
        ].contains(json['availability'])) {
      throw const FormatException('Invalid publication');
    }
    if (json['availability'] != 'available') {
      return PublishedView(
        scenario: 'zombie_outbreak',
        availability: json['availability'] as String,
      );
    }
    final value = _object(json['simulation']);
    if (value['scenario'] != 'zombie_outbreak' ||
        !const ['BASE', 'FULL_MANTA'].contains(value['graph_profile']) ||
        value.containsKey('access_token') ||
        (value['state_version'] as int) < 0 ||
        (value['max_ticks'] as int) < 1 ||
        (value['max_ticks'] as int) > 3000 ||
        (value['tick'] as int) > (value['max_ticks'] as int)) {
      throw const FormatException('Invalid public simulation');
    }
    final world = WorldSnapshot.fromJson(_object(value['snapshot']));
    if (world.graphVersion != value['graph_version'] ||
        world.turn != value['tick'] ||
        world.turn < 0 ||
        world.zombies.any(
          (zombie) => zombie.type == 'sleeper' && !zombie.awake,
        ) ||
        !const [
          'CREATED',
          'RUNNING',
          'PAUSED',
          'COMPLETED',
          'CANCELLED',
          'FAILED',
        ].contains(value['status']) ||
        (value['simulation_id'] as String).isEmpty ||
        world.survivors.any(
          (agent) =>
              !const ['active', 'evacuated', 'bitten'].contains(agent.status),
        )) {
      throw const FormatException('Invalid state');
    }
    _shelters(world.shelters);
    return PublishedView(
      scenario: 'zombie_outbreak',
      availability: 'available',
      id: value['simulation_id'] as String,
      status: value['status'] as String,
      version: value['state_version'] as int,
      tick: value['tick'] as int,
      maxTicks: value['max_ticks'] as int,
      graphVersion: world.graphVersion,
      mode: value['graph_profile'] == 'FULL_MANTA' ? 'full' : 'competition',
      world: world,
      agents: world.survivors,
      shelters: world.shelters,
      evacuated: world.metrics.evacuated,
    );
  }

  factory PublishedView.flood(Map<String, dynamic> json) {
    final state = json['state'] as String;
    if (!const [
          'idle',
          'running',
          'paused',
          'finished',
          'failed',
          'cancelled',
        ].contains(state) ||
        !const ['competition', 'full'].contains(json['mode'])) {
      throw const FormatException('Invalid flood lifecycle');
    }
    final scenario = _object(json['scenario']);
    final cfg = _object(json['config']);
    if (scenario['scenario_type'] != 'urban_flood' ||
        scenario['graph_version'] != json['graph_version']) {
      throw const FormatException('Invalid flood geography');
    }
    final agents = <Survivor>[];
    final states = <String, String>{};
    for (final raw in scenario['agents'] as List) {
      final agent = _object(raw);
      if (!const [
        'moving',
        'waiting',
        'isolated',
        'evacuated',
      ].contains(agent['state'])) {
        throw const FormatException('Invalid flood agent');
      }
      final id = agent['id'] as String;
      states[id] = agent['state'] as String;
      agents.add(
        Survivor(
          id: id,
          currentNode: agent['current_node'] as String,
          status: agent['state'] == 'evacuated' ? 'evacuated' : 'active',
          targetShelterId: agent['target_shelter_id'] as String,
          plannedRoute: (agent['planned_route'] as List).cast<String>(),
        ),
      );
    }
    final roads = <String, String>{};
    for (final raw in scenario['road_conditions'] as List) {
      final road = _object(raw);
      if (!const ['passable', 'caution', 'blocked'].contains(road['state'])) {
        throw const FormatException('Invalid road state');
      }
      roads[road['edge_id'] as String] = road['state'] as String;
    }
    final shelterStates = <String, String>{};
    for (final raw in scenario['shelter_conditions'] as List) {
      final condition = _object(raw);
      if (!const [
        'available',
        'full',
        'exposed',
        'inaccessible',
      ].contains(condition['state'])) {
        throw const FormatException('Invalid shelter state');
      }
      shelterStates[condition['shelter_id'] as String] =
          condition['state'] as String;
    }
    final shelters = (json['shelters'] as List)
        .map((v) => Shelter.fromJson(_object(v)))
        .toList();
    _shelters(shelters);
    final metrics = _object(scenario['evacuation_metrics']);
    final duration = (scenario['simulation_duration'] as num).toDouble();
    final step = (scenario['time_step'] as num).toDouble();
    if (!duration.isFinite ||
        step <= 0 ||
        !step.isFinite ||
        (scenario['simulation_step'] as int) < 0) {
      throw const FormatException('Invalid flood time');
    }
    final hydraulic = scenario['hydraulic'] == null
        ? null
        : HydraulicSnapshot.fromJson(_object(scenario['hydraulic']));
    if (hydraulic != null) validateHydraulic(hydraulic);
    return PublishedView(
      scenario: 'urban_flood',
      availability: state == 'idle' ? 'none' : 'available',
      id: json['run_id'] as String,
      status: state,
      version: scenario['world_version'] as int,
      tick: scenario['simulation_step'] as int,
      maxTicks: (duration / step).ceil(),
      graphVersion: json['graph_version'] as String,
      mode: json['mode'] as String,
      agents: agents,
      shelters: shelters,
      roads: roads,
      agentStates: states,
      shelterStates: shelterStates,
      rainfall: (scenario['rainfall'] as num).toDouble(),
      evacuated: metrics['evacuated_agents'] as int,
      waiting: metrics['waiting_agents'] as int,
      isolated: metrics['isolated_agents'] as int,
      shelterNames: {
        for (final raw in cfg['shelters'] as List)
          (_object(raw)['id'] as String): (_object(raw)['label'] as String),
      },
      hydraulic: hydraulic,
    );
  }
}

/// Reject malformed remote grids before allocating paths in the observer.
void validateHydraulic(HydraulicSnapshot value) {
  final grid = value.grid;
  if (!const [
        'rainfall_runoff_2d',
        'compound_flood_2d',
      ].contains(value.model) ||
      grid.rows < 1 ||
      grid.cols < 1 ||
      grid.rows * grid.cols > 4096 ||
      value.depthsM.length != grid.rows * grid.cols ||
      !grid.cellSizeM.isFinite ||
      grid.cellSizeM <= 0 ||
      !grid.latStep.isFinite ||
      grid.latStep <= 0 ||
      !grid.lngStep.isFinite ||
      grid.lngStep <= 0 ||
      !grid.origin.lat.isFinite ||
      !grid.origin.lng.isFinite ||
      grid.origin.lat < -90 ||
      grid.origin.lat + grid.rows * grid.latStep > 90 ||
      grid.origin.lng < -180 ||
      grid.origin.lng + grid.cols * grid.lngStep > 180 ||
      value.depthsM.any((depth) => !depth.isFinite || depth < 0)) {
    throw const FormatException('Invalid hydraulic grid');
  }
}

Map<String, dynamic> _object(dynamic value) =>
    Map<String, dynamic>.from(value as Map);
void _shelters(List<Shelter> shelters) {
  if (shelters.any(
    (s) =>
        s.capacity < 1 ||
        s.occupancy < 0 ||
        s.occupancy > s.capacity ||
        (s.reserved ?? 0) < 0 ||
        s.occupancy + (s.reserved ?? 0) > s.capacity ||
        s.available != null &&
            s.available != s.capacity - s.occupancy - (s.reserved ?? 0),
  )) {
    throw const FormatException('Invalid capacity');
  }
}

abstract interface class SpectatorRepository {
  Future<PublishedView> published(String scenario);
  Future<Graph> graph(PublishedView view);
}

class HttpSpectatorRepository implements SpectatorRepository {
  HttpSpectatorRepository(this.worldDio, this.floodDio);
  final Dio worldDio, floodDio;
  final _graphs = <String, Graph>{};
  @override
  Future<PublishedView> published(String scenario) =>
      scenario == 'zombie_outbreak'
      ? requestJson(
          () => worldDio.get('v1/simulations/published/zombie_outbreak'),
          PublishedView.zombie,
        )
      : requestJson(() => floodDio.get('lab/published'), PublishedView.flood);

  @override
  Future<Graph> graph(PublishedView view) async {
    final key = '${view.scenario}:${view.mode}:${view.graphVersion}';
    final existing = _graphs[key];
    if (existing != null) return existing;
    final graph = await requestJson(
      () => view.scenario == 'zombie_outbreak'
          ? worldDio.get('grafo', queryParameters: {'mode': view.mode})
          : floodDio.get(
              'lab/graph',
              queryParameters: {
                'mode': view.mode,
                if (view.id.isNotEmpty) 'run_id': view.id,
              },
            ),
      Graph.fromJson,
    );
    if (view.graphVersion.isNotEmpty && graph.version != view.graphVersion ||
        graph.nodes.isEmpty ||
        graph.nodes.any(
          (node) =>
              !node.lat.isFinite ||
              !node.lng.isFinite ||
              node.lat.abs() > 90 ||
              node.lng.abs() > 180,
        )) {
      throw const FormatException('Invalid graph');
    }
    _graphs[key] = graph;
    // Bound cache while permitting both BASE/FULL views and citizen geography.
    if (_graphs.length > 8) _graphs.remove(_graphs.keys.first);
    return graph;
  }
}
