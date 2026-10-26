import 'package:dio/dio.dart';

import 'api_failure.dart';
import 'generated/models.dart';

Future<T> requestJson<T>(
  Future<Response<dynamic>> Function() call,
  T Function(Map<String, dynamic>) parse,
) async {
  try {
    final response = await call();
    return parse(Map<String, dynamic>.from(response.data as Map));
  } on DioException catch (error) {
    final data = error.response?.data;
    if (data is Map) {
      try {
        final envelope = ErrorResponse.fromJson(
          Map<String, dynamic>.from(data),
        ).error;
        throw ApiFailure(
          code: envelope.code,
          message: envelope.message,
          requestId: envelope.requestId,
          details: {
            for (final detail in envelope.details) detail.field: detail.message,
          },
        );
      } on ApiFailure {
        rethrow;
      } catch (_) {
        // Translate an unrecognized upstream envelope into a client error.
      }
    }
    final timeout = const [
      DioExceptionType.connectionTimeout,
      DioExceptionType.receiveTimeout,
      DioExceptionType.sendTimeout,
    ].contains(error.type);
    final httpError = error.response != null;
    throw ApiFailure(
      code: timeout
          ? 'TIMEOUT'
          : httpError
          ? 'HTTP_ERROR'
          : 'BACKEND_UNAVAILABLE',
      message: timeout
          ? 'La API tardó demasiado. Intenta de nuevo.'
          : httpError
          ? 'La API devolvió un error HTTP (${error.response!.statusCode}).'
          : 'No se pudo conectar con la API. Revisa la conexión y la URL.',
      requestId: error.response?.headers.value('x-request-id'),
    );
  } on ApiFailure {
    rethrow;
  } catch (_) {
    throw const ApiFailure(
      code: 'INVALID_RESPONSE',
      message: 'La respuesta de la API no coincide con el contrato.',
    );
  }
}
