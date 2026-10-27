import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../core/theme/app_theme.dart';
import '../core/theme/brand.g.dart';
import '../features/escape/escape_screen.dart';
import 'app_shell.dart';

GoRouter createRouter({String initialLocation = '/escape'}) => GoRouter(
  initialLocation: initialLocation,
  redirect: (context, state) => state.uri.path == '/escape' ? null : '/escape',
  routes: [
    ShellRoute(
      builder: (context, state, child) => AppShell(child: child),
      routes: [
        GoRoute(
          path: '/escape',
          builder: (context, state) => const EscapeScreen(),
        ),
      ],
    ),
  ],
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
    title: '${AppBrand.webName} — ${AppBrand.team}',
    debugShowCheckedModeBanner: false,
    theme: buildSpookyTheme(),
    routerConfig: _router,
  );
}
