import 'package:dio/dio.dart';

import 'generated/models.dart';
import 'http_request.dart';

class ReferenceLayer {
  const ReferenceLayer({
    this.polygons = const [],
    this.attribution = '',
    this.consultedAt = '',
    this.availability = 'unavailable',
  });
  final List<List<List<GeoPoint>>> polygons;
  final String attribution, consultedAt, availability;
}

class HttpReferenceRepository {
  HttpReferenceRepository(this.dio);
  final Dio dio;
  Future<ReferenceLayer> load() async {
    final status = await requestJson(() => dio.get('v1/reference/status'), (
      json,
    ) {
      if (json['schema_version'] != 1 ||
          !const [
            'cached',
            'stale',
            'unavailable',
            'disabled',
          ].contains(json['availability'])) {
        throw const FormatException('Invalid reference status');
      }
      return json;
    });
    if (!const ['cached', 'stale'].contains(status['availability'])) {
      return ReferenceLayer(availability: status['availability'] as String);
    }
    return requestJson(
      () => dio.get(
        'v1/reference/susceptibility',
        queryParameters: {'version': status['dataset_version']},
      ),
      (json) {
        final provenance = Map<String, dynamic>.from(json['provenance'] as Map);
        if (json['type'] != 'FeatureCollection' ||
            provenance['category'] != 'official_reference' ||
            provenance['dataset_version'] != status['dataset_version']) {
          throw const FormatException('Invalid reference');
        }
        final polygons = <List<List<GeoPoint>>>[];
        var vertices = 0;
        for (final raw in json['features'] as List) {
          final feature = Map<String, dynamic>.from(raw as Map);
          final geometry = Map<String, dynamic>.from(
            feature['geometry'] as Map,
          );
          if (geometry['type'] != 'MultiPolygon') {
            throw const FormatException('Invalid geometry');
          }
          for (final polygon in geometry['coordinates'] as List) {
            final rings = <List<GeoPoint>>[];
            for (final ring in polygon as List) {
              final points = <GeoPoint>[];
              for (final coordinate in ring as List) {
                final pair = coordinate as List;
                final point = GeoPoint(
                  lat: (pair[1] as num).toDouble(),
                  lng: (pair[0] as num).toDouble(),
                );
                if (!point.lat.isFinite ||
                    !point.lng.isFinite ||
                    point.lat.abs() > 90 ||
                    point.lng.abs() > 180 ||
                    ++vertices > 120000) {
                  throw const FormatException('Invalid reference coordinate');
                }
                points.add(point);
              }
              rings.add(points);
            }
            polygons.add(rings);
          }
        }
        return ReferenceLayer(
          polygons: polygons,
          availability: status['availability'] as String,
          attribution: provenance['attribution'] as String,
          consultedAt: provenance['consulted_at'] as String,
        );
      },
    );
  }
}
