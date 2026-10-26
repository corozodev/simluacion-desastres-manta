import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../core/theme/app_theme.dart';
import '../core/theme/brand.g.dart';
import '../features/demo/demo_form_screen.dart';
import '../features/diagnostics/diagnostics_screen.dart';
import '../features/home/home_screen.dart';
import '../features/escape/escape_screen.dart';
import '../features/items/item_detail_screen.dart';
import '../features/items/items_screen.dart';
import 'app_shell.dart';

GoRouter createRouter({String initialLocation = '/'}) => GoRouter(
  initialLocation: initialLocation,
  routes: [
    ShellRoute(
      builder: (context, state, child) => AppShell(child: child),
      routes: [
        GoRoute(path: '/', builder: (context, state) => const HomeScreen()),
        GoRoute(
          path: '/escape',
          builder: (context, state) => const EscapeScreen(),
        ),
        GoRoute(
          path: '/items',
          builder: (context, state) => const ItemsScreen(),
          routes: [
            GoRoute(
              path: ':id',
              builder: (context, state) =>
                  ItemDetailScreen(id: state.pathParameters['id']!),
            ),
          ],
        ),
        GoRoute(
          path: '/demo',
          builder: (context, state) => const DemoFormScreen(),
        ),
        GoRoute(
          path: '/diagnostics',
          builder: (context, state) => const DiagnosticsScreen(),
        ),
      ],
    ),
  ],
  errorBuilder: (context, state) => Scaffold(
    body: Center(
      child: FilledButton(
        onPressed: () => context.go('/'),
        child: const Text('Ir al inicio'),
      ),
    ),
  ),
);

class SpookyApp extends StatefulWidget {
  const SpookyApp({super.key, this.router});
  final GoRouter? router;

  @override
  State<SpookyApp> createState() => _SpookyAppState();
}

class _SpookyAppState extends State<SpookyApp> {
  late final GoRouter _router = widget.router ?? createRouter();

  @override
  void dispose() {
    if (widget.router == null) _router.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => MaterialApp.router(
    title: '${AppBrand.team} — ${AppBrand.name}',
    debugShowCheckedModeBanner: false,
    theme: buildSpookyTheme(),
    routerConfig: _router,
  );
}
