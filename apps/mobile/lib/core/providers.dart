import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'api/dio_client.dart';
import 'api/generated/models.dart';
import 'api/world_repository.dart';
import 'api/spectator_repository.dart';
import 'api/reference_repository.dart';
import 'config/api_config.dart';

final worldApiConfigProvider = Provider<ApiConfig>(
  (ref) => ApiConfig.fromEnvironment(),
);
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

final spectatorRepositoryProvider = Provider<SpectatorRepository>((ref) {
  final world = createDio(ref.watch(worldApiConfigProvider));
  final flood = createDio(ApiConfig.floodFromEnvironment());
  ref.onDispose(() {
    world.close(force: true);
    flood.close(force: true);
  });
  return HttpSpectatorRepository(world, flood);
});

final referenceRepositoryProvider = Provider<HttpReferenceRepository>((ref) {
  final dio = createDio(ApiConfig.floodFromEnvironment());
  ref.onDispose(() => dio.close(force: true));
  return HttpReferenceRepository(dio);
});
