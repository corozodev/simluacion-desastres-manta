import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../core/theme/brand.g.dart';
import '../../core/theme/tokens.g.dart';
import '../../shared/widgets.dart';

class DiagnosticsScreen extends ConsumerWidget {
  const DiagnosticsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final config = ref.watch(apiConfigProvider);
    final health = ref.watch(healthProvider);
    return PageContent(
      children: [
        const PageHeader(
          title: 'Diagnóstico',
          subtitle: 'La información de conexión de este cliente.',
        ),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(SpookyTokens.spacing6),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _DiagnosticRow(label: 'Modo de API', value: config.mode),
                _DiagnosticRow(
                  label: 'URL base efectiva',
                  value: config.displayUrl,
                ),
                const _DiagnosticRow(
                  label: 'Versión del cliente',
                  value: AppBrand.version,
                ),
                _DiagnosticRow(
                  label: 'Timeout',
                  value: '${config.timeout.inMilliseconds} ms',
                ),
                _DiagnosticRow(
                  label: 'Conectividad',
                  value: health.isLoading
                      ? 'Comprobando…'
                      : health.asData?.value.status == 'ok'
                      ? 'API conectada'
                      : 'API sin conexión',
                ),
                if (health.asData?.value case final response?) ...[
                  _DiagnosticRow(label: 'Servicio', value: response.service),
                  _DiagnosticRow(
                    label: 'Versión de API',
                    value: response.version,
                  ),
                ],
                OutlinedButton.icon(
                  onPressed: health.isLoading
                      ? null
                      : () => ref.invalidate(healthProvider),
                  icon: const Icon(Icons.refresh_rounded),
                  label: const Text('Comprobar conexión'),
                ),
              ],
            ),
          ),
        ),
        if (health.hasError) ...[
          const SizedBox(height: SpookyTokens.spacing4),
          ErrorState(
            error: health.error!,
            onRetry: () => ref.invalidate(healthProvider),
          ),
        ],
      ],
    );
  }
}

class _DiagnosticRow extends StatelessWidget {
  const _DiagnosticRow({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: SpookyTokens.spacing5),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(color: SpookyTokens.textSecondary)),
        const SizedBox(height: SpookyTokens.spacing2),
        SelectableText(value),
      ],
    ),
  );
}
