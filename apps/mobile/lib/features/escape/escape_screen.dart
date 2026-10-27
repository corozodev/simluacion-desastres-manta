import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/generated/models.dart';
import '../../core/providers.dart';
import '../../core/theme/tokens.g.dart';
import '../../shared/widgets.dart';
import 'route_map.dart';

class EscapeScreen extends ConsumerStatefulWidget {
  const EscapeScreen({super.key});

  @override
  ConsumerState<EscapeScreen> createState() => _EscapeScreenState();
}

class _EscapeScreenState extends ConsumerState<EscapeScreen> {
  String search = '';
  String selectedId = '';

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(worldProvider);
    final graph = ref.watch(worldGraphProvider);
    final matches =
        state.asData?.value.survivors
            .where((s) => s.id.toLowerCase().contains(search.toLowerCase()))
            .toList() ??
        <Survivor>[];
    Survivor? selected;
    for (final survivor in matches) {
      if (survivor.id.toLowerCase() == search.trim().toLowerCase() ||
          survivor.id == selectedId) {
        selected = survivor;
      }
    }
    if (matches.length == 1) selected = matches.first;
    return PageContent(
      children: [
        Text(
          'Escape de Manta Zombie',
          style: Theme.of(context).textTheme.headlineMedium,
        ),
        const SizedBox(height: SpookyTokens.spacing3),
        const Text(
          'Track A · Turnos, refugios y sobrevivientes. Actualización cada 2 segundos.',
          style: TextStyle(color: SpookyTokens.textSecondary),
        ),
        const SizedBox(height: SpookyTokens.spacing5),
        state.when(
          data: (world) => Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'Estado conectado',
                style: TextStyle(color: SpookyTokens.success),
              ),
              const SizedBox(height: SpookyTokens.spacing3),
              _Stats(world: world),
              const SizedBox(height: SpookyTokens.spacing5),
              Text(
                'Refugios ficticios',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const Text(
                'Puntos de simulación; no son instalaciones oficiales de emergencia.',
              ),
              for (final shelter in world.shelters)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(
                    Icons.home_outlined,
                    color: SpookyTokens.success,
                  ),
                  title: Text(shelter.id),
                  subtitle: Text(
                    '${shelter.reserved ?? 0} reservadas · ${shelter.available ?? (shelter.capacity - shelter.occupancy - (shelter.reserved ?? 0))} libres',
                  ),
                  trailing: Text('${shelter.occupancy} / ${shelter.capacity}'),
                ),
              const SizedBox(height: SpookyTokens.spacing4),
              graph.when(
                data: (value) => value.version == world.graphVersion
                    ? Column(
                        children: [
                          RouteMap(
                            graph: value,
                            world: world,
                            survivor: selected,
                          ),
                          const SizedBox(height: SpookyTokens.spacing2),
                          Text(
                            value.source,
                            style: const TextStyle(
                              fontSize: 10,
                              color: SpookyTokens.textSecondary,
                            ),
                          ),
                          const Text(
                            'Calles seleccionadas y envolvente de referencia urbana; no implica cobertura vial completa.',
                            style: TextStyle(
                              fontSize: 10,
                              color: SpookyTokens.textSecondary,
                            ),
                          ),
                          if (value.spawnZones?.isNotEmpty == true)
                            Text(
                              'Zonas de origen: ${value.spawnZones!.map((zone) => zone.name).join(' · ')}',
                              style: const TextStyle(
                                fontSize: 11,
                                color: SpookyTokens.textSecondary,
                              ),
                            ),
                        ],
                      )
                    : Column(
                        children: [
                          const Text(
                            'El grafo y el estado tienen versiones distintas.',
                          ),
                          TextButton(
                            onPressed: () => ref.invalidate(worldGraphProvider),
                            child: const Text('Actualizar grafo'),
                          ),
                        ],
                      ),
                loading: () => const LinearProgressIndicator(),
                error: (error, _) => ErrorState(
                  error: error,
                  onRetry: () => ref.invalidate(worldGraphProvider),
                ),
              ),
              const SizedBox(height: SpookyTokens.spacing4),
              TextField(
                key: const Key('survivor-search'),
                decoration: const InputDecoration(
                  labelText: 'Buscar sobreviviente por ID',
                  hintText: 'S-0001',
                  prefixIcon: Icon(Icons.search),
                ),
                onChanged: (value) => setState(() => search = value),
              ),
              const SizedBox(height: SpookyTokens.spacing4),
              if (selected != null)
                _SurvivorDetails(
                  survivor: selected,
                  graph: graph.asData?.value,
                  world: world,
                ),
              if (world.survivors
                  .where(
                    (s) => s.id.toLowerCase().contains(search.toLowerCase()),
                  )
                  .isEmpty)
                const EmptyState()
              else
                for (final survivor in world.survivors.where(
                  (s) => s.id.toLowerCase().contains(search.toLowerCase()),
                ))
                  Card(
                    child: ListTile(
                      onTap: () => setState(() => selectedId = survivor.id),
                      title: Text(survivor.id),
                      subtitle: Text(
                        'Nodo ${survivor.currentNode}\nRefugio: ${survivor.targetShelterId.isEmpty ? 'Sin asignación' : survivor.targetShelterId}',
                      ),
                      trailing: Text(
                        const {
                              'active': 'Activo',
                              'bitten': 'Mordido',
                              'evacuated': 'Evacuado',
                            }[survivor.status] ??
                            survivor.status,
                      ),
                    ),
                  ),
            ],
          ),
          loading: () => const LoadingState(),
          error: (error, _) => ErrorState(
            error: error,
            onRetry: () => ref.invalidate(worldProvider),
          ),
        ),
      ],
    );
  }
}

class _Stats extends StatelessWidget {
  const _Stats({required this.world});
  final WorldSnapshot world;

  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(SpookyTokens.spacing4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Turno ${world.turn}',
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: SpookyTokens.spacing3),
          Text(
            'Evacuados: ${world.metrics.evacuated} · Mordidos: ${world.metrics.bitten} · Activos: ${world.metrics.active}',
          ),
          const SizedBox(height: SpookyTokens.spacing2),
          Text(
            'Zombies visibles: ${world.zombies.length} · HTTP p95: ${world.metrics.httpP95Ms.toStringAsFixed(2)} ms',
            style: const TextStyle(color: SpookyTokens.textSecondary),
          ),
        ],
      ),
    ),
  );
}

class _SurvivorDetails extends StatelessWidget {
  const _SurvivorDetails({
    required this.survivor,
    required this.graph,
    required this.world,
  });
  final Survivor survivor;
  final Graph? graph;
  final WorldSnapshot world;

  @override
  Widget build(BuildContext context) {
    GraphNode? position;
    for (final node in graph?.nodes ?? <GraphNode>[]) {
      if (node.id == survivor.currentNode) position = node;
    }
    final next =
        survivor.plannedRoute
            .where((id) => id != survivor.currentNode)
            .firstOrNull ??
        survivor.currentNode;
    final warnings = graph == null
        ? <String>[]
        : routeWarnings(graph!, world, survivor);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(SpookyTokens.spacing4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Detalle de ${survivor.id}',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: SpookyTokens.spacing3),
            Text(
              'Posición: ${position == null ? survivor.currentNode : '${position.lat.toStringAsFixed(6)}, ${position.lng.toStringAsFixed(6)}'}',
            ),
            Text(
              'Refugio asignado: ${survivor.targetShelterId.isEmpty ? 'Sin asignación' : survivor.targetShelterId}',
            ),
            Text('Siguiente movimiento: $next'),
            Text(
              'Ruta publicada: ${survivor.plannedRoute.isEmpty ? 'Sin ruta publicada' : survivor.plannedRoute.join(' → ')}',
            ),
            if (survivor.spawnZoneId?.isNotEmpty == true)
              Text('Zona de origen: ${survivor.spawnZoneId}'),
            for (final warning in warnings)
              Text(warning, style: const TextStyle(color: SpookyTokens.error)),
          ],
        ),
      ),
    );
  }
}
