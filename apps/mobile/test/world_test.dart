import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:corodev_spooky/app/app.dart';
import 'package:corodev_spooky/core/api/api_failure.dart';
import 'package:corodev_spooky/core/api/dio_client.dart';
import 'package:corodev_spooky/core/api/generated/models.dart';
import 'package:corodev_spooky/core/api/world_repository.dart';
import 'package:corodev_spooky/core/config/api_config.dart';
import 'package:corodev_spooky/core/providers.dart';
import 'package:corodev_spooky/features/escape/route_map.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, dynamic> worldJson() {
  final value =
      jsonDecode(
            File(
              '../../packages/contracts/examples/world.json',
            ).readAsStringSync(),
          )
          as Map<String, dynamic>;
  value['survivors'] = [
    {
      'id': 'S-0001',
      'current_node': 'N-0000',
      'status': 'active',
      'target_shelter_id': 'R-2',
      'planned_route': <String>['N-0000', 'N-0001'],
      'spawn_zone_id': 'synthetic-zone',
    },
    {
      'id': 'S-0002',
      'current_node': 'N-0001',
      'status': 'evacuated',
      'target_shelter_id': 'R-2',
      'planned_route': <String>[],
    },
  ];
  return value;
}

class _Adapter implements HttpClientAdapter {
  _Adapter(this.respond);
  final ResponseBody Function(RequestOptions) respond;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async => respond(options);

  @override
  void close({bool force = false}) {}
}

class _Repository implements WorldRepository {
  @override
  Future<HealthResponse> health() async => const HealthResponse(
    status: 'ok',
    service: 'corodev-evacuation',
    version: '0.1.0',
  );
  final WorldSnapshot world = WorldSnapshot.fromJson(worldJson());

  @override
  Future<WorldSnapshot> state() async => world;
  @override
  Future<Graph> graph() async => Graph.fromJson(
    jsonDecode(
          File(
            '../../packages/contracts/examples/graph.json',
          ).readAsStringSync(),
        )
        as Map<String, dynamic>,
  );
  @override
  Future<Survivor> survivor(String id) async =>
      world.survivors.firstWhere((survivor) => survivor.id == id);
}

void main() {
  test(
    'world repository observes actual paths and looks up survivor without a key',
    () async {
      final dio = createDio(ApiConfig(baseUrl: 'https://example.com/stage'));
      addTearDown(() => dio.close(force: true));
      dio.httpClientAdapter = _Adapter((request) {
        expect(request.uri.path, '/stage/estado');
        expect(request.headers.containsKey('x-api-key'), isFalse);
        return ResponseBody.fromString(
          jsonEncode(worldJson()),
          200,
          headers: {
            Headers.contentTypeHeader: ['application/json'],
          },
        );
      });
      final repository = HttpWorldRepository(dio);
      expect((await repository.survivor('S-0002')).status, 'evacuated');
      await expectLater(
        repository.survivor('missing'),
        throwsA(
          isA<ApiFailure>().having(
            (failure) => failure.code,
            'code',
            'NOT_FOUND',
          ),
        ),
      );
    },
  );

  test(
    'world repository translates malformed data and controlled errors',
    () async {
      final dio = Dio();
      addTearDown(() => dio.close(force: true));
      dio.httpClientAdapter = _Adapter(
        (request) => ResponseBody.fromString(
          '{"turn":1}',
          200,
          headers: {
            Headers.contentTypeHeader: ['application/json'],
          },
        ),
      );
      await expectLater(
        HttpWorldRepository(dio).state(),
        throwsA(
          isA<ApiFailure>().having(
            (failure) => failure.code,
            'code',
            'INVALID_RESPONSE',
          ),
        ),
      );
      dio.httpClientAdapter = _Adapter(
        (request) => ResponseBody.fromString(
          '{"error":{"code":"UNAVAILABLE","message":"Esperando estado","requestId":"req-world","details":[]}}',
          503,
          headers: {
            Headers.contentTypeHeader: ['application/json'],
          },
        ),
      );
      await expectLater(
        HttpWorldRepository(dio).state(),
        throwsA(
          isA<ApiFailure>().having(
            (failure) => failure.requestId,
            'requestId',
            'req-world',
          ),
        ),
      );
    },
  );

  testWidgets(
    'escape screen keeps navigation and finds an individual survivor',
    (tester) async {
      tester.view.physicalSize = const Size(430, 1500);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final router = createRouter(initialLocation: '/');
      addTearDown(router.dispose);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [worldRepositoryProvider.overrideWithValue(_Repository())],
          child: SpookyApp(router: router),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Escape de Manta Zombie'), findsWidgets);
      expect(find.byType(NavigationBar), findsNothing);
      expect(find.byTooltip('API evacuación conectada'), findsOneWidget);
      expect(router.routeInformationProvider.value.uri.path, '/escape');
      expect(find.text('Estado conectado'), findsOneWidget);
      expect(find.widgetWithText(ListTile, 'S-0001'), findsOneWidget);
      await tester.enterText(
        find.byKey(const Key('survivor-search')),
        'S-0002',
      );
      await tester.pumpAndSettle();
      expect(find.widgetWithText(ListTile, 'S-0001'), findsNothing);
      expect(find.widgetWithText(ListTile, 'S-0002'), findsOneWidget);
      expect(find.text('Evacuado'), findsOneWidget);
      expect(find.text('Refugio asignado: R-2'), findsOneWidget);
      expect(find.text('Siguiente movimiento: N-0001'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  test(
    'geographic route preserves real edge geometry and warns only about observable threats',
    () {
      final json =
          jsonDecode(
                File(
                  '../../packages/contracts/examples/graph.json',
                ).readAsStringSync(),
              )
              as Map<String, dynamic>;
      final edge = (json['edges'] as List)
          .cast<Map<String, dynamic>>()
          .firstWhere(
            (edge) => edge['from'] == 'N-0000' && edge['to'] == 'N-0001',
          );
      edge['geometry'] = [
        {'lat': 0, 'lng': 0},
        {'lat': .0002, 'lng': .0005},
        {'lat': 0, 'lng': .001},
      ];
      final graph = Graph.fromJson(json);
      final world = WorldSnapshot.fromJson(worldJson());
      expect(
        routeGeometry(graph, world.survivors.first).map((point) => point.lat),
        [0, .0002, 0],
      );
      expect(routeWarnings(graph, world, world.survivors.first), isEmpty);
      final threatened = worldJson();
      threatened['zombies'] = [
        {
          'id': 'visible-runner',
          'type': 'runner',
          'current_node': 'N-0001',
          'movement_state': 'resting',
          'awake': true,
          'path': ['N-0001'],
        },
      ];
      expect(
        routeWarnings(
          graph,
          WorldSnapshot.fromJson(threatened),
          world.survivors.first,
        ),
        isNotEmpty,
      );
    },
  );

  testWidgets(
    'static map symbols preserve statuses and observation data at narrow width',
    (tester) async {
      final graph = Graph.fromJson(
        jsonDecode(
              File(
                '../../packages/contracts/examples/graph.json',
              ).readAsStringSync(),
            )
            as Map<String, dynamic>,
      );
      final data = worldJson();
      (data['survivors'] as List).add({
        'id': 'S-bitten',
        'current_node': 'N-0001',
        'status': 'bitten',
        'target_shelter_id': '',
        'planned_route': <String>[],
      });
      data['zombies'] = [
        {
          'id': 'horde',
          'type': 'horde',
          'current_node': 'N-0000',
          'movement_state': 'resting',
          'awake': true,
          'path': <String>['N-0000'],
        },
      ];
      final world = WorldSnapshot.fromJson(data);
      final before = jsonEncode(data);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SizedBox(
              width: 280,
              child: RouteMap(
                graph: graph,
                world: world,
                survivor: world.survivors.first,
              ),
            ),
          ),
        ),
      );
      await tester.pump();
      expect(tester.takeException(), isNull);
      expect(find.byType(RouteMap), findsOneWidget);
      expect(jsonEncode(data), before);
      await tester.pumpWidget(const SizedBox.shrink());
      expect(tester.binding.transientCallbackCount, 0);
    },
  );

  test('world repository rejects inconsistent reservations', () async {
    final invalid = worldJson();
    final shelters = invalid['shelters'] as List;
    shelters.first['reserved'] = 999;
    shelters.first['available'] = 0;
    final dio = Dio();
    addTearDown(() => dio.close(force: true));
    dio.httpClientAdapter = _Adapter(
      (request) => ResponseBody.fromString(
        jsonEncode(invalid),
        200,
        headers: {
          Headers.contentTypeHeader: ['application/json'],
        },
      ),
    );
    await expectLater(
      HttpWorldRepository(dio).state(),
      throwsA(
        isA<ApiFailure>().having(
          (failure) => failure.code,
          'code',
          'INVALID_RESPONSE',
        ),
      ),
    );
  });
}
