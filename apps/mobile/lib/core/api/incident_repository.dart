import 'package:dio/dio.dart';

import 'generated/models.dart';
import 'http_request.dart';

const incidentTypes = {
  'flooded_road': 'Calle inundada',
  'road_closed': 'Calle cerrada',
  'landslide': 'Deslizamiento',
  'fallen_tree': 'Árbol caído',
  'bridge_damage': 'Daño en puente',
  'other': 'Otra novedad',
};
const incidentSeverities = {
  'unknown': 'No sé',
  'low': 'Baja',
  'moderate': 'Moderada',
  'high': 'Alta',
};
const incidentPassabilities = {
  'unknown': 'No sé',
  'passable': 'Transitable',
  'restricted': 'Paso restringido',
  'blocked': 'Sin paso',
};
const incidentStatuses = {
  'pending': 'Pendiente de verificación',
  'corroborated': 'Corroborado',
  'verified': 'Verificado',
  'rejected': 'Rechazado',
  'expired': 'Caducado',
};

abstract interface class IncidentRepository {
  Future<IncidentServiceInfo> config();
  Future<IncidentResolution> resolve(IncidentLocation location);
  Future<Incident> create(IncidentCreate report, String idempotencyKey);
  Future<Incident> detail(String id);
  Future<IncidentList> list({String? receivedAfter});
}

class HttpIncidentRepository implements IncidentRepository {
  const HttpIncidentRepository(this.dio);
  final Dio dio;

  @override
  Future<IncidentServiceInfo> config() =>
      requestJson(() => dio.get('v1/incidents/config'), (json) {
        final info = IncidentServiceInfo.fromJson(json);
        if (info.schemaVersion != 1 ||
            info.maxDescriptionLength < 5 ||
            !info.maxSnapDistanceM.isFinite ||
            info.maxSnapDistanceM <= 0 ||
            info.bounds.minLatitude > info.bounds.maxLatitude ||
            info.bounds.minLongitude > info.bounds.maxLongitude) {
          throw const FormatException('Invalid incident service configuration');
        }
        return info;
      });

  @override
  Future<IncidentResolution> resolve(IncidentLocation location) => requestJson(
    () => dio.post('v1/incidents/resolve', data: location.toJson()),
    (json) {
      final result = IncidentResolution.fromJson(json);
      if (result.graphVersion.isEmpty ||
          result.candidates.length > 5 ||
          result.matched && result.ambiguous ||
          result.matched && result.candidates.isEmpty ||
          result.candidates.any(
            (edge) =>
                edge.edgeId.isEmpty ||
                !edge.distanceM.isFinite ||
                edge.distanceM < 0 ||
                !_validCoordinates(edge.latitude, edge.longitude),
          )) {
        throw const FormatException('Invalid incident resolution');
      }
      return result;
    },
  );

  @override
  Future<Incident> create(IncidentCreate report, String idempotencyKey) =>
      requestJson(
        () => dio.post(
          'v1/incidents',
          data: report.toJson(),
          options: Options(headers: {'Idempotency-Key': idempotencyKey}),
        ),
        _incident,
      );

  @override
  Future<Incident> detail(String id) => requestJson(
    () => dio.get('v1/incidents/${Uri.encodeComponent(id)}'),
    _incident,
  );

  @override
  Future<IncidentList> list({String? receivedAfter}) => requestJson(
    () => dio.get(
      'v1/incidents',
      queryParameters: {'limit': 100, 'received_after': ?receivedAfter},
    ),
    (json) {
      final result = IncidentList.fromJson(json);
      for (final incident in result.incidents) {
        _incident(incident.toJson());
      }
      if (result.total < 0 || result.offset < 0 || result.limit < 1) {
        throw const FormatException('Invalid incident list');
      }
      return result;
    },
  );
}

bool _validCoordinates(double latitude, double longitude) =>
    latitude.isFinite &&
    longitude.isFinite &&
    latitude.abs() <= 90 &&
    longitude.abs() <= 180;

Incident _incident(Map<String, dynamic> json) {
  final incident = Incident.fromJson(json);
  if (incident.schemaVersion != 1 ||
      incident.incidentId.isEmpty ||
      !incidentTypes.containsKey(incident.incidentType) ||
      !incidentStatuses.containsKey(incident.verificationStatus) ||
      !const [
        'citizen',
        'synthetic',
        'official',
      ].contains(incident.sourceType) ||
      !incidentSeverities.containsKey(incident.severityReported) ||
      !incidentPassabilities.containsKey(incident.roadPassabilityReported) ||
      !_validCoordinates(incident.latitude, incident.longitude) ||
      !incident.snapDistanceM.isFinite ||
      incident.snapDistanceM < 0 ||
      DateTime.tryParse(incident.eventTime) == null ||
      DateTime.tryParse(incident.receivedAt) == null ||
      DateTime.tryParse(incident.updatedAt) == null ||
      DateTime.tryParse(incident.expiresAt) == null) {
    throw const FormatException('Invalid incident');
  }
  return incident;
}
