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

// Additive OpenAPI fields are read here without editing generated models.
// Codegen was explicitly excluded from this source-only refinement.
class IncidentModeration {
  const IncidentModeration({this.withdrawn = false, this.officialTitle, this.officialURL});
  final bool withdrawn;
  final String? officialTitle, officialURL;
}
final _moderation = Expando<IncidentModeration>('incident-moderation');
IncidentModeration incidentModeration(Incident report) => _moderation[report] ?? const IncidentModeration();
bool incidentIsMapActive(Incident report) =>
    !incidentModeration(report).withdrawn &&
    !const ['rejected', 'expired'].contains(report.verificationStatus) &&
    (DateTime.tryParse(report.expiresAt)?.isAfter(DateTime.now()) ?? false);
String incidentDisplayStatus(Incident report) => incidentModeration(report).withdrawn
    ? 'Retirado del mapa' : incidentStatuses[report.verificationStatus] ?? 'Sin verificar';
String incidentDisplayOrigin(Incident report) {
  final original = const {'citizen': 'Reporte ciudadano', 'synthetic': 'Dato sintético', 'official': 'Fuente oficial'}[report.sourceType] ?? 'Origen declarado';
  return incidentModeration(report).officialTitle == null ? original : '$original · respaldo oficial';
}

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
      final records = (json['incidents'] as List)
          .map((raw) => _incident(Map<String, dynamic>.from(raw as Map)))
          .toList(growable: false);
      if (result.total < 0 || result.offset < 0 || result.limit < 1) {
        throw const FormatException('Invalid incident list');
      }
      return IncidentList(incidents: records, total: result.total, limit: result.limit,
          offset: result.offset, hasMore: result.hasMore);
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
  final withdrawn = json['map_withdrawn'];
  if (withdrawn != null && withdrawn is! bool) {
    throw const FormatException('Invalid map visibility');
  }
  String? officialTitle, officialURL;
  final rawSource = json['official_source'];
  if (rawSource != null) {
    final source = Map<String, dynamic>.from(rawSource as Map);
    final uri = Uri.tryParse(source['url'] as String);
    if (uri == null || uri.scheme != 'https' || uri.host.isEmpty || uri.userInfo.isNotEmpty ||
        source['title'] is! String || (source['title'] as String).trim().length < 3 ||
        DateTime.tryParse(source['recorded_at'] as String) == null) {
      throw const FormatException('Invalid official reference');
    }
    officialTitle = source['title'] as String;
    officialURL = source['url'] as String;
  }
  _moderation[incident] = IncidentModeration(withdrawn: withdrawn == true,
      officialTitle: officialTitle, officialURL: officialURL);
  return incident;
}
