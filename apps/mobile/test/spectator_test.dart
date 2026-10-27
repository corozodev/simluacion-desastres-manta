import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:corodev_spooky/core/api/api_failure.dart';
import 'package:corodev_spooky/core/api/dio_client.dart';
import 'package:corodev_spooky/core/api/generated/models.dart';
import 'package:corodev_spooky/core/api/spectator_repository.dart';
import 'package:corodev_spooky/core/config/api_config.dart';
import 'package:corodev_spooky/features/spectator/observer.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

class Adapter implements HttpClientAdapter {
  Adapter(this.respond);
  final ResponseBody Function(RequestOptions) respond;
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? stream,
    Future<void>? cancel,
  ) async => respond(options);
  @override
  void close({bool force = false}) {}
}

Graph fixtureGraph() => Graph.fromJson(
  jsonDecode(
        File('../../packages/contracts/examples/graph.json').readAsStringSync(),
      )
      as Map<String, dynamic>,
);
Map<String, dynamic> fixtureWorld() =>
    jsonDecode(
          File(
            '../../packages/contracts/examples/world.json',
          ).readAsStringSync(),
        )
        as Map<String, dynamic>;
ResponseBody response(Object body) => ResponseBody.fromString(
  jsonEncode(body),
  200,
  headers: {
    Headers.contentTypeHeader: ['application/json'],
  },
);

class Repository implements SpectatorRepository {
  final calls = <Completer<PublishedView>>[];
  @override
  Future<Graph> graph(PublishedView view) async => fixtureGraph();
  @override
  Future<PublishedView> published(String scenario) {
    final result = Completer<PublishedView>();
    calls.add(result);
    return result.future;
  }
}

PublishedView frame(String id, int version) => PublishedView(
  scenario: 'zombie_outbreak',
  availability: 'available',
  id: id,
  status: 'RUNNING',
  version: version,
  tick: version,
  graphVersion: fixtureGraph().version,
);
void main() {
  test(
    'repository observes shared state with GET only and caches geography across turns',
    () async {
      final dio = createDio(ApiConfig(baseUrl: 'https://example.test/stage'));
      addTearDown(() => dio.close(force: true));
      var graphRequests = 0;
      dio.httpClientAdapter = Adapter((request) {
        expect(request.method, 'GET');
        expect(request.headers.containsKey('Authorization'), isFalse);
        if (request.uri.path == '/stage/grafo') {
          graphRequests++;
          return response(fixtureGraph().toJson());
        }
        expect(
          request.uri.path,
          '/stage/v1/simulations/published/zombie_outbreak',
        );
        final world = fixtureWorld();
        return response({
          'scenario': 'zombie_outbreak',
          'availability': 'available',
          'simulation': {
            'simulation_id': 'shared',
            'scenario': 'zombie_outbreak',
            'status': 'PAUSED',
            'tick': world['turn'],
            'max_ticks': 150,
            'state_version': 80,
            'graph_profile': 'BASE',
            'graph_version': world['graph_version'],
            'snapshot': world,
          },
        });
      });
      final repository = HttpSpectatorRepository(dio, dio);
      final state = await repository.published('zombie_outbreak');
      final graph = await repository.graph(state);
      expect(state.status, 'PAUSED');
      expect(
        await repository.graph(await repository.published('zombie_outbreak')),
        same(graph),
      );
      expect(graphRequests, 1);
    },
  );
  test('repository reports malformed publications', () async {
    final dio = createDio(ApiConfig(baseUrl: 'https://example.test'));
    addTearDown(() => dio.close(force: true));
    dio.httpClientAdapter = Adapter(
      (request) => response({
        'scenario': 'zombie_outbreak',
        'availability': 'available',
        'simulation': {},
      }),
    );
    await expectLater(
      HttpSpectatorRepository(dio, dio).published('zombie_outbreak'),
      throwsA(
        isA<ApiFailure>().having(
          (error) => error.code,
          'code',
          'INVALID_RESPONSE',
        ),
      ),
    );
  });
  test('public parser refuses secret-bearing or cross-scenario snapshots', () {
    final world = fixtureWorld();
    final simulation = <String, dynamic>{
      'simulation_id': 'shared',
      'scenario': 'zombie_outbreak',
      'status': 'PAUSED',
      'tick': world['turn'],
      'max_ticks': 150,
      'state_version': 1,
      'graph_profile': 'BASE',
      'graph_version': world['graph_version'],
      'snapshot': world,
    };
    for (final changed in <Map<String, dynamic>>[
      {...simulation, 'access_token': 'must-never-be-public'},
      {...simulation, 'scenario': 'urban_flood'},
      {...simulation, 'graph_profile': 'EXPANDED'},
      {...simulation, 'max_ticks': 0},
      {...simulation, 'state_version': -1},
    ]) {
      expect(
        () => PublishedView.zombie({
          'scenario': 'zombie_outbreak',
          'availability': 'available',
          'simulation': changed,
        }),
        throwsFormatException,
      );
    }
  });

  testWidgets(
    'observer serializes requests, suspends background work and rejoins current snapshot',
    (tester) async {
      final repository = Repository();
      final observer = PublishedObserver(repository, 'zombie_outbreak');
      addTearDown(observer.dispose);
      observer.setActive(true);
      expect(repository.calls, hasLength(1));
      await observer.refresh();
      expect(repository.calls, hasLength(1));
      repository.calls[0].complete(frame('A', 80));
      await tester.pump();
      expect(observer.view?.tick, 80);
      observer.setActive(false);
      await tester.pump(const Duration(seconds: 30));
      expect(repository.calls, hasLength(1));
      observer.setActive(true);
      expect(repository.calls, hasLength(2));
      repository.calls[1].complete(frame('A', 90));
      await tester.pump();
      expect(observer.view?.tick, 90);
      expect(observer.stale, isFalse);
      await tester.pump(const Duration(seconds: 2));
      repository.calls[2].completeError(
        const ApiFailure(code: 'TIMEOUT', message: 'Sin red'),
      );
      await tester.pump();
      expect(observer.view?.tick, 90);
      expect(observer.stale, isTrue);
      await tester.pump(const Duration(seconds: 2));
      expect(repository.calls, hasLength(3));
      await tester.pump(const Duration(seconds: 2));
      repository.calls[3].complete(frame('A', 89));
      await tester.pump();
      expect(observer.view?.tick, 90);
      await tester.pump(const Duration(seconds: 4));
      repository.calls[4].complete(frame('B', 1));
      await tester.pump();
      expect(observer.view?.id, 'B');
      expect(observer.view?.tick, 1);
      expect(observer.stale, isFalse);
      observer.setActive(false);
    },
  );
  testWidgets(
    'background response is discarded and a resume during flight requests current state once',
    (tester) async {
      final repository = Repository();
      final observer = PublishedObserver(repository, 'zombie_outbreak');
      addTearDown(observer.dispose);
      observer.setActive(true);
      observer.setActive(false);
      observer.setActive(true);
      repository.calls[0].complete(frame('old', 5));
      await tester.pump();
      expect(observer.view, isNull);
      expect(repository.calls, hasLength(2));
      repository.calls[1].complete(frame('new', 20));
      await tester.pump();
      expect(observer.view?.tick, 20);
      observer.setActive(false);
    },
  );
}
