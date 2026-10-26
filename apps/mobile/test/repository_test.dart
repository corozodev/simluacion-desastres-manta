import 'dart:typed_data';

import 'package:corodev_spooky/core/api/api_failure.dart';
import 'package:corodev_spooky/core/api/demo_repository.dart';
import 'package:corodev_spooky/core/api/dio_client.dart';
import 'package:corodev_spooky/core/config/api_config.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

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

void main() {
  test('configuration rejects credentials, query secrets and invalid mode', () {
    for (final url in [
      'https://user:secret@example.com',
      'https://example.com?token=secret',
      'https://example.com#secret',
      'file:///tmp/api',
    ]) {
      expect(() => ApiConfig(baseUrl: url), throwsArgumentError);
    }
    expect(
      () => ApiConfig(baseUrl: 'https://example.com', mode: 'unknown'),
      throwsArgumentError,
    );
    final config = ApiConfig(baseUrl: 'https://example.com/stage');
    expect(config.displayUrl, 'https://example.com/stage');
  });

  test('repository preserves API Gateway stage path', () async {
    final dio = createDio(ApiConfig(baseUrl: 'https://api.example.com/dev'));
    addTearDown(() => dio.close());
    dio.httpClientAdapter = _Adapter((request) {
      expect(request.uri.toString(), 'https://api.example.com/dev/health');
      return ResponseBody.fromString(
        '{"status":"ok","service":"test","version":"0.1.0"}',
        200,
        headers: {
          Headers.contentTypeHeader: ['application/json'],
        },
      );
    });
    expect((await HttpDemoRepository(dio).health()).status, 'ok');
  });

  test(
    'structured errors preserve code, field messages and request ID',
    () async {
      final dio = Dio();
      addTearDown(() => dio.close());
      dio.httpClientAdapter = _Adapter(
        (request) => ResponseBody.fromString(
          '{"error":{"code":"VALIDATION_ERROR","message":"Invalid title",'
          '"requestId":"req-field","details":[{"field":"title","message":"Required"}]}}',
          400,
          headers: {
            Headers.contentTypeHeader: ['application/json'],
          },
        ),
      );
      await expectLater(
        HttpDemoRepository(dio).health(),
        throwsA(
          isA<ApiFailure>()
              .having((error) => error.code, 'code', 'VALIDATION_ERROR')
              .having((error) => error.requestId, 'requestId', 'req-field')
              .having(
                (error) => error.details['title'],
                'field error',
                'Required',
              ),
        ),
      );
    },
  );

  for (final (type, code) in [
    (DioExceptionType.receiveTimeout, 'TIMEOUT'),
    (DioExceptionType.connectionError, 'BACKEND_UNAVAILABLE'),
  ]) {
    test('$type maps to $code', () async {
      final dio = Dio();
      addTearDown(() => dio.close());
      dio.httpClientAdapter = _Adapter((options) {
        throw DioException(requestOptions: options, type: type);
      });
      await expectLater(
        HttpDemoRepository(dio).health(),
        throwsA(isA<ApiFailure>().having((error) => error.code, 'code', code)),
      );
    });
  }

  test('unstructured HTTP errors remain HTTP errors', () async {
    final dio = Dio();
    addTearDown(() => dio.close());
    dio.httpClientAdapter = _Adapter(
      (request) => ResponseBody.fromString('upstream error', 502),
    );
    await expectLater(
      HttpDemoRepository(dio).health(),
      throwsA(
        isA<ApiFailure>().having((error) => error.code, 'code', 'HTTP_ERROR'),
      ),
    );
  });

  test('unexpected response has a controlled invalid-response error', () async {
    final dio = Dio();
    addTearDown(() => dio.close());
    dio.httpClientAdapter = _Adapter(
      (request) => ResponseBody.fromString(
        '{"unexpected":true}',
        200,
        headers: {
          Headers.contentTypeHeader: ['application/json'],
        },
      ),
    );
    await expectLater(
      HttpDemoRepository(dio).health(),
      throwsA(
        isA<ApiFailure>().having(
          (error) => error.code,
          'code',
          'INVALID_RESPONSE',
        ),
      ),
    );
  });
}
