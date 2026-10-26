import 'package:corodev_spooky/core/api/api_failure.dart';
import 'package:corodev_spooky/core/api/demo_repository.dart';
import 'package:corodev_spooky/core/api/dio_client.dart';
import 'package:corodev_spooky/core/api/generated/models.dart';
import 'package:corodev_spooky/core/config/api_config.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const enabled = bool.fromEnvironment('RUN_HTTP_TESTS');
  test(
    'Dart repository consumes the actual shared mock HTTP contract',
    () async {
      final dio = createDio(
        ApiConfig(
          baseUrl: const String.fromEnvironment(
            'API_BASE_URL',
            defaultValue: 'http://localhost:3001',
          ),
        ),
      );
      addTearDown(() => dio.close(force: true));
      final repository = HttpDemoRepository(dio);
      final health = await repository.health();
      expect(health.status, 'ok');
      expect(health.service, 'corodev-mock-api');
      final first = await repository.items(pageSize: 5);
      final second = await repository.items(page: 2, pageSize: 5);
      expect(first.pagination.total, greaterThanOrEqualTo(12));
      expect(first.data, hasLength(5));
      expect(second.pagination.page, 2);
      expect(
        first.data
            .map((item) => item.id)
            .toSet()
            .intersection(second.data.map((item) => item.id).toSet()),
        isEmpty,
      );
      final item = await repository.item(first.data.first.id);
      expect(item.title, first.data.first.title);
      final search = await repository.items(q: item.title);
      expect(search.data.map((entry) => entry.id), contains(item.id));
      final empty = await repository.items(
        q: '__no_match_mobile_integration__',
      );
      expect(empty.data, isEmpty);
      await expectLater(
        repository.item('item-does-not-exist'),
        throwsA(
          isA<ApiFailure>()
              .having((error) => error.code, 'code', 'NOT_FOUND')
              .having((error) => error.requestId, 'requestId', isNotEmpty),
        ),
      );
      await expectLater(
        repository.submit(const SubmitRequest(title: '')),
        throwsA(
          isA<ApiFailure>()
              .having((error) => error.code, 'code', 'VALIDATION_ERROR')
              .having((error) => error.requestId, 'requestId', isNotEmpty),
        ),
      );
      final confirmation = await repository.submit(
        const SubmitRequest(
          title: 'Flutter HTTP integration',
          description: 'Datos de prueba.',
        ),
      );
      expect(confirmation.submissionId, isNotEmpty);
      expect(confirmation.status, 'accepted');
    },
    skip: !enabled
        ? 'Requiere API local y --dart-define=RUN_HTTP_TESTS=true'
        : false,
  );
}
