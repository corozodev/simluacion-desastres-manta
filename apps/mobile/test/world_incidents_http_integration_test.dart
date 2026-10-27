import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:corodev_spooky/core/api/dio_client.dart';
import 'package:corodev_spooky/core/api/generated/models.dart';
import 'package:corodev_spooky/core/api/incident_repository.dart';
import 'package:corodev_spooky/core/config/api_config.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const enabled = bool.fromEnvironment('RUN_INCIDENT_HTTP_TESTS');
  test(
    'Flutter repository posts a citizen incident to real persistent Go HTTP',
    () async {
      final latitude = double.parse(
        const String.fromEnvironment('INCIDENT_TEST_LATITUDE'),
      );
      final longitude = double.parse(
        const String.fromEnvironment('INCIDENT_TEST_LONGITUDE'),
      );
      const hint = String.fromEnvironment('INCIDENT_TEST_EDGE_ID');
      const output = String.fromEnvironment('INCIDENT_TEST_OUTPUT');
      final dio = createDio(ApiConfig.incidentsFromEnvironment());
      addTearDown(() => dio.close(force: true));
      final repository = HttpIncidentRepository(dio);
      final config = await repository.config();
      expect(config.enabled, isTrue);
      expect(config.photoUploadsEnabled, isFalse);
      final resolution = await repository.resolve(
        IncidentLocation(
          latitude: latitude,
          longitude: longitude,
          edgeIdHint: hint.isEmpty ? null : hint,
        ),
      );
      expect(resolution.matched, isTrue, reason: resolution.message);
      expect(resolution.ambiguous, isFalse);
      final random = Random.secure();
      final key = List.generate(
        24,
        (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0'),
      ).join();
      final body = IncidentCreate(
        incidentType: 'road_closed',
        latitude: latitude,
        longitude: longitude,
        description:
            'Prueba académica Flutter E2E: calle cerrada. ${key.substring(0, 8)}',
        severityReported: 'moderate',
        roadPassabilityReported: 'blocked',
        eventTime: DateTime.now().toUtc().toIso8601String(),
        locationMethod: 'manual',
        edgeIdHint: hint.isEmpty ? resolution.candidates.first.edgeId : hint,
        evidenceMetadata: const IncidentEvidenceMetadata(
          attachmentCount: 0,
          storageStatus: 'not_supported',
        ),
      );
      final incident = await repository.create(body, key);
      expect(incident.sourceType, 'citizen');
      expect(incident.verificationStatus, 'pending');
      expect(incident.affectedEdgeIds, contains(body.edgeIdHint));
      expect(incident.eventTime, isNotEmpty);
      expect(incident.receivedAt, isNotEmpty);
      final replay = await repository.create(body, key);
      expect(replay.incidentId, incident.incidentId);
      final detail = await repository.detail(incident.incidentId);
      expect(detail.incidentId, incident.incidentId);
      expect(detail.verificationStatus, 'pending');
      final list = await repository.list();
      expect(
        list.incidents.any((item) => item.incidentId == incident.incidentId),
        isTrue,
      );
      if (output.isNotEmpty) {
        final file = File(output);
        await file.parent.create(recursive: true);
        await file.writeAsString(
          '${const JsonEncoder.withIndent('  ').convert({'incident': incident.toJson(), 'idempotency_key': key, 'replay_incident_id': replay.incidentId, 'resolution': resolution.toJson(), 'config': config.toJson()})}\n',
        );
      }
    },
    skip: !enabled ? 'Requiere API Go y RUN_INCIDENT_HTTP_TESTS=true' : false,
  );
}
