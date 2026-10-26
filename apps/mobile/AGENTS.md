# Flutter

Lee las reglas de la raíz. Usa Flutter Material 3, Riverpod 3, GoRouter y Dio.
`lib/core/api/generated/models.dart`, `lib/core/theme/tokens.g.dart` y
`lib/core/theme/brand.g.dart` y `android/app/src/main/res/values/brand.xml` son
generados desde las fuentes compartidas: no editarlos.

Los widgets consumen proveedores y repositorios; los fixtures solo pertenecen a
pruebas. `ApiConfig` lee `--dart-define`; una URL nunca debe incluir credenciales,
query o fragmentos. El interceptor de desarrollo registra solo método, estado y
duración. Conserva el envelope y request ID al traducir errores HTTP.

Ejecuta `flutter pub get`, `flutter analyze`, `flutter test` y
`flutter build apk --debug`. Formatea solo los archivos Dart manuales; no pases
`dart format` sobre los archivos generados. La integración
HTTP real se ejecuta con `flutter test --dart-define=RUN_HTTP_TESTS=true
test/http_integration_test.dart`, con la API en localhost:3001. Mantén
`pubspec.lock`. No ejecutar `flutter upgrade` ni inicializar Git.

Android permite HTTP exclusivamente en debug. Una URL de API Gateway requiere
HTTPS y `API_MODE=remote`. No añadir configuración de firma real o secretos.

Track A: `/escape` consume `WorldRepository` y `worldProvider`. `WORLD_API_BASE_URL` es una URL pública de observación; si se omite, usa la API demo existente. Reutiliza `http_request.dart` para traducir errores; no dupliques envelopes ni añadas API keys. La prueba `world_http_integration_test.dart` se habilita con `RUN_WORLD_HTTP_TESTS=true` y la URL del backend Go. No requiere credenciales de movimiento.

FASE 2: `route_map.dart` dibuja calles y una ruta seleccionada con DTOs generados, sin nuevas dependencias cartográficas. No convertir la envolvente urbana en supuesto límite oficial ni filtrar sleepers dormidos. Mostrar refugios ficticios, reservas, asignación y siguiente nodo. La salud de Escape depende del mundo observado; las demos mantienen su repositorio previo.
