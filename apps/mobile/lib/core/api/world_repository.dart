import 'package:dio/dio.dart';

import 'api_failure.dart';
import 'generated/models.dart';
import 'http_request.dart';

bool _validShelter(Shelter shelter) =>
    shelter.capacity > 0 &&
    shelter.occupancy >= 0 &&
    shelter.occupancy <= shelter.capacity &&
    (shelter.reserved == null ||
        shelter.reserved! >= 0 &&
            shelter.reserved! + shelter.occupancy <= shelter.capacity) &&
    (shelter.available == null ||
        shelter.available! >= 0 && shelter.available! <= shelter.capacity) &&
    (shelter.reserved == null ||
        shelter.available == null ||
        shelter.reserved! + shelter.available! + shelter.occupancy ==
            shelter.capacity);

abstract interface class WorldRepository {
  Future<HealthResponse> health();
  Future<WorldSnapshot> state();
  Future<Graph> graph();
  Future<Survivor> survivor(String id);
}

class HttpWorldRepository implements WorldRepository {
  const HttpWorldRepository(this.dio);
  final Dio dio;

  @override
  Future<HealthResponse> health() =>
      requestJson(() => dio.get('healthz'), (json) {
        final result = HealthResponse.fromJson(json);
        if (result.status != 'ok' ||
            result.service.isEmpty ||
            result.version.isEmpty) {
          throw const FormatException('Invalid health response');
        }
        return result;
      });

  @override
  Future<WorldSnapshot> state() => requestJson(() => dio.get('estado'), (json) {
    final result = WorldSnapshot.fromJson(json);
    if (result.turn < 0 ||
        result.worldVersion < 0 ||
        result.graphVersion.isEmpty ||
        result.shelters.any((shelter) => !_validShelter(shelter)) ||
        result.survivors.any(
          (survivor) => !const [
            'active',
            'bitten',
            'evacuated',
          ].contains(survivor.status),
        ) ||
        result.zombies.any(
          (zombie) => zombie.type == 'sleeper' && !zombie.awake,
        )) {
      throw const FormatException('Invalid observable world');
    }
    return result;
  });

  @override
  Future<Graph> graph() => requestJson(() => dio.get('grafo'), (json) {
    final graph = Graph.fromJson(json);
    bool validPoint(GeoPoint point) =>
        point.lat.isFinite &&
        point.lng.isFinite &&
        point.lat.abs() <= 90 &&
        point.lng.abs() <= 180;
    if (graph.nodes.isEmpty ||
        graph.nodes.any(
          (node) =>
              !node.lat.isFinite ||
              !node.lng.isFinite ||
              node.lat.abs() > 90 ||
              node.lng.abs() > 180,
        ) ||
        graph.shelters.any((shelter) => !_validShelter(shelter)) ||
        graph.edges.any(
          (edge) => edge.geometry?.any((point) => !validPoint(point)) == true,
        ) ||
        graph.coverage?.any((point) => !validPoint(point)) == true ||
        graph.spawnZones?.any(
              (zone) => zone.geometry.any((point) => !validPoint(point)),
            ) ==
            true) {
      throw const FormatException('Invalid geographic graph');
    }
    return graph;
  });

  @override
  Future<Survivor> survivor(String id) async {
    final snapshot = await state();
    for (final survivor in snapshot.survivors) {
      if (survivor.id == id) return survivor;
    }
    throw const ApiFailure(
      code: 'NOT_FOUND',
      message: 'No existe un sobreviviente con ese ID.',
    );
  }
}
