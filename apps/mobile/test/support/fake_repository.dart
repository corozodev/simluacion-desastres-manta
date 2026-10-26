import 'dart:async';

import 'package:corodev_spooky/core/api/demo_repository.dart';
import 'package:corodev_spooky/core/api/generated/models.dart';

const testItem = DemoItem(
  id: 'item-001',
  title: 'Registro de prueba',
  description: 'Descripción de demostración.',
  status: 'active',
  createdAt: '2026-10-27T12:00:00Z',
);

class FakeRepository implements DemoRepository {
  Object? listError;
  Completer<ItemListResponse>? pendingItems;
  Completer<SubmitResponse>? pendingSubmit;
  int submitCalls = 0;
  int listCalls = 0;
  SubmitRequest? lastSubmission;

  @override
  Future<HealthResponse> health() async => const HealthResponse(
    status: 'ok',
    service: 'corodev-mock-api',
    version: '0.1.0',
  );

  @override
  Future<ItemListResponse> items({
    int page = 1,
    int pageSize = 6,
    String q = '',
  }) async {
    listCalls++;
    if (listError case final error?) throw error;
    if (pendingItems case final pending?) return pending.future;
    final matches = q.isEmpty || testItem.title.contains(q);
    return ItemListResponse(
      data: matches ? [testItem] : [],
      pagination: Pagination(
        page: page,
        pageSize: pageSize,
        total: matches ? 1 : 0,
      ),
    );
  }

  @override
  Future<DemoItem> item(String id) async => testItem;

  @override
  Future<SubmitResponse> submit(SubmitRequest request) async {
    submitCalls++;
    lastSubmission = request;
    return pendingSubmit?.future ??
        const SubmitResponse(
          submissionId: 'submission-001',
          status: 'accepted',
          message: 'Datos de prueba recibidos.',
        );
  }
}
