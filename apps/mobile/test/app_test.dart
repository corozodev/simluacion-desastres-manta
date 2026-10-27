import 'package:corodev_spooky/core/theme/app_theme.dart';
import 'package:corodev_spooky/core/theme/tokens.g.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('theme preserves shared colors and Material 3', () {
    final theme = buildSpookyTheme();
    expect(theme.useMaterial3, isTrue);
    expect(theme.brightness, Brightness.dark);
    expect(theme.colorScheme.primary, SpookyTokens.primary);
    expect(theme.scaffoldBackgroundColor, SpookyTokens.background);
  });
}
