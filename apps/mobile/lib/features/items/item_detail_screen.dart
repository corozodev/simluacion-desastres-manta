import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../core/theme/tokens.g.dart';
import '../../shared/widgets.dart';

class ItemDetailScreen extends ConsumerWidget {
  const ItemDetailScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) => PageContent(
    children: [
      const PageHeader(
        title: 'Detalle del elemento',
        subtitle: 'Una vista del registro según el contrato compartido.',
      ),
      ref
          .watch(itemProvider(id))
          .when(
            loading: () => const LoadingState(),
            error: (error, _) => ErrorState(
              error: error,
              onRetry: () => ref.invalidate(itemProvider(id)),
            ),
            data: (item) => Card(
              child: Padding(
                padding: const EdgeInsets.all(SpookyTokens.spacing6),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    StatusBadge(status: item.status),
                    const SizedBox(height: SpookyTokens.spacing5),
                    Text(
                      item.title,
                      style: Theme.of(context).textTheme.headlineSmall,
                    ),
                    const SizedBox(height: SpookyTokens.spacing4),
                    Text(item.description, style: const TextStyle(height: 1.6)),
                    const SizedBox(height: SpookyTokens.spacing6),
                    const Divider(),
                    const SizedBox(height: SpookyTokens.spacing4),
                    const Text(
                      'IDENTIFICADOR',
                      style: TextStyle(
                        fontSize: 11,
                        color: SpookyTokens.textSecondary,
                      ),
                    ),
                    const SizedBox(height: SpookyTokens.spacing2),
                    SelectableText(item.id),
                    const SizedBox(height: SpookyTokens.spacing5),
                    const Text(
                      'FECHA DE EJEMPLO',
                      style: TextStyle(
                        fontSize: 11,
                        color: SpookyTokens.textSecondary,
                      ),
                    ),
                    const SizedBox(height: SpookyTokens.spacing2),
                    SelectableText(item.createdAt),
                    const SizedBox(height: SpookyTokens.spacing3),
                    const Text(
                      'Fecha fija del fixture de demostración.',
                      style: TextStyle(
                        fontSize: 12,
                        color: SpookyTokens.textSecondary,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
    ],
  );
}
