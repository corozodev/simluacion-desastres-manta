# Flutter — Escape de Manta

Cliente Material 3 con Riverpod, GoRouter y Dio para la API Go. Sólo existe `/escape`; el inicio y los enlaces anteriores redirigen a esa pantalla. Conserva tema, mapa, rutas, refugios, búsqueda y estado de conexión.

La URL predeterminada es `https://api.sistemamanta.lexinnovate.com`. Para seleccionar una instancia Go explícita:

```sh
flutter pub get
flutter run --dart-define=WORLD_API_BASE_URL=https://api.sistemamanta.lexinnovate.com
# Go local accesible desde el emulador Android:
flutter run --dart-define=WORLD_API_BASE_URL=http://10.0.2.2:8080
flutter analyze
flutter test
flutter build apk --debug
```

La configuración rechaza credenciales, query y fragmentos. No existen modos de transporte alternativos ni API keys en Flutter. Android permite HTTP únicamente en debug; producción usa HTTPS. Flutter web requiere que la instancia Go autorice expresamente el origen del navegador mediante CORS.

`WorldRepository` consume `/healthz`, `/grafo` y `/estado`. El simulador conserva `/paso` privado. La observación se actualiza cada dos segundos y al finalizar la simulación permanece el último estado; un mapa inmóvil no equivale por sí solo a desconexión.

```sh
# Integración contra una instancia Go de desarrollo activa:
flutter test --dart-define=RUN_WORLD_HTTP_TESTS=true --dart-define=WORLD_API_BASE_URL=http://127.0.0.1:8080 test/world_http_integration_test.dart
# Desde la raíz, Go real y clientes:
FLUTTER_BIN=/ruta/flutter/bin/flutter npm run test:contracts:http -- --urban --browser --flutter
```

Los dobles HTTP y los datos sintéticos pertenecen sólo a las pruebas. Los DTOs, colores y marca son generados desde las fuentes compartidas; no editar los archivos generados. Los refugios son ficticios y la envolvente de referencia no representa cobertura vial completa.
