import 'package:flutter/material.dart';

import 'tokens.g.dart';

ThemeData buildSpookyTheme() {
  final colors = const ColorScheme.dark(
    primary: SpookyTokens.primary,
    onPrimary: SpookyTokens.background,
    secondary: SpookyTokens.secondary,
    onSecondary: SpookyTokens.textPrimary,
    tertiary: SpookyTokens.accent,
    surface: SpookyTokens.surface,
    onSurface: SpookyTokens.textPrimary,
    onSurfaceVariant: SpookyTokens.textSecondary,
    error: SpookyTokens.error,
    outline: SpookyTokens.border,
  );
  final base = ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,
    colorScheme: colors,
    scaffoldBackgroundColor: SpookyTokens.background,
    fontFamily: SpookyTokens.fontFamilySans,
  );
  final border = OutlineInputBorder(
    borderRadius: BorderRadius.circular(SpookyTokens.radiusMd),
    borderSide: const BorderSide(color: SpookyTokens.border),
  );
  return base.copyWith(
    textTheme: base.textTheme.copyWith(
      headlineLarge: base.textTheme.headlineLarge?.copyWith(
        fontWeight: FontWeight.w800,
        letterSpacing: -1.2,
      ),
      headlineSmall: base.textTheme.headlineSmall?.copyWith(
        fontWeight: FontWeight.w700,
        letterSpacing: -.5,
      ),
      titleLarge: base.textTheme.titleLarge?.copyWith(
        fontWeight: FontWeight.w700,
      ),
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: SpookyTokens.background,
      surfaceTintColor: Colors.transparent,
      centerTitle: false,
    ),
    cardTheme: CardThemeData(
      color: SpookyTokens.surface,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(SpookyTokens.radiusLg),
        side: const BorderSide(color: SpookyTokens.border),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: SpookyTokens.surface,
      border: border,
      enabledBorder: border,
      focusedBorder: border.copyWith(
        borderSide: const BorderSide(color: SpookyTokens.primary, width: 2),
      ),
      contentPadding: const EdgeInsets.all(SpookyTokens.spacing4),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(48, 48),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(SpookyTokens.radiusMd),
        ),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(minimumSize: const Size(48, 48)),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: SpookyTokens.surface,
      indicatorColor: SpookyTokens.primary.withValues(alpha: .16),
      labelTextStyle: WidgetStateProperty.resolveWith(
        (states) => TextStyle(
          fontSize: 11,
          fontWeight: states.contains(WidgetState.selected)
              ? FontWeight.w700
              : FontWeight.w400,
          color: states.contains(WidgetState.selected)
              ? SpookyTokens.primary
              : SpookyTokens.textSecondary,
        ),
      ),
    ),
    dividerTheme: const DividerThemeData(color: SpookyTokens.border),
  );
}
