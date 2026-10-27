import 'package:corodev_spooky/core/api/dio_client.dart';
import 'package:corodev_spooky/core/api/world_repository.dart';
import 'package:corodev_spooky/core/config/api_config.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const enabled = bool.fromEnvironment('RUN_WORLD_HTTP_TESTS');
  const urban = bool.fromEnvironment('EXPECT_URBAN_WORLD');
  test(
    'Dart world repository consumes the actual Go observable HTTP contract',
    () async {
      final dio = createDio(
        ApiConfig(
          baseUrl: const String.fromEnvironment(
            'WORLD_API_BASE_URL',
            defaultValue: 'http://localhost:8080',
          ),
        ),
      );
      addTearDown(() => dio.close(force: true));
      final repository = HttpWorldRepository(dio);
      final health = await repository.health();
      expect(health.service, 'corodev-evacuation');
      final graph = await repository.graph();
      final world = await repository.state();
      expect(graph.nodes, hasLength(300));
      expect(graph.shelters, hasLength(4));
      expect(world.graphVersion, graph.version);
      expect(world.survivors, isNotEmpty);
      final survivor = await repository.survivor(world.survivors.first.id);
      expect(
        graph.nodes.any((node) => node.id == survivor.currentNode),
        isTrue,
      );
      expect(
        world.zombies.any(
          (zombie) => zombie.type == 'sleeper' && !zombie.awake,
        ),
        isFalse,
      );
      expect(world.metrics.httpP95Ms, greaterThanOrEqualTo(0));
      if (urban) {
        expect(graph.spawnZones, hasLength(4));
        expect(
          graph.edges.every((edge) => edge.geometry?.isNotEmpty == true),
          isTrue,
        );
        expect(
          world.survivors.every(
            (survivor) => graph.spawnZones!.any(
              (zone) => zone.id == survivor.spawnZoneId,
            ),
          ),
          isTrue,
        );
        expect(
          world.shelters.every(
            (shelter) =>
                shelter.reserved != null &&
                shelter.available != null &&
                shelter.occupancy + shelter.reserved! + shelter.available! ==
                    shelter.capacity,
          ),
          isTrue,
        );
      }
    },
    skip: !enabled ? 'Requiere backend Go y RUN_WORLD_HTTP_TESTS=true' : false,
  );
}
