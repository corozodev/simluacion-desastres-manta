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
    required this.world,
    this.survivor,
  });
  final Graph graph;
  final WorldSnapshot world;
  final Survivor? survivor;

  @override
  Widget build(BuildContext context) => Semantics(
    label:
        'Mapa de calles reales, zonas de aparición, refugios ficticios y ruta seleccionada',
    child: ClipRRect(
      borderRadius: BorderRadius.circular(SpookyTokens.radiusMd),
      child: SizedBox(
        height: 230,
        width: double.infinity,
        child: CustomPaint(painter: _MapPainter(graph, world, survivor)),
      ),
    ),
  );
}

class _MapPainter extends CustomPainter {
  _MapPainter(this.graph, this.world, this.survivor);
  final Graph graph;
  final WorldSnapshot world;
  final Survivor? survivor;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawRect(
      Offset.zero & size,
      Paint()..color = SpookyTokens.background,
    );
    final coordinates = [
      for (final node in graph.nodes) GeoPoint(lat: node.lat, lng: node.lng),
      ...?graph.coverage,
    ];
    if (coordinates.isEmpty) return;
    final left = coordinates.map((p) => p.lng).reduce(math.min),
        right = coordinates.map((p) => p.lng).reduce(math.max);
    final bottom = coordinates.map((p) => p.lat).reduce(math.min),
        top = coordinates.map((p) => p.lat).reduce(math.max);
    final scale = math.min(
      (size.width - 28) / math.max(right - left, .00001),
      (size.height - 28) / math.max(top - bottom, .00001),
    );
    Offset project(GeoPoint p) => Offset(
      (size.width - (right - left) * scale) / 2 + (p.lng - left) * scale,
      (size.height - (top - bottom) * scale) / 2 + (top - p.lat) * scale,
    );
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
        ..color = edge.blocked || world.blockedEdges.contains(edge.id)
            ? SpookyTokens.error
            : SpookyTokens.textSecondary.withValues(alpha: .4)
        ..strokeWidth = edge.blocked || world.blockedEdges.contains(edge.id)
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
    for (final zombie in world.zombies) {
      final point = nodes[zombie.currentNode];
      if (point != null) {
        canvas.drawCircle(
          point,
          zombie.type == 'horde' ? 4 : 2.5,
          Paint()..color = SpookyTokens.error,
        );
      }
    }
    for (final shelter in world.shelters) {
      final point = nodes[shelter.nodeId];
      if (point != null) {
        canvas.drawRect(
          Rect.fromCenter(center: point, width: 7, height: 7),
          Paint()..color = SpookyTokens.success,
        );
      }
    }
    if (survivor != null && nodes[survivor!.currentNode] != null) {
      canvas.drawCircle(
        nodes[survivor!.currentNode]!,
        4.5,
        Paint()..color = SpookyTokens.primary,
      );
    }
  }

  @override
  bool shouldRepaint(_MapPainter old) =>
      old.graph != graph || old.world != world || old.survivor != survivor;
}
