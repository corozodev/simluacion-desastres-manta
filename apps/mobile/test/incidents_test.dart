import 'dart:async';
import 'dart:convert';

import 'package:corodev_spooky/core/api/api_failure.dart';
import 'package:corodev_spooky/core/api/dio_client.dart';
import 'package:corodev_spooky/core/api/generated/models.dart';
import 'package:corodev_spooky/core/api/incident_repository.dart';
import 'package:corodev_spooky/core/config/api_config.dart';
import 'package:corodev_spooky/core/location/device_location.dart';
import 'package:corodev_spooky/features/escape/route_map.dart';
import 'package:corodev_spooky/features/incidents/incident_draft.dart';
import 'package:corodev_spooky/features/incidents/incident_report_screen.dart';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

const _info = IncidentServiceInfo(
  enabled: true,
  schemaVersion: 1,
  bounds: IncidentBounds(
    minLatitude: -1.1,
    maxLatitude: -0.8,
    minLongitude: -80.9,
    maxLongitude: -80.6,
  ),
  maxDescriptionLength: 500,
  maxSnapDistanceM: 50,
  verificationNotice: 'Reporte ciudadano pendiente de verificación',
  photoUploadsEnabled: false,
);
const _edge = IncidentEdgeMatch(
  edgeId: 'test-edge',
  roadType: 'residential',
  distanceM: 2,
  fromNodeId: 'test-a',
  toNodeId: 'test-b',
  latitude: -0.95,
  longitude: -80.73,
);
const _graph = Graph(
  version: 'synthetic-test-only',
  source: 'Synthetic fixture only for Flutter tests',
  nodes: [
    GraphNode(id: 'test-a', lat: -0.955, lng: -80.735),
    GraphNode(id: 'test-b', lat: -0.945, lng: -80.725),
  ],
  edges: [
    GraphEdge(
      id: 'test-edge',
      from: 'test-a',
      to: 'test-b',
      distanceM: 100,
      roadType: 'residential',
      speedMps: 1,
      blocked: false,
      directed: false,
    ),
  ],
  shelters: [],
);

Incident _report(IncidentCreate body) => Incident(
  schemaVersion: 1,
  incidentId: 'incident-test-only',
  incidentType: body.incidentType,
  latitude: body.latitude,
  longitude: body.longitude,
  description: body.description,
  severityReported: body.severityReported,
  roadPassabilityReported: body.roadPassabilityReported,
  eventTime: body.eventTime,
  receivedAt: '2026-10-26T15:00:00Z',
  sourceType: 'citizen',
  verificationStatus: 'pending',
  evidenceMetadata: const IncidentEvidenceMetadata(
    attachmentCount: 0,
    storageStatus: 'not_supported',
  ),
  affectedEdgeIds: ['test-edge'],
  graphVersion: 'synthetic-test-only',
  snapDistanceM: 2,
  locationMethod: body.locationMethod,
  locationPrecisionM: 20,
  expiresAt: '2026-10-27T15:00:00Z',
  updatedAt: '2026-10-26T15:00:00Z',
);

class _Repository implements IncidentRepository {
  bool ambiguous = false;
  Object? nextError;
  Completer<Incident>? pending;
  final bodies = <IncidentCreate>[];
  final keys = <String>[];
  final locations = <IncidentLocation>[];
  Incident? saved;

  @override
  Future<IncidentServiceInfo> config() async => _info;

  @override
  Future<IncidentResolution> resolve(IncidentLocation location) async {
    locations.add(location);
    final needsChoice = ambiguous && location.edgeIdHint == null;
    return IncidentResolution(
      matched: !needsChoice,
      ambiguous: needsChoice,
      candidates: [_edge],
      message: needsChoice
          ? 'Selecciona una calle cercana.'
          : 'Calle asociada.',
      graphVersion: 'synthetic-test-only',
      maxSnapDistanceM: 50,
    );
  }

  @override
  Future<Incident> create(IncidentCreate body, String key) async {
    bodies.add(body);
    keys.add(key);
    final error = nextError;
    nextError = null;
    if (error != null) throw error;
    saved = _report(body);
    if (pending != null) return pending!.future;
    return saved!;
  }

  @override
  Future<Incident> detail(String id) async => saved!;

  @override
  Future<IncidentList> list({String? receivedAfter}) async => IncidentList(
    incidents: [?saved],
    total: saved == null ? 0 : 1,
    limit: 100,
    offset: 0,
    hasMore: false,
  );
}

class _DeniedLocation implements DeviceLocation {
  @override
  Future<DevicePosition> current() async => throw PlatformException(
    code: 'PERMISSION_DENIED',
    message: 'Permiso denegado. Puedes usar el marcador manual.',
  );
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

void _fill(IncidentDraftController controller) => controller.edit(
  latitude: '-0.95',
  longitude: '-80.73',
  incidentType: 'road_closed',
  passability: 'blocked',
  severity: 'moderate',
  description: 'Calle cerrada observada para una prueba académica.',
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'HTTP adapter preserves stage path, generated body and idempotency key',
    () async {
      const body = IncidentCreate(
        incidentType: 'road_closed',
        latitude: -0.95,
        longitude: -80.73,
        description: 'Prueba HTTP de calle cerrada.',
        severityReported: 'moderate',
        roadPassabilityReported: 'blocked',
        eventTime: '2026-10-26T14:00:00Z',
        locationMethod: 'manual',
        edgeIdHint: 'test-edge',
      );
      final dio = createDio(ApiConfig(baseUrl: 'https://example.com/stage'));
      addTearDown(() => dio.close(force: true));
      dio.httpClientAdapter = _Adapter((request) {
        expect(request.uri.path, '/stage/v1/incidents');
        expect(request.headers['Idempotency-Key'], '1234567890abcdef');
        expect(request.headers.containsKey('x-api-key'), isFalse);
        expect(request.headers.containsKey('Authorization'), isFalse);
        expect(request.data, body.toJson());
        return ResponseBody.fromString(
          jsonEncode(_report(body).toJson()),
          201,
          headers: {
            Headers.contentTypeHeader: ['application/json'],
          },
        );
      });
      final report = await HttpIncidentRepository(
        dio,
      ).create(body, '1234567890abcdef');
      expect(report.verificationStatus, 'pending');
      expect(report.sourceType, 'citizen');
    },
  );

  test('config, resolution and errors retain the shared contract', () async {
    final dio = createDio(ApiConfig(baseUrl: 'https://example.com/stage'));
    addTearDown(() => dio.close(force: true));
    dio.httpClientAdapter = _Adapter((request) {
      if (request.uri.path.endsWith('/config')) {
        return ResponseBody.fromString(
          jsonEncode(_info.toJson()),
          200,
          headers: {
            Headers.contentTypeHeader: ['application/json'],
          },
        );
      }
      return ResponseBody.fromString(
        '{"error":{"code":"VALIDATION_ERROR","message":"Fuera de cobertura",'
        '"requestId":"incident-request","details":[{"field":"latitude","message":"Fuera de área"}]}}',
        400,
        headers: {
          Headers.contentTypeHeader: ['application/json'],
        },
      );
    });
    final repository = HttpIncidentRepository(dio);
    expect((await repository.config()).photoUploadsEnabled, isFalse);
    await expectLater(
      repository.resolve(const IncidentLocation(latitude: 0, longitude: 0)),
      throwsA(
        isA<ApiFailure>()
            .having((e) => e.code, 'code', 'VALIDATION_ERROR')
            .having((e) => e.requestId, 'request ID', 'incident-request')
            .having((e) => e.details['latitude'], 'field', 'Fuera de área'),
      ),
    );
  });

  test(
    'invalid coordinates and outside operating area cannot be reviewed',
    () async {
      final repository = _Repository();
      final container = ProviderContainer(
        overrides: [incidentRepositoryProvider.overrideWithValue(repository)],
      );
      addTearDown(container.dispose);
      final controller = container.read(incidentDraftProvider.notifier);
      _fill(controller);
      controller.edit(latitude: 'NaN');
      await controller.review();
      expect(
        container.read(incidentDraftProvider).stage,
        IncidentDraftStage.editing,
      );
      expect(container.read(incidentDraftProvider).error, isNotNull);
      controller.edit(latitude: '40');
      await controller.review();
      expect(repository.locations, isEmpty);
      expect(repository.bodies, isEmpty);
      expect(container.read(incidentDraftProvider).error, isA<ApiFailure>());
    },
  );

  test(
    'ambiguous street requires explicit valid selection before review',
    () async {
      final repository = _Repository()..ambiguous = true;
      final container = ProviderContainer(
        overrides: [incidentRepositoryProvider.overrideWithValue(repository)],
      );
      addTearDown(container.dispose);
      final controller = container.read(incidentDraftProvider.notifier);
      _fill(controller);
      await controller.review();
      expect(
        container.read(incidentDraftProvider).resolution!.ambiguous,
        isTrue,
      );
      expect(
        container.read(incidentDraftProvider).stage,
        IncidentDraftStage.editing,
      );
      controller.chooseEdge('not-a-candidate');
      expect(container.read(incidentDraftProvider).edgeHint, isNull);
      controller.chooseEdge('test-edge');
      await controller.review();
      expect(repository.locations.last.edgeIdHint, 'test-edge');
      expect(
        container.read(incidentDraftProvider).stage,
        IncidentDraftStage.review,
      );
    },
  );

  test(
    'uncertain network failure retries exact payload/key and never auto sends',
    () async {
      final repository = _Repository()
        ..nextError = const ApiFailure(
          code: 'TIMEOUT',
          message: 'Sin confirmación',
        );
      final container = ProviderContainer(
        overrides: [incidentRepositoryProvider.overrideWithValue(repository)],
      );
      addTearDown(container.dispose);
      final controller = container.read(incidentDraftProvider.notifier);
      _fill(controller);
      await controller.review();
      expect(repository.bodies, isEmpty);
      await controller.send();
      expect(
        container.read(incidentDraftProvider).stage,
        IncidentDraftStage.error,
      );
      controller.edit(description: 'This uncertain attempt must not change');
      await controller.send();
      expect(repository.bodies, hasLength(2));
      expect(identical(repository.bodies[0], repository.bodies[1]), isTrue);
      expect(repository.keys[0], repository.keys[1]);
      expect(repository.keys[0], matches(RegExp(r'^[a-f0-9]{48}$')));
      expect(
        container.read(incidentDraftProvider).report!.verificationStatus,
        'pending',
      );
    },
  );

  test(
    'sending guard prevents double tap and confirmed validation permits correction',
    () async {
      final repository = _Repository()..pending = Completer<Incident>();
      final container = ProviderContainer(
        overrides: [incidentRepositoryProvider.overrideWithValue(repository)],
      );
      addTearDown(container.dispose);
      final controller = container.read(incidentDraftProvider.notifier);
      _fill(controller);
      await controller.review();
      final pending = controller.send();
      await controller.send();
      expect(repository.bodies, hasLength(1));
      repository.pending!.complete(repository.saved!);
      await pending;
      controller.newReport();
      _fill(controller);
      repository.pending = null;
      repository.nextError = const ApiFailure(
        code: 'VALIDATION_ERROR',
        message: 'Corrige la descripción',
      );
      await controller.review();
      await controller.send();
      expect(container.read(incidentDraftProvider).editable, isTrue);
      expect(container.read(incidentDraftProvider).idempotencyKey, isNull);
      controller.edit(
        description: 'Descripción corregida tras rechazo de validación.',
      );
      expect(
        container.read(incidentDraftProvider).description,
        contains('corregida'),
      );
    },
  );

  test('map inverse projection preserves geographic marker coordinates', () {
    final projection = MapProjection.forGraph(_graph, const Size(390, 230))!;
    const point = GeoPoint(lat: -0.95, lng: -80.73);
    final roundtrip = projection.unproject(projection.project(point));
    expect(roundtrip.lat, closeTo(point.lat, 1e-10));
    expect(roundtrip.lng, closeTo(point.lng, 1e-10));
  });

  test(
    'Android channel accepts approximate fix and preserves permission denial',
    () async {
      debugDefaultTargetPlatformOverride = TargetPlatform.android;
      addTearDown(() => debugDefaultTargetPlatformOverride = null);
      final messenger =
          TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
      addTearDown(
        () => messenger.setMockMethodCallHandler(
          AndroidDeviceLocation.channel,
          null,
        ),
      );
      messenger.setMockMethodCallHandler(AndroidDeviceLocation.channel, (
        call,
      ) async {
        expect(call.method, 'current');
        return {
          'latitude': -0.95,
          'longitude': -80.73,
          'accuracy_m': 1800.0,
          'measured_at': 1793026800000,
        };
      });
      expect((await const AndroidDeviceLocation().current()).accuracyM, 1800);
      messenger.setMockMethodCallHandler(AndroidDeviceLocation.channel, (
        _,
      ) async {
        throw PlatformException(
          code: 'PERMISSION_DENIED',
          message: 'Permiso denegado',
        );
      });
      await expectLater(
        const AndroidDeviceLocation().current(),
        throwsA(
          isA<PlatformException>().having(
            (e) => e.code,
            'code',
            'PERMISSION_DENIED',
          ),
        ),
      );
    },
  );

  testWidgets(
    'manual marker, denied GPS, review, network retry and pending status',
    (tester) async {
      tester.view.physicalSize = const Size(430, 2200);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final repository = _Repository()
        ..nextError = const ApiFailure(
          code: 'BACKEND_UNAVAILABLE',
          message: 'Sin conexión',
        );
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            incidentRepositoryProvider.overrideWithValue(repository),
            deviceLocationProvider.overrideWithValue(_DeniedLocation()),
          ],
          child: const MaterialApp(home: IncidentReportScreen(graph: _graph)),
        ),
      );
      await tester.tap(find.byKey(const Key('incident-device-location')));
      await tester.pumpAndSettle();
      expect(
        find.text('Permiso denegado. Puedes usar el marcador manual.'),
        findsOneWidget,
      );
      await tester.tap(find.byKey(const Key('incident-location-map')));
      await tester.enterText(
        find.byKey(const Key('incident-description')),
        'Calle cerrada de prueba sin datos personales.',
      );
      await tester.ensureVisible(find.byKey(const Key('incident-review')));
      await tester.tap(find.byKey(const Key('incident-review')));
      await tester.pumpAndSettle();
      expect(repository.bodies, isEmpty);
      expect(
        find.text('Revisa la información antes de confirmar.'),
        findsOneWidget,
      );
      await tester.tap(find.byKey(const Key('incident-confirm')));
      await tester.pumpAndSettle();
      expect(find.text('Sin conexión'), findsOneWidget);
      expect(
        find.text('Calle cerrada de prueba sin datos personales.'),
        findsOneWidget,
      );
      await tester.tap(find.byKey(const Key('incident-retry')));
      await tester.pumpAndSettle();
      expect(repository.keys[0], repository.keys[1]);
      expect(find.text('Enviado'), findsOneWidget);
      expect(
        find.text('Reporte ciudadano pendiente de verificación'),
        findsOneWidget,
      );
      expect(find.text('Estado: Pendiente de verificación'), findsOneWidget);
      expect(find.text('Procedencia: ciudadana'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('closing and reopening the form retains the session draft', (
    tester,
  ) async {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    Widget app(Widget home) => UncontrolledProviderScope(
      container: container,
      child: MaterialApp(home: home),
    );
    await tester.pumpWidget(app(const IncidentReportScreen()));
    await tester.ensureVisible(find.byKey(const Key('incident-description')));
    await tester.enterText(
      find.byKey(const Key('incident-description')),
      'Borrador guardado durante la sesión sin conexión.',
    );
    await tester.pumpWidget(app(const SizedBox()));
    await tester.pumpWidget(app(const IncidentReportScreen()));
    expect(
      tester
          .widget<TextField>(find.byKey(const Key('incident-description')))
          .controller!
          .text,
      'Borrador guardado durante la sesión sin conexión.',
    );
  });
}
