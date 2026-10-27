import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/generated/models.dart';
import '../../core/api/incident_repository.dart';
import '../../core/api/spectator_repository.dart';
import '../../core/api/reference_repository.dart';
import '../../core/providers.dart';
import '../../core/theme/tokens.g.dart';
import '../incidents/incident_draft.dart';
import '../incidents/incident_report_screen.dart';
import '../spectator/observer.dart';
import 'route_map.dart';

class EscapeScreen extends ConsumerStatefulWidget {
  const EscapeScreen({super.key});
  @override
  ConsumerState<EscapeScreen> createState() => _EscapeScreenState();
}

class _EscapeScreenState extends ConsumerState<EscapeScreen>
    with WidgetsBindingObserver {
  late final PublishedObserver zombie;
  late final PublishedObserver flood;
  int section = 0;
  bool experimental = false, foreground = true, reportsBusy = false;
  List<Incident> reports = const [];
  Object? reportsError;
  ReferenceLayer? reference;
  bool referenceBusy = false;
  Timer? reportsTimer;
  int reportsEpoch = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    final repository = ref.read(spectatorRepositoryProvider);
    zombie = PublishedObserver(repository, 'zombie_outbreak');
    flood = PublishedObserver(repository, 'urban_flood');
    zombie.setActive(true);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    setState(() => foreground = state == AppLifecycleState.resumed);
    observe();
  }

  void observe() {
    zombie.setActive(foreground && section == 0);
    flood.setActive(foreground && section == 1);
    reportsEpoch++;
    reportsTimer?.cancel();
    if (foreground && section == 1 && !experimental) {
      unawaited(loadReports());
      unawaited(loadReference());
    }
  }

  Future<void> loadReference() async {
    if (referenceBusy || reference != null) return;
    referenceBusy = true;
    try {
      final layer = await ref.read(referenceRepositoryProvider).load();
      if (mounted) setState(() => reference = layer);
    } catch (_) {
      /* Reference availability never blocks citizen reports. */
    } finally {
      referenceBusy = false;
    }
  }

  Future<void> loadReports() async {
    if (reportsBusy || !foreground || section != 1 || experimental) return;
    reportsBusy = true;
    final epoch = reportsEpoch;
    try {
      final value = await ref.read(incidentRepositoryProvider).list();
      if (!mounted || epoch != reportsEpoch) return;
      setState(() {
        // Synthetic reports never enter the citizen map.
        reports = value.incidents
            .where(
              (report) =>
                  report.sourceType != 'synthetic' &&
                  !const [
                    'rejected',
                    'expired',
                  ].contains(report.verificationStatus),
            )
            .toList();
        reportsError = null;
      });
    } catch (error) {
      if (mounted && epoch == reportsEpoch) {
        setState(() => reportsError = error);
      }
    } finally {
      reportsBusy = false;
      if (mounted && foreground && section == 1 && !experimental) {
        reportsTimer = Timer(
          Duration(
            seconds: epoch != reportsEpoch
                ? 1
                : reportsError == null
                ? 30
                : 15,
          ),
          loadReports,
        );
      }
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    reportsEpoch++;
    reportsTimer?.cancel();
    zombie.dispose();
    flood.dispose();
    super.dispose();
  }

  Future<void> report() async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (context) => IncidentReportScreen(graph: flood.graph),
      ),
    );
    if (mounted) unawaited(loadReports());
  }

  @override
  Widget build(BuildContext context) => Column(
    children: [
      Expanded(
        child: IndexedStack(
          index: section,
          children: [
            TickerMode(
              enabled: foreground && section == 0,
              child: _ScenarioPane(
                key: const ValueKey('zombie'),
                observer: zombie,
              ),
            ),
            TickerMode(
              enabled: foreground && section == 1,
              child: _ScenarioPane(
                key: const ValueKey('flood'),
                observer: flood,
                citizen: !experimental,
                reports: reports,
                reportsLoading: reportsBusy,
                reference: reference,
                reportsError: reportsError,
                onReportsRetry: loadReports,
                onReport: report,
                selector: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 4,
                  ),
                  child: SegmentedButton<bool>(
                    segments: const [
                      ButtonSegment(
                        value: false,
                        icon: Icon(Icons.public),
                        label: Text('Mapa ciudadano'),
                      ),
                      ButtonSegment(
                        value: true,
                        icon: Icon(Icons.science_outlined),
                        label: Text('Simulación'),
                      ),
                    ],
                    selected: {experimental},
                    onSelectionChanged: (value) {
                      setState(() => experimental = value.first);
                      observe();
                    },
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
      NavigationBar(
        height: 68,
        selectedIndex: section,
        onDestinationSelected: (value) {
          setState(() => section = value);
          observe();
        },
        destinations: const [
          NavigationDestination(
            icon: Icon(
              Icons.coronavirus_outlined,
              color: SpookyTokens.secondary,
            ),
            selectedIcon: Icon(
              Icons.coronavirus,
              color: SpookyTokens.secondary,
            ),
            label: 'Brote zombi',
          ),
          NavigationDestination(
            icon: Icon(Icons.water_outlined, color: SpookyTokens.accent),
            selectedIcon: Icon(Icons.water, color: SpookyTokens.accent),
            label: 'Inundaciones',
          ),
        ],
      ),
    ],
  );
}

const statusLabels = {
  'CREATED': 'Preparando',
  'RUNNING': 'En ejecución',
  'PAUSED': 'Pausada',
  'COMPLETED': 'Finalizada',
  'CANCELLED': 'Cancelada',
  'FAILED': 'Error',
  'running': 'En ejecución',
  'paused': 'Pausada',
  'finished': 'Finalizada',
  'failed': 'Error',
  'idle': 'Sin simulación publicada',
};
const agentStatusLabels = {
  'active': 'Activo',
  'bitten': 'Mordido',
  'evacuated': 'Evacuado',
  'moving': 'En movimiento',
  'waiting': 'Esperando',
  'isolated': 'Aislado',
};

class _ScenarioPane extends StatefulWidget {
  const _ScenarioPane({
    super.key,
    required this.observer,
    this.citizen = false,
    this.selector,
    this.reports = const [],
    this.reportsError,
    this.reportsLoading = false,
    this.onReportsRetry,
    this.onReport,
    this.reference,
  });
  final PublishedObserver observer;
  final bool citizen;
  final ReferenceLayer? reference;
  final Widget? selector;
  final List<Incident> reports;
  final Object? reportsError;
  final bool reportsLoading;
  final VoidCallback? onReportsRetry, onReport;
  @override
  State<_ScenarioPane> createState() => _ScenarioPaneState();
}

class _ScenarioPaneState extends State<_ScenarioPane> {
  String selectedId = '', lastRun = '';
  bool showAgents = true,
      showShelters = true,
      showRoads = true,
      showReference = true;

  String shelterName(String id, PublishedView? view, Graph graph) {
    if (id.isEmpty) return 'Sin asignación';
    final custom = view?.shelterNames[id];
    if (custom != null && custom.isNotEmpty) return custom;
    final shelters = view?.shelters.isNotEmpty == true
        ? view!.shelters
        : graph.shelters;
    final index = shelters.indexWhere((shelter) => shelter.id == id);
    return index < 0 ? 'Refugio asignado' : 'Refugio ${index + 1}';
  }

  Future<void> sheet(String title, Widget body) {
    final expectedRun = widget.citizen ? null : widget.observer.view?.id;
    return showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (context) => ListenableBuilder(
        listenable: widget.observer,
        builder: (context, _) => SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (expectedRun != null &&
                    expectedRun != widget.observer.view?.id) ...[
                  const Text('La ejecución publicada cambió.'),
                  TextButton(
                    onPressed: () => Navigator.pop(context),
                    child: const Text('Volver al mapa actual'),
                  ),
                ] else ...[
                  Text(title, style: Theme.of(context).textTheme.titleLarge),
                  const SizedBox(height: 12),
                  body,
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  void selectAgent(Survivor agent, PublishedView view, Graph graph) {
    setState(() => selectedId = agent.id);
    unawaited(
      sheet(
        'Superviviente ${agent.id}',
        Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              agentStatusLabels[view.agentStates[agent.id] ?? agent.status] ??
                  'Publicado',
            ),
            Text('Refugio: ${shelterName(agent.targetShelterId, view, graph)}'),
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: routeGeometry(graph, agent).isEmpty
                  ? null
                  : () => Navigator.pop(context),
              icon: const Icon(Icons.route),
              label: Text(
                routeGeometry(graph, agent).isEmpty
                    ? 'Sin ruta publicada'
                    : 'Ver ruta',
              ),
            ),
          ],
        ),
      ),
    );
  }

  void selectShelter(Shelter shelter, PublishedView? view, Graph graph) {
    unawaited(
      sheet(
        shelterName(shelter.id, view, graph),
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Refugio propuesto para simulación; no es un punto oficial de emergencia.',
            ),
            const SizedBox(height: 12),
            if (view?.shelterStates[shelter.id] != null)
              Text(
                'Estado sintético: ${const {'available': 'Disponible', 'full': 'Completo', 'exposed': 'Expuesto', 'inaccessible': 'Inaccesible'}[view!.shelterStates[shelter.id]]}',
              ),
            Text('Capacidad: ${shelter.capacity}'),
            Text('Ocupación: ${shelter.occupancy}'),
            Text(
              'Plazas disponibles: ${shelter.available ?? shelter.capacity - shelter.occupancy - (shelter.reserved ?? 0)}',
            ),
          ],
        ),
      ),
    );
  }

  void selectReport(Incident incident) {
    final date = DateTime.parse(incident.eventTime).toLocal();
    final time = MaterialLocalizations.of(
      context,
    ).formatTimeOfDay(TimeOfDay.fromDateTime(date));
    unawaited(
      sheet(
        incidentTypes[incident.incidentType] ?? 'Novedad',
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('${date.day}/${date.month}/${date.year} · $time'),
            const SizedBox(height: 8),
            Text(incident.description),
            const SizedBox(height: 12),
            Text(
              'Transitabilidad declarada: ${incidentPassabilities[incident.roadPassabilityReported]}',
            ),
            Text(
              'Severidad declarada: ${incidentSeverities[incident.severityReported]}',
            ),
            Text(
              incidentStatuses[incident.verificationStatus] ?? 'Sin verificar',
            ),
            const SizedBox(height: 12),
            const Text(
              'Un reporte pendiente no modifica las rutas de la simulación.',
            ),
          ],
        ),
      ),
    );
  }

  void agents(PublishedView view, Graph graph) {
    unawaited(
      sheet(
        'Supervivientes',
        SizedBox(
          height: MediaQuery.sizeOf(context).height * .55,
          child: ListView.builder(
            itemCount: view.agents.length,
            itemBuilder: (context, index) {
              final agent = view.agents[index];
              return ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(
                  Icons.person_outline,
                  color: SpookyTokens.accent,
                ),
                title: Text(agent.id),
                subtitle: Text(
                  '${agentStatusLabels[view.agentStates[agent.id] ?? agent.status]} · ${shelterName(agent.targetShelterId, view, graph)}',
                ),
                trailing: const Icon(Icons.route),
                onTap: () {
                  Navigator.pop(context);
                  selectAgent(agent, view, graph);
                },
              );
            },
          ),
        ),
      ),
    );
  }

  void reportList() {
    unawaited(
      sheet(
        'Novedades ciudadanas',
        SizedBox(
          height: MediaQuery.sizeOf(context).height * .55,
          child: widget.reports.isEmpty
              ? const Center(
                  child: Text('No hay novedades publicadas en esta consulta.'),
                )
              : ListView.builder(
                  itemCount: widget.reports.length,
                  itemBuilder: (context, index) {
                    final report = widget.reports[index];
                    return ListTile(
                      leading: Icon(
                        report.verificationStatus == 'pending'
                            ? Icons.help_outline
                            : Icons.location_on_outlined,
                      ),
                      title: Text(
                        incidentTypes[report.incidentType] ?? 'Novedad',
                      ),
                      subtitle: Text(
                        incidentStatuses[report.verificationStatus] ??
                            'Sin verificar',
                      ),
                      onTap: () {
                        Navigator.pop(context);
                        selectReport(report);
                      },
                    );
                  },
                ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.observer,
    builder: (context, _) {
      final observer = widget.observer;
      final view = observer.view, graph = observer.graph;
      if (lastRun != (view?.id ?? '')) {
        selectedId = '';
        lastRun = view?.id ?? '';
      }
      final flood = observer.scenario == 'urban_flood';
      final selected = view?.agents
          .where((agent) => agent.id == selectedId)
          .firstOrNull;
      final available = view?.active == true;
      final connected = !observer.stale;
      final noRun = view?.availability == 'unavailable'
          ? 'Simulación no disponible'
          : flood
          ? 'Sin simulación publicada'
          : 'Sin simulación activa';
      return Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 8, 0),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    flood ? 'Inundaciones' : 'Brote zombi',
                    style: Theme.of(context).textTheme.titleLarge?.copyWith(
                      color: flood
                          ? SpookyTokens.accent
                          : SpookyTokens.secondary,
                    ),
                  ),
                ),
                IconButton(
                  tooltip: 'Actualizar observación',
                  onPressed: () {
                    unawaited(observer.refresh());
                    if (widget.citizen) widget.onReportsRetry?.call();
                  },
                  icon: const Icon(Icons.refresh),
                ),
                PopupMenuButton<String>(
                  tooltip: 'Capas del mapa',
                  onSelected: (value) => setState(() {
                    if (value == 'agents') showAgents = !showAgents;
                    if (value == 'shelters') showShelters = !showShelters;
                    if (value == 'roads') showRoads = !showRoads;
                    if (value == 'reference') showReference = !showReference;
                  }),
                  itemBuilder: (context) => [
                    if (!widget.citizen)
                      CheckedPopupMenuItem(
                        value: 'agents',
                        checked: showAgents,
                        child: const Text('Agentes y amenazas'),
                      ),
                    CheckedPopupMenuItem(
                      value: 'shelters',
                      checked: showShelters,
                      child: const Text('Refugios propuestos'),
                    ),
                    if (widget.citizen)
                      CheckedPopupMenuItem(
                        value: 'reference',
                        checked: showReference,
                        child: const Text('Referencia oficial histórica'),
                      ),
                    if (flood && !widget.citizen)
                      CheckedPopupMenuItem(
                        value: 'roads',
                        checked: showRoads,
                        child: const Text('Exposición y cierres sintéticos'),
                      ),
                  ],
                ),
              ],
            ),
          ),
          ?widget.selector,
          Expanded(
            child: LayoutBuilder(
              builder: (context, constraints) => Stack(
                children: [
                  if (graph != null)
                    RouteMap(
                      key: ValueKey('${observer.scenario}-map'),
                      graph: graph,
                      height: constraints.maxHeight,
                      world: widget.citizen ? null : view?.world,
                      survivor: widget.citizen ? null : selected,
                      agents: widget.citizen ? const [] : view?.agents,
                      shelters: !widget.citizen && available
                          ? view?.shelters
                          : null,
                      roads: widget.citizen
                          ? const {}
                          : view?.roads ?? const {},
                      hydraulic: widget.citizen ? null : view?.hydraulic,
                      incidents: widget.citizen ? widget.reports : const [],
                      showAgents: showAgents,
                      showShelters: showShelters,
                      showRoads: showRoads,
                      shelterStates: widget.citizen
                          ? const {}
                          : view?.shelterStates ?? const {},
                      reference: widget.citizen && showReference
                          ? widget.reference
                          : null,
                      onSelectAgent: view == null
                          ? null
                          : (agent) => selectAgent(agent, view, graph),
                      onSelectShelter: (shelter) => selectShelter(
                        shelter,
                        widget.citizen ? null : view,
                        graph,
                      ),
                      onSelectIncident: widget.citizen ? selectReport : null,
                    )
                  else if (observer.loading)
                    const Center(child: CircularProgressIndicator())
                  else
                    Center(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Text(
                          'El mapa no está disponible. ${observer.error == null ? '' : 'Revisa la conexión y vuelve a consultar.'}',
                          textAlign: TextAlign.center,
                        ),
                      ),
                    ),
                  Positioned(
                    top: 10,
                    left: 12,
                    right: 12,
                    child: _HUD(
                      children: [
                        if (widget.citizen)
                          const Text(
                            'Mapa ciudadano · Reportes y referencias',
                            style: TextStyle(fontWeight: FontWeight.w700),
                          )
                        else
                          Text(
                            available
                                ? 'Turno ${view!.tick}/${view.maxTicks} · ${statusLabels[view.status] ?? 'Preparando'}'
                                : noRun,
                            style: const TextStyle(fontWeight: FontWeight.w700),
                          ),
                        if (!widget.citizen && !available)
                          const Text(
                            'Cuando comience una simulación, podrás verla aquí.',
                            style: TextStyle(fontSize: 12),
                          ),
                        if (flood && !widget.citizen)
                          const Text(
                            'Simulación con datos sintéticos.',
                            style: TextStyle(
                              fontSize: 12,
                              color: SpookyTokens.accent,
                            ),
                          ),
                        if (!connected)
                          const Text(
                            'Sin conexión · Último estado recibido',
                            style: TextStyle(
                              fontSize: 12,
                              color: SpookyTokens.warning,
                            ),
                          ),
                        if (widget.citizen && widget.reportsError != null)
                          const Text(
                            'Novedades sin actualizar · Reintenta la consulta',
                            style: TextStyle(
                              fontSize: 12,
                              color: SpookyTokens.warning,
                            ),
                          ),
                      ],
                    ),
                  ),
                  Positioned(
                    left: 12,
                    right: 64,
                    bottom: 30,
                    child: _HUD(
                      children: [
                        if (widget.citizen) ...[
                          if (widget.reference?.polygons.isNotEmpty == true)
                            Text(
                              widget.reference!.attribution,
                              style: const TextStyle(fontSize: 9),
                            ),
                          Text(
                            widget.reference?.polygons.isNotEmpty == true
                                ? 'Referencia histórica SNGR · No es una alerta'
                                : 'Referencia oficial no disponible',
                            style: const TextStyle(fontSize: 10),
                          ),
                          const Text(
                            '◇ ? Pendiente · ◇ ! Revisado',
                            style: TextStyle(fontSize: 11),
                          ),
                          Row(
                            children: [
                              Expanded(
                                child: TextButton.icon(
                                  onPressed: reportList,
                                  icon: const Icon(Icons.list_alt),
                                  label: Text(
                                    widget.reportsLoading
                                        ? 'Consultando…'
                                        : '${widget.reports.length} novedades',
                                  ),
                                ),
                              ),
                              IconButton(
                                tooltip: 'Reportar novedad',
                                onPressed: graph == null
                                    ? null
                                    : widget.onReport,
                                icon: const Icon(
                                  Icons.add_location_alt_outlined,
                                ),
                              ),
                            ],
                          ),
                        ] else ...[
                          if (available)
                            Text(
                              flood
                                  ? '${view!.evacuated} evacuados · ${view.agents.length - view.evacuated} restantes · ${view.isolated} aislados'
                                  : '${view!.evacuated} evacuados · ${view.world?.metrics.active ?? 0} activos · ${view.world?.metrics.bitten ?? 0} mordidos · ${view.world?.zombies.length ?? 0} zombis',
                              style: const TextStyle(fontSize: 12),
                            ),
                          Text(
                            flood
                                ? 'Rojo: cierre · Ámbar: precaución · ⌂ Refugios'
                                : '♙ Supervivientes · ☠ Amenazas · ⌂ Refugios',
                            style: const TextStyle(fontSize: 11),
                          ),
                          if (view != null && graph != null && available)
                            TextButton.icon(
                              onPressed: () => agents(view, graph),
                              icon: const Icon(Icons.people_outline),
                              label: const Text('Supervivientes y rutas'),
                            ),
                          if (selected != null)
                            Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    'Ruta de ${selected.id}',
                                    style: const TextStyle(
                                      color: SpookyTokens.accent,
                                      fontSize: 12,
                                    ),
                                  ),
                                ),
                                IconButton(
                                  tooltip: 'Quitar ruta seleccionada',
                                  onPressed: () =>
                                      setState(() => selectedId = ''),
                                  icon: const Icon(Icons.close, size: 18),
                                ),
                              ],
                            ),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      );
    },
  );
}

class _HUD extends StatelessWidget {
  const _HUD({required this.children});
  final List<Widget> children;
  @override
  Widget build(BuildContext context) => Material(
    color: SpookyTokens.surface,
    borderRadius: BorderRadius.circular(12),
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: children,
      ),
    ),
  );
}
