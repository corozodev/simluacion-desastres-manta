class ApiConfig {
  ApiConfig({
    required this.baseUrl,
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
        'WORLD_API_BASE_URL debe ser una URL HTTP(S) sin secretos.',
      );
    }
    if (timeout.inMilliseconds < 1) {
      throw ArgumentError('API_TIMEOUT_MS debe ser mayor que cero.');
    }
  }

  factory ApiConfig.fromEnvironment() => ApiConfig(
    baseUrl: const String.fromEnvironment(
      'WORLD_API_BASE_URL',
      defaultValue: 'https://api.sistemamanta.lexinnovate.com',
    ).replaceFirst(RegExp(r'/+$'), ''),
    timeout: const Duration(
      milliseconds: int.fromEnvironment('API_TIMEOUT_MS', defaultValue: 10000),
    ),
  );

  factory ApiConfig.incidentsFromEnvironment() => ApiConfig(
    baseUrl: const String.fromEnvironment(
      'INCIDENTS_API_BASE_URL',
      defaultValue: String.fromEnvironment(
        'WORLD_API_BASE_URL',
        defaultValue: 'https://api.sistemamanta.lexinnovate.com',
      ),
    ).replaceFirst(RegExp(r'/+$'), ''),
    timeout: const Duration(
      milliseconds: int.fromEnvironment('API_TIMEOUT_MS', defaultValue: 10000),
    ),
  );

  factory ApiConfig.floodFromEnvironment() => ApiConfig(
    baseUrl: const String.fromEnvironment(
      'FLOOD_API_BASE_URL',
      defaultValue: String.fromEnvironment(
        'WORLD_API_BASE_URL',
        defaultValue: 'https://api.sistemamanta.lexinnovate.com',
      ),
    ).replaceFirst(RegExp(r'/+$'), ''),
  );

  final String baseUrl;
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
