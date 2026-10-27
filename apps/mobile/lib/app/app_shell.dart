import 'package:flutter/material.dart';
import '../core/theme/tokens.g.dart';
import '../core/theme/brand.g.dart';

class AppShell extends StatelessWidget {
  const AppShell({super.key, required this.child});
  final Widget child;
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      toolbarHeight: 44,
      title: const Text(
        '${AppBrand.webName} · ${AppBrand.team}',
        style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
      ),
      leading: const Icon(Icons.map_outlined, color: SpookyTokens.accent),
    ),
    body: SafeArea(child: child),
  );
}
