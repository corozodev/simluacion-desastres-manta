import 'dart:async';

import 'package:corodev_spooky/app/app.dart';
import 'package:corodev_spooky/core/api/api_failure.dart';
import 'package:corodev_spooky/core/api/generated/models.dart';
import 'package:corodev_spooky/core/config/api_config.dart';
import 'package:corodev_spooky/core/providers.dart';
import 'package:corodev_spooky/core/theme/app_theme.dart';
import 'package:corodev_spooky/core/theme/brand.g.dart';
import 'package:corodev_spooky/core/theme/tokens.g.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fake_repository.dart';

Future<void> openApp(
  WidgetTester tester,
  FakeRepository repository, {
  String location = '/',
}) async {
  tester.view.physicalSize = const Size(430, 932);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final router = createRouter(initialLocation: location);
  addTearDown(router.dispose);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        repositoryProvider.overrideWithValue(repository),
        apiConfigProvider.overrideWithValue(
          ApiConfig(baseUrl: 'http://localhost:3001'),
        ),
      ],
      child: SpookyApp(router: router),
    ),
  );
  await tester.pump();
}

void main() {
  test('theme uses shared colors and Material 3', () {
    final theme = buildSpookyTheme();
    expect(theme.useMaterial3, isTrue);
    expect(theme.brightness, Brightness.dark);
    expect(theme.colorScheme.primary, SpookyTokens.primary);
    expect(theme.scaffoldBackgroundColor, SpookyTokens.background);
  });

  testWidgets('home renders shell, overview and real repository count', (
    tester,
  ) async {
    await openApp(tester, FakeRepository());
    await tester.pumpAndSettle();
    expect(find.text(AppBrand.team), findsOneWidget);
    expect(find.text(AppBrand.overviewTitle), findsOneWidget);
    expect(find.byType(NavigationBar), findsOneWidget);
    expect(find.text('1'), findsOneWidget);
    expect(find.text('Registro de prueba'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('pending repository shows loading state', (tester) async {
    final repository = FakeRepository()
      ..pendingItems = Completer<ItemListResponse>();
    await openApp(tester, repository, location: '/items');
    expect(find.text('Cargando datos…'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('items navigate to detail and show fixture date label', (
    tester,
  ) async {
    await openApp(tester, FakeRepository(), location: '/items');
    await tester.pumpAndSettle();
    expect(find.text('1 registros · Página 1 de 1'), findsOneWidget);
    await tester.tap(find.text(testItem.title));
    await tester.pumpAndSettle();
    expect(find.text('Detalle del elemento'), findsOneWidget);
    expect(find.text('FECHA DE EJEMPLO'), findsOneWidget);
    expect(find.text(testItem.createdAt), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('search shows an empty result', (tester) async {
    await openApp(tester, FakeRepository(), location: '/items');
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const Key('items-search')),
      'sin coincidencia',
    );
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pumpAndSettle();
    expect(find.text('Sin resultados'), findsOneWidget);
    expect(find.text(testItem.title), findsNothing);
  });

  testWidgets('error preserves request id and retries repository', (
    tester,
  ) async {
    final repository = FakeRepository()
      ..listError = const ApiFailure(
        code: 'BACKEND_UNAVAILABLE',
        message: 'API no disponible',
        requestId: 'req-test-123',
      );
    await openApp(tester, repository, location: '/items');
    await tester.pumpAndSettle();
    expect(find.text('API no disponible'), findsOneWidget);
    expect(find.text('Request ID: req-test-123'), findsOneWidget);
    repository.listError = null;
    await tester.tap(find.text('Reintentar'));
    await tester.pumpAndSettle();
    expect(find.text(testItem.title), findsOneWidget);
    expect(repository.listCalls, 2);
  });

  testWidgets('form validates title before sending', (tester) async {
    final repository = FakeRepository();
    await openApp(tester, repository, location: '/demo');
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('demo-submit')));
    await tester.pumpAndSettle();
    expect(find.text('Escribe un título.'), findsOneWidget);
    expect(repository.submitCalls, 0);
  });

  testWidgets('form prevents duplicate sends and confirms result', (
    tester,
  ) async {
    final repository = FakeRepository()
      ..pendingSubmit = Completer<SubmitResponse>();
    await openApp(tester, repository, location: '/demo');
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('demo-title')), '  Prueba  ');
    await tester.tap(find.byKey(const Key('demo-submit')));
    await tester.pump();
    final button = tester.widget<FilledButton>(
      find.byKey(const Key('demo-submit')),
    );
    expect(button.onPressed, isNull);
    await tester.tap(find.byKey(const Key('demo-submit')));
    expect(repository.submitCalls, 1);
    expect(repository.lastSubmission!.title, 'Prueba');
    repository.pendingSubmit!.complete(
      const SubmitResponse(
        submissionId: 'submission-actual',
        status: 'accepted',
        message: 'Recibido por la API.',
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Envío confirmado'), findsOneWidget);
    expect(find.text('ID: submission-actual'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('diagnostics shows effective URL and API versions', (
    tester,
  ) async {
    await openApp(tester, FakeRepository(), location: '/diagnostics');
    await tester.pumpAndSettle();
    expect(find.text('API conectada'), findsOneWidget);
    expect(find.text('http://localhost:3001'), findsOneWidget);
    expect(find.text('0.1.0'), findsNWidgets(2));
    expect(tester.takeException(), isNull);
  });
}
