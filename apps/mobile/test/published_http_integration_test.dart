import 'dart:convert';
import 'dart:io';

import 'package:corodev_spooky/core/api/dio_client.dart';
import 'package:corodev_spooky/core/api/spectator_repository.dart';
import 'package:corodev_spooky/core/config/api_config.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:dio/dio.dart';

void main() {
  const enabled = bool.fromEnvironment('RUN_PUBLISHED_HTTP_TESTS');
  test(
    'Flutter observes the real shared Go runs without creating an execution',
    () async {
      final world = createDio(
        ApiConfig(
          baseUrl: const String.fromEnvironment(
            'WORLD_API_BASE_URL',
            defaultValue: 'http://127.0.0.1:8080',
          ),
        ),
      );
      final flood = createDio(
        ApiConfig(
          baseUrl: const String.fromEnvironment(
            'FLOOD_API_BASE_URL',
            defaultValue: 'http://127.0.0.1:8082',
          ),
        ),
      );
      addTearDown(() {
        world.close(force: true);
        flood.close(force: true);
      });
      final methods = <String>[];
      final repository = HttpSpectatorRepository(world, flood);
      for (final dio in [world, flood]) {
        dio.interceptors.add(
          InterceptorsWrapper(
            onRequest: (request, handler) {
              methods.add(request.method);
              expect(request.headers.containsKey('Authorization'), isFalse);
              handler.next(request);
            },
          ),
        );
      }
      final results = <String, dynamic>{};
      for (final scenario in ['zombie_outbreak', 'urban_flood']) {
        final current = await repository.published(scenario);
        final graph = await repository.graph(current);
        expect(graph.nodes, isNotEmpty);
        if (current.graphVersion.isNotEmpty) {
          expect(graph.version, current.graphVersion);
        }
        final expectedId = scenario == 'zombie_outbreak'
            ? const String.fromEnvironment('EXPECTED_ZOMBIE_ID')
            : const String.fromEnvironment('EXPECTED_FLOOD_ID');
        if (expectedId.isNotEmpty) expect(current.id, expectedId);
        final again = await repository.published(scenario);
        if (current.id.isNotEmpty && current.id == again.id) {
          expect(again.tick, greaterThanOrEqualTo(current.tick));
        }
        expect(await repository.graph(current), same(graph));
        results[scenario] = {
          'id': current.id,
          'tick': current.tick,
          'status': current.status,
          'agents': current.agents.length,
          'graph_version': graph.version,
        };
      }
      expect(methods.every((method) => method == 'GET'), isTrue);
      const output = String.fromEnvironment('PUBLISHED_TEST_OUTPUT');
      if (output.isNotEmpty) {
        File(output).writeAsStringSync(jsonEncode(results));
      }
    },
    skip: enabled ? false : 'Requiere Go y RUN_PUBLISHED_HTTP_TESTS=true',
  );
}
