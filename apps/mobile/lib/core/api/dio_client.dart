import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import '../config/api_config.dart';

Dio createDio(ApiConfig config) {
  final dio = Dio(
    BaseOptions(
      // A trailing slash preserves API Gateway stage prefixes.
      baseUrl: '${config.baseUrl.replaceFirst(RegExp(r'/+$'), '')}/',
      connectTimeout: config.timeout,
      receiveTimeout: config.timeout,
      sendTimeout: config.timeout,
      headers: {'Accept': 'application/json'},
    ),
  );
  if (kDebugMode) {
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          options.extra['startedAt'] = DateTime.now().millisecondsSinceEpoch;
          handler.next(options);
        },
        onResponse: (response, handler) {
          _log(response.requestOptions, response.statusCode);
          handler.next(response);
        },
        onError: (error, handler) {
          _log(error.requestOptions, error.response?.statusCode);
          handler.next(error);
        },
      ),
    );
  }
  return dio;
}

void _log(RequestOptions options, int? status) {
  final started = options.extra['startedAt'] as int?;
  final elapsed = started == null
      ? 0
      : DateTime.now().millisecondsSinceEpoch - started;
  debugPrint(
    '[API] ${options.method} ${status ?? 'network-error'} ${elapsed}ms',
  );
}
