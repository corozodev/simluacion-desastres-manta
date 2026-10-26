import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'api/demo_repository.dart';
import 'api/dio_client.dart';
import 'api/generated/models.dart';
import 'api/world_repository.dart';
import 'config/api_config.dart';

final apiConfigProvider = Provider<ApiConfig>(
  (ref) => ApiConfig.fromEnvironment(),
);

final repositoryProvider = Provider<DemoRepository>((ref) {
  final dio = createDio(ref.watch(apiConfigProvider));
  ref.onDispose(() => dio.close(force: true));
  return HttpDemoRepository(dio);
});

final healthProvider = FutureProvider<HealthResponse>(
  (ref) => ref.watch(repositoryProvider).health(),
  retry: (count, error) => null,
);

typedef ItemsQuery = ({int page, String q});

final itemsProvider = FutureProvider.autoDispose
    .family<ItemListResponse, ItemsQuery>(
      (ref, query) =>
          ref.watch(repositoryProvider).items(page: query.page, q: query.q),
      retry: (count, error) => null,
    );

final itemProvider = FutureProvider.autoDispose.family<DemoItem, String>(
  (ref, id) => ref.watch(repositoryProvider).item(id),
  retry: (count, error) => null,
);

// Observation URLs are public configuration. Movement credentials never enter a client.
final worldApiConfigProvider = Provider<ApiConfig>((ref) {
  final demo = ref.watch(apiConfigProvider);
  const url = String.fromEnvironment('WORLD_API_BASE_URL');
  return ApiConfig(
    baseUrl: url.isEmpty ? demo.baseUrl : url,
    mode: demo.mode,
    timeout: demo.timeout,
  );
});

final worldRepositoryProvider = Provider<WorldRepository>((ref) {
  final dio = createDio(ref.watch(worldApiConfigProvider));
  ref.onDispose(() => dio.close(force: true));
  return HttpWorldRepository(dio);
});

final worldProvider = FutureProvider.autoDispose<WorldSnapshot>((ref) {
  final timer = Timer(const Duration(seconds: 2), ref.invalidateSelf);
  ref.onDispose(timer.cancel);
  return ref.watch(worldRepositoryProvider).state();
}, retry: (count, error) => null);

final worldGraphProvider = FutureProvider.autoDispose<Graph>(
  (ref) => ref.watch(worldRepositoryProvider).graph(),
  retry: (count, error) => null,
);

final survivorProvider = FutureProvider.autoDispose.family<Survivor, String>(
  (ref, id) => ref.watch(worldRepositoryProvider).survivor(id),
  retry: (count, error) => null,
);
