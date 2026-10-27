import 'package:flutter/material.dart';

import '../core/api/api_failure.dart';
import '../core/theme/tokens.g.dart';

class PageHeader extends StatelessWidget {
  const PageHeader({super.key, required this.title, required this.subtitle});
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: SpookyTokens.spacing6),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: SpookyTokens.spacing2),
        Text(
          subtitle,
          style: const TextStyle(color: SpookyTokens.textSecondary),
        ),
      ],
    ),
  );
}

class PageContent extends StatelessWidget {
  const PageContent({super.key, required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => SingleChildScrollView(
    padding: const EdgeInsets.all(SpookyTokens.spacing6),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: children,
    ),
  );
}

class LoadingState extends StatelessWidget {
  const LoadingState({super.key});

  @override
  Widget build(BuildContext context) => const Padding(
    padding: EdgeInsets.all(SpookyTokens.spacing8),
    child: Center(
      child: Column(
        children: [
          CircularProgressIndicator(semanticsLabel: 'Cargando datos'),
          SizedBox(height: SpookyTokens.spacing4),
          Text('Cargando datos…'),
        ],
      ),
    ),
  );
}

class EmptyState extends StatelessWidget {
  const EmptyState({super.key});

  @override
  Widget build(BuildContext context) => const Card(
    child: Padding(
      padding: EdgeInsets.all(SpookyTokens.spacing8),
      child: Column(
        children: [
          Icon(
            Icons.search_off_rounded,
            size: 40,
            color: SpookyTokens.secondary,
          ),
          SizedBox(height: SpookyTokens.spacing4),
          Text('Sin resultados'),
          SizedBox(height: SpookyTokens.spacing2),
          Text(
            'Prueba con otro término de búsqueda.',
            textAlign: TextAlign.center,
            style: TextStyle(color: SpookyTokens.textSecondary),
          ),
        ],
      ),
    ),
  );
}

class ErrorState extends StatelessWidget {
  const ErrorState({super.key, required this.error, required this.onRetry});
  final Object error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final failure = error is ApiFailure ? error as ApiFailure : null;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(SpookyTokens.spacing6),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Icon(Icons.cloud_off_rounded, color: SpookyTokens.error),
            const SizedBox(height: SpookyTokens.spacing3),
            Text(
              failure?.message ?? 'No se pudieron cargar los datos.',
              style: Theme.of(context).textTheme.titleSmall,
            ),
            if (failure?.requestId != null) ...[
              const SizedBox(height: SpookyTokens.spacing2),
              SelectableText(
                'Request ID: ${failure!.requestId}',
                style: const TextStyle(
                  color: SpookyTokens.textSecondary,
                  fontSize: 12,
                ),
              ),
            ],
            const SizedBox(height: SpookyTokens.spacing4),
            OutlinedButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('Reintentar'),
            ),
          ],
        ),
      ),
    );
  }
}
