import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/providers.dart';
import '../core/theme/brand.g.dart';
import '../core/theme/tokens.g.dart';

class AppShell extends ConsumerWidget {
  const AppShell({super.key, required this.child});
  final Widget child;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final world = ref.watch(worldProvider);
    final connected = world.hasValue && !world.hasError;
    final status = world.isLoading
        ? 'Comprobando evacuación'
        : connected
        ? 'API evacuación conectada'
        : 'API evacuación sin conexión';
    return Scaffold(
      appBar: AppBar(
        leading: const Padding(
          padding: EdgeInsets.only(left: SpookyTokens.spacing4),
          child: Icon(
            Icons.map_outlined,
            color: SpookyTokens.primary,
            size: 30,
          ),
        ),
        title: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              AppBrand.team,
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
            ),
            Text(
              AppBrand.name,
              style: TextStyle(color: SpookyTokens.textSecondary, fontSize: 11),
            ),
          ],
        ),
        actions: [
          Tooltip(
            message: status,
            child: Icon(
              connected ? Icons.wifi_rounded : Icons.wifi_off_rounded,
              size: 21,
              color: world.isLoading
                  ? SpookyTokens.textSecondary
                  : connected
                  ? SpookyTokens.success
                  : SpookyTokens.error,
            ),
          ),
          const SizedBox(width: SpookyTokens.spacing4),
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
    );
  }
}
