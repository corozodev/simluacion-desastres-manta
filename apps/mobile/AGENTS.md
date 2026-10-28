# Flutter

Lee las reglas de la raíz. Usa Flutter Material 3, Riverpod 3, GoRouter y Dio.
`lib/core/api/generated/models.dart`, `lib/core/theme/tokens.g.dart` y
`lib/core/theme/brand.g.dart` y `android/app/src/main/res/values/brand.xml` son
generados desde las fuentes compartidas: no editarlos.

Los widgets consumen proveedores y repositorios; los fixtures solo pertenecen a
pruebas. `ApiConfig` lee `--dart-define`; una URL nunca debe incluir credenciales,
query o fragmentos. El interceptor de desarrollo registra solo método, estado y
duración. Conserva el envelope y request ID al traducir errores HTTP.

Ejecuta `flutter pub get`, `flutter analyze`, `flutter test` y `flutter build apk --debug`. Formatea sólo Dart manual, no archivos generados. Mantén `pubspec.lock`; no ejecutar `flutter upgrade` ni inicializar Git.

`/escape` es la entrada ciudadana entre zombis e inundaciones. `SpectatorRepository` observa publicados; `WorldRepository` y `/estado` quedan sólo para compatibilidad/pruebas. Las decisiones y credenciales de `/paso` permanecen fuera del cliente. `WORLD_API_BASE_URL` selecciona explícitamente una instancia Go y usa HTTPS de producción por defecto. Android sólo permite HTTP en debug. La integración usa `RUN_WORLD_HTTP_TESTS=true` y `test/world_http_integration_test.dart`.

Conservar geometría real, ruta seleccionada, refugios ficticios y reservas. La envolvente de referencia no es límite oficial ni cobertura vial completa. Los datos sintéticos y dobles de transporte pertenecen únicamente a pruebas.

## FASE 7 móvil autorizada

El prompt móvil posterior sustituye la entrada única legacy: `/escape` conserva su URL y ahora contiene navegación ciudadana entre zombis e inundaciones. `SpectatorRepository` observa `/v1/simulations/published/zombie_outbreak` y `/lab/published`, con geografía cacheada separadamente. No iniciar ni controlar motores desde Flutter. El mapa ciudadano, la referencia histórica SNGR y las novedades permanecen independientes de los overlays sintéticos. Suspender polling/rendering al ocultar apartados o pasar a segundo plano. El repositorio `/estado` sólo se conserva para compatibilidad y pruebas legacy, fuera del flujo actual.
