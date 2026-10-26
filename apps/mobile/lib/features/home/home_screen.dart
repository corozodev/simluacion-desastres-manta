import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/providers.dart';
import '../../core/theme/brand.g.dart';
import '../../core/theme/tokens.g.dart';
import '../../shared/widgets.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    const query = (page: 1, q: '');
    final items = ref.watch(itemsProvider(query));
    final config = ref.watch(apiConfigProvider);
    return PageContent(
      children: [
        Container(
          padding: const EdgeInsets.all(SpookyTokens.spacing6),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(SpookyTokens.radiusXl),
            border: Border.all(color: SpookyTokens.border),
            gradient: LinearGradient(
              begin: Alignment.topRight,
              end: Alignment.bottomLeft,
              colors: [
                SpookyTokens.secondary.withValues(alpha: .17),
                SpookyTokens.surface,
              ],
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Row(
                children: [
                  Icon(
                    Icons.bolt_rounded,
                    color: SpookyTokens.primary,
                    size: 18,
                  ),
                  SizedBox(width: SpookyTokens.spacing2),
                  Expanded(
                    child: Text(
                      AppBrand.subtitle,
                      style: TextStyle(
                        color: SpookyTokens.primary,
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: SpookyTokens.spacing5),
              Text(
                AppBrand.overviewTitle,
                style: Theme.of(context).textTheme.headlineLarge,
              ),
              const SizedBox(height: SpookyTokens.spacing3),
              const Text(
                AppBrand.description,
                style: TextStyle(
                  color: SpookyTokens.textSecondary,
                  height: 1.6,
                ),
              ),
              const SizedBox(height: SpookyTokens.spacing6),
              FilledButton.icon(
                onPressed: () => context.go('/demo'),
                icon: const Icon(Icons.add_rounded),
                label: const Text('Probar formulario'),
              ),
            ],
          ),
        ),
        const SizedBox(height: SpookyTokens.spacing5),
        Row(
          children: [
            Expanded(
              child: _SummaryCard(
                label: 'Registros de prueba',
                value: items.asData?.value.pagination.total.toString() ?? '—',
                icon: Icons.layers_outlined,
                color: SpookyTokens.accent,
              ),
            ),
            const SizedBox(width: SpookyTokens.spacing3),
            Expanded(
              child: _SummaryCard(
                label: 'Modo de API',
                value: config.mode.toUpperCase(),
                icon: Icons.cloud_outlined,
                color: SpookyTokens.secondary,
              ),
            ),
          ],
        ),
        const SizedBox(height: SpookyTokens.spacing7),
        Row(
          children: [
            Expanded(
              child: Text(
                'Explora la base',
                style: Theme.of(context).textTheme.titleLarge,
              ),
            ),
            TextButton(
              onPressed: () => context.go('/items'),
              child: const Text('Ver todos'),
            ),
          ],
        ),
        const SizedBox(height: SpookyTokens.spacing3),
        items.when(
          data: (result) => result.data.isEmpty
              ? const EmptyState()
              : Column(
                  children: [
                    for (final item in result.data.take(3))
                      ItemCard(item: item),
                  ],
                ),
          loading: () => const LoadingState(),
          error: (error, _) => ErrorState(
            error: error,
            onRetry: () => ref.invalidate(itemsProvider(query)),
          ),
        ),
        const SizedBox(height: SpookyTokens.spacing4),
        const Text(
          'Datos de demostración · Sin conexión a servicios de AWS',
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 11, color: SpookyTokens.textSecondary),
        ),
      ],
    );
  }
}

class _SummaryCard extends StatelessWidget {
  const _SummaryCard({
    required this.label,
    required this.value,
    required this.icon,
    required this.color,
  });
  final String label;
  final String value;
  final IconData icon;
  final Color color;

  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(SpookyTokens.spacing4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: color, size: 22),
          const SizedBox(height: SpookyTokens.spacing3),
          Text(value, style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: SpookyTokens.spacing1),
          Text(
            label,
            style: const TextStyle(
              color: SpookyTokens.textSecondary,
              fontSize: 12,
            ),
          ),
        ],
      ),
    ),
  );
}
