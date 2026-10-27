import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../core/api/generated/models.dart';
import '../../core/theme/tokens.g.dart';

List<GeoPoint> routeGeometry(Graph graph, Survivor survivor) {
  final nodes = {for (final node in graph.nodes) node.id: node};
  final route = [
    survivor.currentNode,
    ...survivor.plannedRoute.where((id) => id != survivor.currentNode),
  ];
  final points = <GeoPoint>[];
  for (var i = 1; i < route.length; i++) {
    GraphEdge? edge;
    for (final candidate in graph.edges) {
      if (candidate.from == route[i - 1] && candidate.to == route[i] ||
          !candidate.directed &&
              candidate.to == route[i - 1] &&
              candidate.from == route[i]) {
        edge = candidate;
        break;
      }
    }
    if (edge == null) return [];
    final from = nodes[edge.from], to = nodes[edge.to];
    if (from == null || to == null) return [];
    final geometry = edge.geometry?.isNotEmpty == true
        ? edge.geometry!
        : [
            GeoPoint(lat: from.lat, lng: from.lng),
            GeoPoint(lat: to.lat, lng: to.lng),
          ];
    points.addAll(edge.from == route[i - 1] ? geometry : geometry.reversed);
  }
  return points;
}

List<String> routeWarnings(
  Graph graph,
  WorldSnapshot world,
  Survivor survivor,
) {
  final route = [
    survivor.currentNode,
    ...survivor.plannedRoute.where((id) => id != survivor.currentNode),
  ];
  final warnings = <String>[];
  for (var i = 1; i < route.length; i++) {
    if (!graph.edges.any(
      (edge) =>
          !edge.blocked &&
          !world.blockedEdges.contains(edge.id) &&
          (edge.from == route[i - 1] && edge.to == route[i] ||
              !edge.directed &&
                  edge.to == route[i - 1] &&
                  edge.from == route[i]),
    )) {
      warnings.add('La ruta publicada contiene una calle no disponible.');
      break;
    }
  }
  if (world.zombies.any(
    (zombie) =>
        route.contains(zombie.currentNode) ||
        zombie.type == 'horde' &&
            graph.edges.any(
              (edge) =>
                  edge.from == zombie.currentNode && route.contains(edge.to) ||
                  edge.to == zombie.currentNode && route.contains(edge.from),
            ),
  )) {
    warnings.add(
      'Hay amenazas visibles sobre la ruta o en la zona de una horda.',
    );
  }
  return warnings;
}

class RouteMap extends StatelessWidget {
  const RouteMap({
    super.key,
    required this.graph,
    this.world,
    this.survivor,
    this.marker,
    this.onPickPosition,
    this.highlightedEdgeId,
  });
  final Graph graph;
  final WorldSnapshot? world;
  final Survivor? survivor;
  final GeoPoint? marker;
  final ValueChanged<GeoPoint>? onPickPosition;
  final String? highlightedEdgeId;

  @override
  Widget build(BuildContext context) => Semantics(
    label: onPickPosition == null
        ? 'Mapa de calles reales, zonas de aparición, refugios ficticios y ruta seleccionada'
        : 'Selecciona la ubicación de la novedad en el mapa. También puedes escribir las coordenadas.',
    child: ClipRRect(
      borderRadius: BorderRadius.circular(SpookyTokens.radiusMd),
      child: SizedBox(
        height: 230,
        width: double.infinity,
        child: LayoutBuilder(
          builder: (context, constraints) => GestureDetector(
            onTapUp: onPickPosition == null
                ? null
                : (details) {
                    final projection = MapProjection.forGraph(
                      graph,
                      Size(constraints.maxWidth, constraints.maxHeight),
                    );
                    if (projection != null) {
                      onPickPosition!(
                        projection.unproject(details.localPosition),
                      );
                    }
                  },
            child: CustomPaint(
              painter: _MapPainter(
                graph,
                world,
                survivor,
                marker,
                highlightedEdgeId,
              ),
              child: const SizedBox.expand(),
            ),
          ),
        ),
      ),
    ),
  );
}

class MapProjection {
  const MapProjection._(this.left, this.top, this.scale, this.x, this.y);
  final double left;
  final double top;
  final double scale;
  final double x;
  final double y;

  static MapProjection? forGraph(Graph graph, Size size) {
    final coordinates = [
      for (final node in graph.nodes) GeoPoint(lat: node.lat, lng: node.lng),
      ...?graph.coverage,
    ];
    if (coordinates.isEmpty) return null;
    final left = coordinates.map((p) => p.lng).reduce(math.min),
        right = coordinates.map((p) => p.lng).reduce(math.max);
    final bottom = coordinates.map((p) => p.lat).reduce(math.min),
        top = coordinates.map((p) => p.lat).reduce(math.max);
    final scale = math.min(
      math.max(size.width - 28, 1) / math.max(right - left, .00001),
      math.max(size.height - 28, 1) / math.max(top - bottom, .00001),
    );
    return MapProjection._(
      left,
      top,
      scale,
      (size.width - (right - left) * scale) / 2,
      (size.height - (top - bottom) * scale) / 2,
    );
  }

  Offset project(GeoPoint point) =>
      Offset(x + (point.lng - left) * scale, y + (top - point.lat) * scale);

  GeoPoint unproject(Offset point) => GeoPoint(
    lat: top - (point.dy - y) / scale,
    lng: left + (point.dx - x) / scale,
  );
}

class _MapPainter extends CustomPainter {
  _MapPainter(
    this.graph,
    this.world,
    this.survivor,
    this.marker,
    this.highlightedEdgeId,
  );
  final Graph graph;
  final WorldSnapshot? world;
  final Survivor? survivor;
  final GeoPoint? marker;
  final String? highlightedEdgeId;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawRect(
      Offset.zero & size,
      Paint()..color = SpookyTokens.background,
    );
    final projection = MapProjection.forGraph(graph, size);
    if (projection == null) return;
    final project = projection.project;
    final nodes = {
      for (final node in graph.nodes)
        node.id: project(GeoPoint(lat: node.lat, lng: node.lng)),
    };
    Path path(List<GeoPoint> values, {bool closed = false}) {
      final result = Path();
      for (var i = 0; i < values.length; i++) {
        final p = project(values[i]);
        if (i == 0) {
          result.moveTo(p.dx, p.dy);
        } else {
          result.lineTo(p.dx, p.dy);
        }
      }
      if (closed) result.close();
      return result;
    }

    if (graph.coverage?.isNotEmpty == true) {
      canvas.drawPath(
        path(graph.coverage!, closed: true),
        Paint()
          ..color = SpookyTokens.textSecondary.withValues(alpha: .5)
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1,
      );
    }
    for (final zone in graph.spawnZones ?? <SpawnZone>[]) {
      canvas.drawPath(
        path(zone.geometry, closed: true),
        Paint()..color = SpookyTokens.secondary.withValues(alpha: .18),
      );
      canvas.drawPath(
        path(zone.geometry, closed: true),
        Paint()
          ..color = SpookyTokens.secondary.withValues(alpha: .65)
          ..style = PaintingStyle.stroke
          ..strokeWidth = .7,
      );
    }
    for (final edge in graph.edges) {
      final paint = Paint()
        ..color = edge.id == highlightedEdgeId
            ? SpookyTokens.accent
            : edge.blocked || world?.blockedEdges.contains(edge.id) == true
            ? SpookyTokens.error
            : SpookyTokens.textSecondary.withValues(alpha: .4)
        ..strokeWidth = edge.id == highlightedEdgeId
            ? 4
            : edge.blocked || world?.blockedEdges.contains(edge.id) == true
            ? 2
            : 1
        ..style = PaintingStyle.stroke;
      if (edge.geometry?.isNotEmpty == true) {
        canvas.drawPath(path(edge.geometry!), paint);
      } else if (nodes[edge.from] != null && nodes[edge.to] != null) {
        canvas.drawLine(nodes[edge.from]!, nodes[edge.to]!, paint);
      }
    }
    if (survivor != null) {
      canvas.drawPath(
        path(routeGeometry(graph, survivor!)),
        Paint()
          ..color = SpookyTokens.accent
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2.5,
      );
    }
    for (final zombie in world?.zombies ?? <Zombie>[]) {
      final point = nodes[zombie.currentNode];
      if (point != null) {
        _person(canvas, point, SpookyTokens.error, zombie: true);
        if (zombie.type == 'horde') _label(canvas, point, 'H');
      }
    }
    for (final shelter in world?.shelters ?? graph.shelters) {
      final point = nodes[shelter.nodeId];
      if (point != null) {
        final shelterPath = Path()
          ..moveTo(point.dx - 5, point.dy)
          ..lineTo(point.dx, point.dy - 5)
          ..lineTo(point.dx + 5, point.dy)
          ..lineTo(point.dx + 4, point.dy + 5)
          ..lineTo(point.dx - 4, point.dy + 5)
          ..close();
        canvas.drawPath(
          shelterPath,
          Paint()..color = SpookyTokens.shelterAvailable,
        );
      }
    }
    for (final person in world?.survivors ?? <Survivor>[]) {
      final point = nodes[person.currentNode];
      if (point == null) continue;
      _person(
        canvas,
        point,
        person.status == 'evacuated'
            ? SpookyTokens.shelterAvailable
            : person.status == 'bitten'
            ? SpookyTokens.warning
            : SpookyTokens.accent,
      );
      if (person.status == 'evacuated') _label(canvas, point, '✓');
      if (person.status == 'bitten') _label(canvas, point, '×');
    }
    if (survivor != null && nodes[survivor!.currentNode] != null) {
      canvas.drawCircle(
        nodes[survivor!.currentNode]!,
        8,
        Paint()
          ..color = SpookyTokens.primary
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.5,
      );
    }
    if (marker != null) {
      final position = project(marker!);
      canvas.drawCircle(position, 8, Paint()..color = SpookyTokens.background);
      canvas.drawCircle(position, 6, Paint()..color = SpookyTokens.primary);
      canvas.drawLine(
        position.translate(-11, 0),
        position.translate(11, 0),
        Paint()
          ..color = SpookyTokens.primary
          ..strokeWidth = 1.5,
      );
      canvas.drawLine(
        position.translate(0, -11),
        position.translate(0, 11),
        Paint()
          ..color = SpookyTokens.primary
          ..strokeWidth = 1.5,
      );
    }
  }

  // Static counterparts of the web symbols. Canvas needs no asset loader,
  // animation timer or session management; positions remain repository data.
  void _person(
    Canvas canvas,
    Offset point,
    Color color, {
    bool zombie = false,
  }) {
    canvas.drawCircle(point.translate(0, -3), 2.2, Paint()..color = color);
    final body = Path()
      ..moveTo(point.dx - 3, point.dy + (zombie ? -1 : 2))
      ..lineTo(point.dx, point.dy)
      ..lineTo(point.dx + 3, point.dy + (zombie ? -1 : 2))
      ..moveTo(point.dx, point.dy)
      ..lineTo(point.dx, point.dy + 4)
      ..moveTo(point.dx - 2, point.dy + 6)
      ..lineTo(point.dx, point.dy + 4)
      ..lineTo(point.dx + 2, point.dy + 6);
    canvas.drawPath(
      body,
      Paint()
        ..color = color
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.8
        ..strokeCap = StrokeCap.round,
    );
  }

  void _label(Canvas canvas, Offset point, String value) {
    final text = TextPainter(
      text: TextSpan(
        text: value,
        style: const TextStyle(
          color: SpookyTokens.textPrimary,
          fontSize: 9,
          fontWeight: FontWeight.bold,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    text.paint(canvas, point.translate(4, -8));
  }

  @override
  bool shouldRepaint(_MapPainter old) =>
      old.graph != graph ||
      old.world != world ||
      old.survivor != survivor ||
      old.marker != marker ||
      old.highlightedEdgeId != highlightedEdgeId;
}
