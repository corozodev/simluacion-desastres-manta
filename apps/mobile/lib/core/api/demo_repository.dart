import 'package:dio/dio.dart';

import 'http_request.dart';
import 'generated/models.dart';

abstract interface class DemoRepository {
  Future<HealthResponse> health();
  Future<ItemListResponse> items({
    int page = 1,
    int pageSize = 6,
    String q = '',
  });
  Future<DemoItem> item(String id);
  Future<SubmitResponse> submit(SubmitRequest request);
}

class HttpDemoRepository implements DemoRepository {
  const HttpDemoRepository(this.dio);
  final Dio dio;

  @override
  Future<HealthResponse> health() =>
      requestJson(() => dio.get('health'), HealthResponse.fromJson);

  @override
  Future<ItemListResponse> items({
    int page = 1,
    int pageSize = 6,
    String q = '',
  }) => requestJson(
    () => dio.get(
      'v1/demo/items',
      queryParameters: {
        'page': page,
        'pageSize': pageSize,
        if (q.trim().isNotEmpty) 'q': q.trim(),
      },
    ),
    ItemListResponse.fromJson,
  );

  @override
  Future<DemoItem> item(String id) => requestJson(
    () => dio.get('v1/demo/items/${Uri.encodeComponent(id)}'),
    DemoItem.fromJson,
  );

  @override
  Future<SubmitResponse> submit(SubmitRequest request) => requestJson(
    () => dio.post('v1/demo/submit', data: request.toJson()),
    SubmitResponse.fromJson,
  );
}
