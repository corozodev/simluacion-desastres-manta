import 'package:flutter/foundation.dart';

class ApiConfig {
  ApiConfig({
    required this.baseUrl,
    this.mode = 'mock',
    this.timeout = const Duration(seconds: 10),
  }) {
    final uri = Uri.tryParse(baseUrl);
    if (uri == null ||
        !const ['http', 'https'].contains(uri.scheme) ||
        uri.host.isEmpty ||
        uri.userInfo.isNotEmpty ||
        uri.hasQuery ||
        uri.hasFragment) {
      throw ArgumentError(
        'API_BASE_URL debe ser una URL HTTP(S) sin secretos.',
      );
    }
    if (!const ['mock', 'remote'].contains(mode)) {
      throw ArgumentError('API_MODE debe ser mock o remote.');
    }
    if (timeout.inMilliseconds < 1) {
      throw ArgumentError('API_TIMEOUT_MS debe ser mayor que cero.');
    }
  }

  factory ApiConfig.fromEnvironment() {
    const configuredUrl = String.fromEnvironment('API_BASE_URL');
    final android = !kIsWeb && defaultTargetPlatform == TargetPlatform.android;
    return ApiConfig(
      baseUrl: configuredUrl.isEmpty
          ? (android ? 'http://10.0.2.2:3001' : 'http://localhost:3001')
          : configuredUrl.replaceFirst(RegExp(r'/+$'), ''),
      mode: const String.fromEnvironment('API_MODE', defaultValue: 'mock'),
      timeout: const Duration(
        milliseconds: int.fromEnvironment(
          'API_TIMEOUT_MS',
          defaultValue: 10000,
        ),
      ),
    );
  }

  final String baseUrl;
  final String mode;
  final Duration timeout;

  String get displayUrl {
    final uri = Uri.parse(baseUrl);
    return Uri(
      scheme: uri.scheme,
      host: uri.host,
      port: uri.hasPort ? uri.port : null,
      path: uri.path,
    ).toString();
  }
}
