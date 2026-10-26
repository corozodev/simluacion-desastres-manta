import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../core/theme/tokens.g.dart';
import '../../shared/widgets.dart';

class ItemsScreen extends ConsumerStatefulWidget {
  const ItemsScreen({super.key});

  @override
  ConsumerState<ItemsScreen> createState() => _ItemsScreenState();
}

class _ItemsScreenState extends ConsumerState<ItemsScreen> {
  final _search = TextEditingController();
  Timer? _debounce;
  int _page = 1;
  String _query = '';

  void _applySearch(String value) {
    _debounce?.cancel();
    setState(() {
      _query = value.trim();
      _page = 1;
    });
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final query = (page: _page, q: _query);
    final result = ref.watch(itemsProvider(query));
    return PageContent(
      children: [
        const PageHeader(
          title: 'Elementos',
          subtitle: 'Registros genéricos para explorar el flujo completo.',
        ),
        TextField(
          key: const Key('items-search'),
          controller: _search,
          maxLength: 100,
          textInputAction: TextInputAction.search,
          decoration: InputDecoration(
            labelText: 'Buscar elementos',
            hintText: 'Título o descripción',
            counterText: '',
            prefixIcon: const Icon(Icons.search_rounded),
            suffixIcon: IconButton(
              tooltip: 'Limpiar búsqueda',
              onPressed: () {
                _search.clear();
                _applySearch('');
              },
              icon: const Icon(Icons.close_rounded),
            ),
          ),
          onChanged: (value) {
            _debounce?.cancel();
            _debounce = Timer(
              const Duration(milliseconds: 350),
              () => _applySearch(value),
            );
          },
          onSubmitted: _applySearch,
        ),
        const SizedBox(height: SpookyTokens.spacing5),
        result.when(
          loading: () => const LoadingState(),
          error: (error, _) => ErrorState(
            error: error,
            onRetry: () => ref.invalidate(itemsProvider(query)),
          ),
          data: (response) {
            if (response.data.isEmpty) return const EmptyState();
            final pagination = response.pagination;
            final pages = (pagination.total / pagination.pageSize).ceil();
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  '${pagination.total} registros · Página ${pagination.page} de $pages',
                  style: const TextStyle(color: SpookyTokens.textSecondary),
                ),
                const SizedBox(height: SpookyTokens.spacing4),
                for (final item in response.data) ItemCard(item: item),
                const SizedBox(height: SpookyTokens.spacing3),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    OutlinedButton.icon(
                      onPressed: _page > 1
                          ? () => setState(() => _page--)
                          : null,
                      icon: const Icon(Icons.chevron_left_rounded),
                      label: const Text('Anterior'),
                    ),
                    OutlinedButton.icon(
                      onPressed: _page < pages
                          ? () => setState(() => _page++)
                          : null,
                      icon: const Icon(Icons.chevron_right_rounded),
                      label: const Text('Siguiente'),
                    ),
                  ],
                ),
              ],
            );
          },
        ),
      ],
    );
  }
}
