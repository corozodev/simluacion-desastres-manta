import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../core/api/generated/models.dart';
import '../../core/api/spectator_repository.dart';

/// One serial observation loop; lifecycle resumes at the current snapshot.
class PublishedObserver extends ChangeNotifier {
  PublishedObserver(this.repository, this.scenario);
  final SpectatorRepository repository;
  final String scenario;
  PublishedView? view;
  Graph? graph;
  Object? error;
  DateTime? receivedAt;
  Timer? _timer;
  int _failures = 0, _epoch = 0;
  bool _enabled = false,
      _busy = false,
      _disposed = false,
      _refreshAgain = false;
  bool get loading => view == null && error == null;
  bool get stale => error != null || !_enabled;

  void setActive(bool enabled) {
    if (_disposed || _enabled == enabled) return;
    _enabled = enabled;
    _epoch++;
    _timer?.cancel();
    if (enabled) {
      if (_busy) {
        _refreshAgain = true;
      } else {
        unawaited(refresh());
      }
    }
    notifyListeners();
  }

  Future<void> refresh() async {
    if (_disposed || !_enabled || _busy) return;
    _timer?.cancel();
    _busy = true;
    final epoch = _epoch;
    try {
      final next = await repository.published(scenario);
      final nextGraph =
          graph?.version == next.graphVersion && next.graphVersion.isNotEmpty
          ? graph!
          : await repository.graph(next);
      if (_disposed || epoch != _epoch || !_enabled) return;
      if (view?.id == next.id && next.version < view!.version) return;
      view = next;
      graph = nextGraph;
      error = null;
      _failures = 0;
      receivedAt = DateTime.now();
    } catch (failure) {
      if (_disposed || epoch != _epoch || !_enabled) return;
      error = failure;
      _failures++;
    } finally {
      _busy = false;
      if (!_disposed && _enabled) {
        notifyListeners();
        if (_refreshAgain) {
          _refreshAgain = false;
          unawaited(refresh());
        } else {
          final seconds = _failures > 0
              ? (2 * (1 << _failures.clamp(0, 4))).clamp(2, 30)
              : view?.terminal == true || view?.active != true
              ? 15
              : 2;
          _timer = Timer(Duration(seconds: seconds), refresh);
        }
      }
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _epoch++;
    _timer?.cancel();
    super.dispose();
  }
}
