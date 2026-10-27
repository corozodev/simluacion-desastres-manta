import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../core/api/generated/models.dart';
import '../../core/theme/tokens.g.dart';
import '../../core/api/reference_repository.dart';

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

class RouteMap extends StatefulWidget {
  const RouteMap({
    super.key,
    required this.graph,
    this.world,
    this.survivor,
    this.marker,
    this.onPickPosition,
    this.highlightedEdgeId,
    this.height = 230,
    this.agents,
    this.shelters,
    this.roads = const {},
    this.shelterStates = const {},
    this.hydraulic,
    this.incidents = const [],
    this.onSelectAgent,
    this.onSelectShelter,
    this.onSelectIncident,
    this.showAgents = true,
    this.showShelters = true,
    this.showRoads = true,
    this.reference,
  });
  final Graph graph;
  final WorldSnapshot? world;
  final Survivor? survivor;
  final GeoPoint? marker;
  final ValueChanged<GeoPoint>? onPickPosition;
  final String? highlightedEdgeId;
  final double height;
  final List<Survivor>? agents;
  final List<Shelter>? shelters;
  final Map<String, String> roads, shelterStates;
  final HydraulicSnapshot? hydraulic;
  final List<Incident> incidents;
  final ValueChanged<Survivor>? onSelectAgent;
  final ValueChanged<Shelter>? onSelectShelter;
  final ValueChanged<Incident>? onSelectIncident;
  final bool showAgents, showShelters, showRoads;
  final ReferenceLayer? reference;
  @override
  State<RouteMap> createState() => _RouteMapState();
}

class _RouteMapState extends State<RouteMap> {
  final camera = TransformationController();
  @override
  void dispose() {
    camera.dispose();
    super.dispose();
  }

  @override
  void didUpdateWidget(RouteMap oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.graph.version != widget.graph.version) {
      camera.value = Matrix4.identity();
    }
  }

  void select(Offset point, Size size) {
    final projection = MapProjection.forGraph(widget.graph, size);
    if (projection == null) return;
    if (widget.onPickPosition != null) {
      widget.onPickPosition!(projection.unproject(point));
      return;
    }
    final nodes = {
      for (final node in widget.graph.nodes)
        node.id: GeoPoint(lat: node.lat, lng: node.lng),
    };
    final radius = 26 / camera.value.getMaxScaleOnAxis();
    double best = radius;
    VoidCallback? action;
    void candidate(GeoPoint? location, VoidCallback callback) {
      if (location == null) return;
      final distance = (projection.project(location) - point).distance;
      if (distance < best) {
        best = distance;
        action = callback;
      }
    }

    if (widget.showShelters && widget.onSelectShelter != null) {
      for (final shelter
          in widget.shelters ??
              widget.world?.shelters ??
              widget.graph.shelters) {
        candidate(
          nodes[shelter.nodeId],
          () => widget.onSelectShelter!(shelter),
        );
      }
    }
    if (widget.showAgents && widget.onSelectAgent != null) {
      for (final agent
          in widget.agents ?? widget.world?.survivors ?? <Survivor>[]) {
        candidate(nodes[agent.currentNode], () => widget.onSelectAgent!(agent));
      }
    }
    if (widget.onSelectIncident != null) {
      for (final report in widget.incidents) {
        candidate(
          GeoPoint(lat: report.latitude, lng: report.longitude),
          () => widget.onSelectIncident!(report),
        );
      }
    }
    action?.call();
  }

  @override
  Widget build(BuildContext context) => Semantics(
    label: widget.onPickPosition == null
        ? 'Mapa interactivo de calles OSM, refugios propuestos y agentes publicados. Pellizca para ampliar.'
        : 'Selecciona la ubicación de la novedad en el mapa.',
    child: ClipRRect(
      borderRadius: BorderRadius.circular(SpookyTokens.radiusMd),
      child: SizedBox(
        height: widget.height,
        width: double.infinity,
        child: LayoutBuilder(
          builder: (context, constraints) {
            final size = Size(constraints.maxWidth, constraints.maxHeight);
            return Stack(
              children: [
                InteractiveViewer(
                  transformationController: camera,
                  minScale: 1,
                  maxScale: 10,
                  child: GestureDetector(
                    onTapUp: (details) => select(details.localPosition, size),
                    child: CustomPaint(
                      painter: _MapPainter(
                        widget.graph,
                        widget.world,
                        widget.survivor,
                        widget.marker,
                        widget.highlightedEdgeId,
                        agents: widget.showAgents ? widget.agents : const [],
                        shelters: widget.showShelters
                            ? widget.shelters
                            : const [],
                        roads: widget.showRoads ? widget.roads : const {},
                        shelterStates: widget.shelterStates,
                        hydraulic: widget.showRoads ? widget.hydraulic : null,
                        incidents: widget.incidents,
                        showZombies: widget.showAgents,
                        reference: widget.reference,
                      ),
                      child: SizedBox(width: size.width, height: size.height),
                    ),
                  ),
                ),
                Positioned(
                  right: 8,
                  bottom: 24,
                  child: IconButton.filledTonal(
                    tooltip: 'Restablecer vista',
                    onPressed: () => camera.value = Matrix4.identity(),
                    icon: const Icon(Icons.center_focus_strong),
                  ),
                ),
                const Positioned(
                  left: 8,
                  bottom: 4,
                  child: Text(
                    '© OpenStreetMap contributors · Refugios propuestos',
                    style: TextStyle(
                      fontSize: 9,
                      backgroundColor: SpookyTokens.background,
                    ),
                  ),
                ),
              ],
            );
          },
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
    this.highlightedEdgeId, {
    this.agents,
    this.shelters,
    this.roads = const {},
    this.shelterStates = const {},
    this.hydraulic,
    this.incidents = const [],
    this.showZombies = true,
    this.reference,
  });
  final Graph graph;
  final WorldSnapshot? world;
  final Survivor? survivor;
  final GeoPoint? marker;
  final String? highlightedEdgeId;
  final List<Survivor>? agents;
  final List<Shelter>? shelters;
  final Map<String, String> roads, shelterStates;
  final HydraulicSnapshot? hydraulic;
  final List<Incident> incidents;
  final bool showZombies;
  final ReferenceLayer? reference;

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
    for (final polygon in reference?.polygons ?? <List<List<GeoPoint>>>[]) {
      final shape = Path()..fillType = PathFillType.evenOdd;
      for (final ring in polygon) {
        shape.addPath(path(ring, closed: true), Offset.zero);
      }
      canvas.drawPath(
        shape,
        Paint()..color = SpookyTokens.secondary.withValues(alpha: .16),
      );
      canvas.drawPath(
        shape,
        Paint()
          ..color = SpookyTokens.secondary.withValues(alpha: .5)
          ..style = PaintingStyle.stroke
          ..strokeWidth = .6,
      );
    }
    final water = hydraulic;
    if (water != null) {
      final grid = water.grid;
      for (var i = 0; i < water.depthsM.length; i++) {
        final depth = water.depthsM[i];
        if (depth < .01) continue;
        final row = i ~/ grid.cols, col = i % grid.cols;
        final south = grid.origin.lat + row * grid.latStep;
        final west = grid.origin.lng + col * grid.lngStep;
        final northWest = project(
          GeoPoint(lat: south + grid.latStep, lng: west),
        );
        final southEast = project(
          GeoPoint(lat: south, lng: west + grid.lngStep),
        );
        canvas.drawRect(
          Rect.fromPoints(northWest, southEast),
          Paint()
            ..color = SpookyTokens.floodMedium.withValues(
              alpha: (.15 + (depth / .5).clamp(0, 1) * .5),
            ),
        );
      }
    }
    for (final edge in graph.edges) {
      final paint = Paint()
        ..color = edge.id == highlightedEdgeId
            ? SpookyTokens.accent
            : edge.blocked ||
                  world?.blockedEdges.contains(edge.id) == true ||
                  roads[edge.id] == 'blocked'
            ? SpookyTokens.error
            : roads[edge.id] == 'caution'
            ? SpookyTokens.warning
            : SpookyTokens.textSecondary.withValues(alpha: .4)
        ..strokeWidth = edge.id == highlightedEdgeId
            ? 4
            : edge.blocked ||
                  world?.blockedEdges.contains(edge.id) == true ||
                  roads[edge.id] == 'blocked'
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
    for (final zombie
        in showZombies ? world?.zombies ?? <Zombie>[] : <Zombie>[]) {
      final point = nodes[zombie.currentNode];
      if (point != null) {
        _person(canvas, point, SpookyTokens.error, zombie: true);
        if (zombie.type == 'horde') _label(canvas, point, 'H');
      }
    }
    for (final shelter in shelters ?? world?.shelters ?? graph.shelters) {
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
          Paint()
            ..color =
                const [
                  'exposed',
                  'inaccessible',
                ].contains(shelterStates[shelter.id])
                ? SpookyTokens.error
                : shelterStates[shelter.id] == 'full' ||
                      shelter.occupancy >= shelter.capacity
                ? SpookyTokens.warning
                : SpookyTokens.shelterAvailable,
        );
        if (const [
          'exposed',
          'inaccessible',
        ].contains(shelterStates[shelter.id])) {
          _label(canvas, point, '×');
        } else if (shelterStates[shelter.id] == 'full' ||
            shelter.occupancy >= shelter.capacity) {
          _label(canvas, point, '!');
        }
      }
    }
    for (final person in agents ?? world?.survivors ?? <Survivor>[]) {
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
    for (final report in incidents) {
      final position = project(
        GeoPoint(lat: report.latitude, lng: report.longitude),
      );
      final pending = report.verificationStatus == 'pending';
      final shape = Path()
        ..moveTo(position.dx, position.dy - 6)
        ..lineTo(position.dx + 6, position.dy)
        ..lineTo(position.dx, position.dy + 6)
        ..lineTo(position.dx - 6, position.dy)
        ..close();
      canvas.drawPath(
        shape,
        Paint()..color = pending ? SpookyTokens.warning : SpookyTokens.accent,
      );
      _label(canvas, position, pending ? '?' : '!');
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
      old.highlightedEdgeId != highlightedEdgeId ||
      old.agents != agents ||
      old.shelters != shelters ||
      old.roads != roads ||
      old.hydraulic != hydraulic ||
      old.incidents != incidents ||
      old.shelterStates != shelterStates ||
      old.showZombies != showZombies ||
      old.reference != reference;
}
