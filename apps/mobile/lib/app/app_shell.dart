import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/providers.dart';
import '../core/theme/brand.g.dart';
import '../core/theme/tokens.g.dart';

class AppShell extends ConsumerWidget {
  const AppShell({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final location = GoRouterState.of(context).uri.path;
    final world = location.startsWith('/escape')
        ? ref.watch(worldProvider)
        : null;
    final health = world == null ? ref.watch(healthProvider) : null;
    final connected = world != null
        ? world.hasValue && !world.hasError
        : health?.asData?.value.status == 'ok';
    final loading = world?.isLoading ?? health!.isLoading;
    final status = loading
        ? 'Comprobando API'
        : connected
        ? 'API conectada'
        : 'API sin conexión';
    final paths = ['/', '/items', '/demo', '/diagnostics', '/escape'];
    final selected = location.startsWith('/escape')
        ? 4
        : location.startsWith('/items')
        ? 1
        : location.startsWith('/demo')
        ? 2
        : location.startsWith('/diagnostics')
        ? 3
        : 0;
    return Scaffold(
      appBar: AppBar(
        leading: location.startsWith('/items/')
            ? IconButton(
                onPressed: () => context.go('/items'),
                tooltip: 'Volver a elementos',
                icon: const Icon(Icons.arrow_back_rounded),
              )
            : const Padding(
                padding: EdgeInsets.only(left: SpookyTokens.spacing4),
                child: Icon(
                  Icons.cloud_outlined,
                  color: SpookyTokens.primary,
                  size: 30,
                ),
              ),
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              AppBrand.team,
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
            ),
            Text(
              AppBrand.name,
              style: const TextStyle(
                color: SpookyTokens.textSecondary,
                fontSize: 11,
              ),
            ),
          ],
        ),
        actions: [
          IconButton(
            onPressed: () => context.go('/diagnostics'),
            tooltip: status,
            icon: Icon(
              connected ? Icons.wifi_rounded : Icons.wifi_off_rounded,
              size: 21,
              color: loading
                  ? SpookyTokens.textSecondary
                  : connected
                  ? SpookyTokens.success
                  : SpookyTokens.error,
            ),
          ),
          const SizedBox(width: SpookyTokens.spacing2),
        ],
      ),
      body: SafeArea(
        child: Align(
          alignment: Alignment.topCenter,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 760),
            child: child,
          ),
        ),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: selected,
        onDestinationSelected: (index) => context.go(paths[index]),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.space_dashboard_outlined),
            selectedIcon: Icon(Icons.space_dashboard_rounded),
            label: 'Inicio',
          ),
          NavigationDestination(
            icon: Icon(Icons.layers_outlined),
            selectedIcon: Icon(Icons.layers_rounded),
            label: 'Elementos',
          ),
          NavigationDestination(
            icon: Icon(Icons.add_box_outlined),
            selectedIcon: Icon(Icons.add_box_rounded),
            label: 'Demo',
          ),
          NavigationDestination(
            icon: Icon(Icons.tune_outlined),
            selectedIcon: Icon(Icons.tune_rounded),
            label: 'Diagnóstico',
          ),
          NavigationDestination(
            icon: Icon(Icons.map_outlined),
            selectedIcon: Icon(Icons.map_rounded),
            label: 'Escape',
          ),
        ],
      ),
    );
  }
}
