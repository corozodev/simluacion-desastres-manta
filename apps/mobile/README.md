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

## Novedades ciudadanas — FASE 4C

El botón **Nueva novedad** abre el formulario desde la pantalla del mapa. Permite colocar el marcador sobre el mismo mapa OSM o escribir coordenadas, seleccionar tipo, transitabilidad y severidad observadas, describir lo ocurrido y ajustar su fecha declarada. **Revisar reporte** consulta el área operativa y comprueba la asociación vial en Go; si existen varias calles cercanas, exige seleccionar una. El servidor vuelve a validar la asociación al guardar. **Confirmar envío** crea un reporte de procedencia ciudadana y estado pendiente. La recepción y su fecha en el servidor no certifican la observación ni ofrecen navegación de emergencia.

La configuración `INCIDENTS_API_BASE_URL` permite elegir la API de novedades por separado. Su valor predeterminado es `WORLD_API_BASE_URL`, o la misma URL HTTPS de producción cuando no se especifica ninguna. Una API anterior sin esta capacidad mostrará su error de recepción y conservará el borrador. El laboratorio de desarrollo se escucha en loopback y valida el Host; para un Android conectado por ADB:

```sh
adb reverse tcp:8080 tcp:8080
adb reverse tcp:8082 tcp:8082
flutter run --dart-define=WORLD_API_BASE_URL=http://127.0.0.1:8080 --dart-define=INCIDENTS_API_BASE_URL=http://127.0.0.1:8082
```

**Usar ubicación del dispositivo** sólo solicita el permiso de ubicación en Android al pulsarlo. Acepta permiso aproximado o preciso, muestra precisión y hora de la estimación y deja revisar el marcador. No solicita ubicación en segundo plano ni exige conceder permiso para usar otras funciones. La solicitud termina al recibir una posición, tras 15 segundos o al abandonar la actividad. Denegar el permiso, desactivar la ubicación o utilizar Flutter web permite continuar con el marcador o las coordenadas manuales. Se reutiliza `LocationManager` mediante un canal nativo, sin nueva biblioteca de mapas ni dependencia GPS. Este comportamiento sigue la [solicitud de permisos de Android](https://developer.android.com/develop/sensors-and-location/location/permissions/runtime).

El borrador vive en un proveedor Riverpod durante la sesión de la aplicación, incluso si se cierra el formulario. Una desconexión no borra descripción, coordenadas ni fecha. Tras un resultado incierto, **Reintentar envío** reutiliza el mismo cuerpo y `Idempotency-Key`; no permite editarlo mientras su recepción siga sin confirmar. Un rechazo de validación permite corregir el borrador. La aplicación evita el doble toque y nunca envía sin confirmación. No hay cola offline ni persistencia del borrador tras finalizar la aplicación. El reporte confirmado sí se guarda en el servidor y **Consultar estado** recupera su estado actual.

`test/incidents_test.dart` cubre formulario, marcador, permiso denegado, resolución ambigua, validación, desconexión, reintento, doble toque y conservación del borrador. La integración real está en `test/world_incidents_http_integration_test.dart`, habilitada con `RUN_INCIDENT_HTTP_TESTS=true`. Recibe `INCIDENTS_API_BASE_URL`, `INCIDENT_TEST_LATITUDE`, `INCIDENT_TEST_LONGITUDE`, `INCIDENT_TEST_EDGE_ID` opcional e `INCIDENT_TEST_OUTPUT` para escribir el DTO recibido y continuar la demostración React. Las coordenadas y la arista deben obtenerse del grafo revisado; esta prueba usa selección manual y no requiere GPS real.
