import 'dart:math';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_failure.dart';
import '../../core/api/dio_client.dart';
import '../../core/api/generated/models.dart';
import '../../core/api/incident_repository.dart';
import '../../core/config/api_config.dart';
import '../../core/location/device_location.dart';

final incidentApiConfigProvider = Provider<ApiConfig>(
  (ref) => ApiConfig.incidentsFromEnvironment(),
);
final incidentRepositoryProvider = Provider<IncidentRepository>((ref) {
  final dio = createDio(ref.watch(incidentApiConfigProvider));
  ref.onDispose(() => dio.close(force: true));
  return HttpIncidentRepository(dio);
});
final deviceLocationProvider = Provider<DeviceLocation>(
  (ref) => const AndroidDeviceLocation(),
);

enum IncidentDraftStage { editing, review, sending, error, sent }

class IncidentDraft {
  IncidentDraft({
    this.latitude = '',
    this.longitude = '',
    this.incidentType = 'flooded_road',
    this.severity = 'unknown',
    this.passability = 'unknown',
    this.description = '',
    DateTime? eventTime,
    this.locationMethod = 'manual',
    this.edgeHint,
    this.resolution,
    this.stage = IncidentDraftStage.editing,
    this.resolving = false,
    this.payload,
    this.idempotencyKey,
    this.report,
    this.error,
  }) : eventTime = eventTime ?? DateTime.now().toUtc();

  final String latitude;
  final String longitude;
  final String incidentType;
  final String severity;
  final String passability;
  final String description;
  final DateTime eventTime;
  final String locationMethod;
  final String? edgeHint;
  final IncidentResolution? resolution;
  final IncidentDraftStage stage;
  final bool resolving;
  final IncidentCreate? payload;
  final String? idempotencyKey;
  final Incident? report;
  final Object? error;

  bool get editable => stage == IncidentDraftStage.editing && !resolving;

  IncidentDraft copy({
    String? latitude,
    String? longitude,
    String? incidentType,
    String? severity,
    String? passability,
    String? description,
    DateTime? eventTime,
    String? locationMethod,
    String? edgeHint,
    IncidentResolution? resolution,
    IncidentDraftStage? stage,
    bool? resolving,
    IncidentCreate? payload,
    String? idempotencyKey,
    Incident? report,
    Object? error,
    bool clearLocationResolution = false,
    bool clearAttempt = false,
    bool clearError = false,
  }) => IncidentDraft(
    latitude: latitude ?? this.latitude,
    longitude: longitude ?? this.longitude,
    incidentType: incidentType ?? this.incidentType,
    severity: severity ?? this.severity,
    passability: passability ?? this.passability,
    description: description ?? this.description,
    eventTime: eventTime ?? this.eventTime,
    locationMethod: locationMethod ?? this.locationMethod,
    edgeHint: clearLocationResolution ? null : edgeHint ?? this.edgeHint,
    resolution: clearLocationResolution ? null : resolution ?? this.resolution,
    stage: stage ?? this.stage,
    resolving: resolving ?? this.resolving,
    payload: clearAttempt ? null : payload ?? this.payload,
    idempotencyKey: clearAttempt ? null : idempotencyKey ?? this.idempotencyKey,
    report: report ?? this.report,
    error: clearError ? null : error ?? this.error,
  );
}

// Intentionally lives for the application session, including closing the form.
// This is not a disk-backed offline queue.
final incidentDraftProvider =
    NotifierProvider<IncidentDraftController, IncidentDraft>(
      IncidentDraftController.new,
    );

class IncidentDraftController extends Notifier<IncidentDraft> {
  @override
  IncidentDraft build() => IncidentDraft();

  void edit({
    String? latitude,
    String? longitude,
    String? incidentType,
    String? severity,
    String? passability,
    String? description,
    DateTime? eventTime,
    String? locationMethod,
  }) {
    if (!state.editable) return;
    state = state.copy(
      latitude: latitude,
      longitude: longitude,
      incidentType: incidentType,
      severity: severity,
      passability: passability,
      description: description,
      eventTime: eventTime,
      locationMethod: locationMethod,
      clearLocationResolution:
          latitude != null || longitude != null || incidentType != null,
      clearAttempt: true,
      clearError: true,
    );
  }

  void chooseEdge(String id) {
    if (!state.editable ||
        state.resolution?.candidates.any((edge) => edge.edgeId == id) != true) {
      return;
    }
    state = state.copy(edgeHint: id, clearError: true);
  }

  void backToEditing() {
    if (state.stage != IncidentDraftStage.review) return;
    state = state.copy(
      stage: IncidentDraftStage.editing,
      clearAttempt: true,
      clearError: true,
    );
  }

  Future<void> review() async {
    if (!state.editable) return;
    final latitude = double.tryParse(state.latitude);
    final longitude = double.tryParse(state.longitude);
    final description = state.description.trim();
    if (latitude == null ||
        longitude == null ||
        !latitude.isFinite ||
        !longitude.isFinite ||
        latitude.abs() > 90 ||
        longitude.abs() > 180) {
      state = state.copy(
        error: 'Coloca un marcador o escribe coordenadas válidas.',
      );
      return;
    }
    if (description.length < 5 || description.length > 500) {
      state = state.copy(
        error: 'La descripción debe tener entre 5 y 500 caracteres.',
      );
      return;
    }
    state = state.copy(resolving: true, clearError: true);
    try {
      final repository = ref.read(incidentRepositoryProvider);
      final info = await repository.config();
      if (!info.enabled) {
        throw const ApiFailure(
          code: 'UNAVAILABLE',
          message: 'La recepción de novedades no está habilitada en esta API.',
        );
      }
      if (latitude < info.bounds.minLatitude ||
          latitude > info.bounds.maxLatitude ||
          longitude < info.bounds.minLongitude ||
          longitude > info.bounds.maxLongitude) {
        throw const ApiFailure(
          code: 'VALIDATION_ERROR',
          message:
              'El punto está fuera del área de operación de este prototipo.',
        );
      }
      String? edgeHint = state.edgeHint;
      final resolution = await repository.resolve(
        IncidentLocation(
          latitude: latitude,
          longitude: longitude,
          edgeIdHint: edgeHint,
        ),
      );
      if (!resolution.matched || resolution.ambiguous) {
        state = state.copy(
          resolving: false,
          resolution: resolution,
          error: resolution.message,
        );
        return;
      }
      edgeHint ??= resolution.candidates.first.edgeId;
      final payload = IncidentCreate(
        incidentType: state.incidentType,
        latitude: latitude,
        longitude: longitude,
        description: description,
        severityReported: state.severity,
        roadPassabilityReported: state.passability,
        eventTime: state.eventTime.toUtc().toIso8601String(),
        locationMethod: state.locationMethod,
        edgeIdHint: edgeHint,
        evidenceMetadata: const IncidentEvidenceMetadata(
          attachmentCount: 0,
          storageStatus: 'not_supported',
        ),
      );
      final random = Random.secure();
      state = state.copy(
        stage: IncidentDraftStage.review,
        resolving: false,
        resolution: resolution,
        edgeHint: edgeHint,
        payload: payload,
        idempotencyKey: List.generate(
          24,
          (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0'),
        ).join(),
        clearError: true,
      );
    } catch (error) {
      state = state.copy(resolving: false, error: error);
    }
  }

  Future<void> send() async {
    if (!const [
          IncidentDraftStage.review,
          IncidentDraftStage.error,
        ].contains(state.stage) ||
        state.payload == null ||
        state.idempotencyKey == null) {
      return;
    }
    final payload = state.payload!;
    final key = state.idempotencyKey!;
    state = state.copy(stage: IncidentDraftStage.sending, clearError: true);
    try {
      final incident = await ref
          .read(incidentRepositoryProvider)
          .create(payload, key);
      state = state.copy(stage: IncidentDraftStage.sent, report: incident);
    } on ApiFailure catch (error) {
      // A validation failure guarantees the server did not save this attempt.
      // Network errors may have happened after persistence: preserve exact body/key.
      final invalid = error.code == 'VALIDATION_ERROR';
      state = state.copy(
        stage: invalid ? IncidentDraftStage.editing : IncidentDraftStage.error,
        clearAttempt: invalid,
        error: error,
      );
    } catch (error) {
      state = state.copy(stage: IncidentDraftStage.error, error: error);
    }
  }

  Future<void> refresh() async {
    final id = state.report?.incidentId;
    if (id == null) return;
    try {
      state = state.copy(
        report: await ref.read(incidentRepositoryProvider).detail(id),
        clearError: true,
      );
    } catch (error) {
      state = state.copy(error: error);
    }
  }

  void newReport() {
    if (state.stage == IncidentDraftStage.sent) state = IncidentDraft();
  }
}
