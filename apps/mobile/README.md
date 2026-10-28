# MantaSim — Android ciudadano

Flutter Material 3, Riverpod, GoRouter y Dio. La entrada `/escape` muestra un mapa con navegación inferior entre **Brote zombi** e **Inundaciones**. El cliente observa motores existentes; no crea, pausa ni reinicia ejecuciones. La consola React controla las rondas. No contiene claves administrativas ni credenciales de simulación.

```sh
flutter pub get
flutter analyze
flutter test
flutter build apk --debug
# Instancia explícita, conservando prefijos API Gateway:
flutter run --dart-define=WORLD_API_BASE_URL=https://api.sistemamanta.lexinnovate.com
```

La URL HTTPS de producción sigue siendo el valor predeterminado. `FLOOD_API_BASE_URL` e `INCIDENTS_API_BASE_URL` permiten seleccionar servicios independientes y usan `WORLD_API_BASE_URL` por defecto. No se admiten secretos, query ni fragmentos en las URLs. Android sólo permite HTTP en debug. No se genera Flutter Web para iPhone; el visor ciudadano de iPhone es React `/mobile`.

## Publicación y transporte

Para distribuir por descarga directa, compilar un APK universal release firmado
con una clave propia. La configuración local `android/key.properties` se basa en
`android/key.properties.example`; la clave y las contraseñas se conservan fuera de
Git y nunca se incluyen en la carpeta compartida. Respaldar ambos archivos de forma
privada: las actualizaciones requieren la misma firma y un `build-number` mayor.
La compilación release falla si falta la configuración de firma; debug conserva
su firma de desarrollo.

```sh
flutter build apk --release \
  --dart-define=WORLD_API_BASE_URL=https://api.sistemamanta.lexinnovate.com \
  --dart-define=FLOOD_API_BASE_URL=https://api.sistemamanta.lexinnovate.com \
  --dart-define=INCIDENTS_API_BASE_URL=https://api.sistemamanta.lexinnovate.com
```

El resultado está en `build/app/outputs/flutter-apk/app-release.apk`. Subir sólo
el APK a Drive, habilitar lectura para cualquier persona con el enlace y generar
el QR de ese enlace real. Los participantes descargan el archivo y autorizan
la instalación desde el navegador o gestor de archivos cuando Android lo solicite.
Si ya instalaron un APK debug, deben desinstalarlo antes por la diferencia de firma.
No es compatible con iPhone; allí se usa el visor React `/mobile`. Verificar una
descarga e instalación real antes de difundir el QR. La simulación debe iniciarse
desde la consola web para que los espectadores vean una ejecución publicada.

`HttpSpectatorRepository` consulta exclusivamente GET:

- `/v1/simulations/published/zombie_outbreak`: referencia pública al snapshot actual de una sesión existente.
- `/grafo?mode=competition|full`: topología zombi, separada del polling.
- `/lab/published`: snapshot compacto de la tormenta compartida, sin timeline acumulado.
- `/lab/graph?mode=…&run_id=…`: geografía coherente con el snapshot de inundación.

No usa el runtime legacy `/estado`, que conserva su repositorio y pruebas aisladas. La capa de presentación adapta los modelos Go existentes: no calcula rutas ni simula movimientos en Dart. Los DTO disponibles de grafo, mundo, refugios y novedades continúan generándose desde OpenAPI. Las rutas se dibujan sólo sobre aristas publicadas existentes.

`PublishedObserver` mantiene una solicitud en vuelo por escenario. Actualiza cada dos segundos durante la ejecución y cada quince en espera o terminal para descubrir reemplazos. Los errores incrementan el intervalo hasta treinta segundos y mantienen el último mapa marcado sin conexión. La pausa del servidor se conserva como estado. Un espectador tardío recibe directamente el turno actual; no reproduce historia. Las respuestas de una observación suspendida se descartan; un mismo ID no retrocede de versión. Un ID nuevo limpia la selección de ruta. La caché de geografía está acotada y comparte una misma instancia por escenario, perfil y versión; no vuelve a descargarla en cada turno.

Cambiar de apartado suspende la observación del apartado oculto. Al pasar Android a segundo plano se suspenden temporizadores y animaciones; al regresar se consulta el snapshot vigente. El mapa conserva zoom y desplazamiento al navegar entre apartados. Permite pellizcar, desplazar, restablecer vista, controlar capas y tocar agentes, refugios y novedades. Las listas en bottom sheets ofrecen acceso a las rutas publicadas. Los refugios siguen siendo propuestos/ficticios, no puntos oficiales de emergencia.

## Inundaciones y novedades

**Mapa ciudadano** muestra el grafo, refugios propuestos y hasta cien novedades de la consulta pública, excluyendo fuentes sintéticas y estados rechazados/caducados. Un diamante `?` identifica reportes pendientes; el detalle presenta tipo, fecha observada, descripción, transitabilidad, severidad y verificación sin IDs ni coordenadas internas. La capa SNGR de susceptibilidad histórica usa `/v1/reference/status` y la colección GeoJSON validada y versionada `/v1/reference/susceptibility`; se descarga una vez durante la sesión ciudadana y se identifica como referencia histórica, nunca alerta actual. Su ausencia no bloquea las novedades.

**Simulación** consume el motor de tormenta compartido y muestra exposición sintética, calles transitables/precaución/bloqueadas, agentes, refugios, rutas y métricas. La advertencia **Simulación con datos sintéticos** permanece visible. El mapa ciudadano no recibe bloqueos ni focos sintéticos del snapshot experimental.

**Reportar novedad** reutiliza el flujo real de la API: marcador manual o GPS opcional, tipo existente, descripción, transitabilidad y severidad; revisión y confirmación antes de enviar. No necesita login. La resolución se valida en Go; un reporte se crea como ciudadano y pendiente y no cambia automáticamente el grafo. El borrador se conserva en memoria mientras la app permanece abierta. Ante recepción incierta, reintentar usa exactamente el mismo cuerpo e `Idempotency-Key`. No hay cola offline ni persistencia del borrador al cerrar la aplicación. Denegar GPS permite continuar manualmente.

Para el laboratorio local a través de ADB, manteniendo las validaciones Host:

```sh
adb reverse tcp:18880 tcp:18880
flutter run --dart-define=WORLD_API_BASE_URL=http://127.0.0.1:18880 \
  --dart-define=FLOOD_API_BASE_URL=http://127.0.0.1:18880 \
  --dart-define=INCIDENTS_API_BASE_URL=http://127.0.0.1:18880
```

El servidor debe exponer el proxy del laboratorio; no se relajan validaciones del servidor para conectar un dispositivo.

## Validación

`test/spectator_test.dart` prueba GET sin credenciales, caché de geografía, serialización de consultas, incorporación tardía, suspensión/reanudación, respuesta antigua, backoff y cambio de ejecución. `test/world_test.dart` verifica navegación estrecha y selección de rutas junto con las pruebas del contrato legacy. `test/incidents_test.dart` conserva resolución ambigua, permiso denegado, reintento idempotente y recepción pendiente.

La integración nueva usa Go real sin crear ejecuciones desde Flutter; primero iniciar las ejecuciones explícitamente desde la consola o un harness de QA:

```sh
flutter test --dart-define=RUN_PUBLISHED_HTTP_TESTS=true \
  --dart-define=WORLD_API_BASE_URL=http://127.0.0.1:18880 \
  --dart-define=FLOOD_API_BASE_URL=http://127.0.0.1:18880 \
  --dart-define=EXPECTED_ZOMBIE_ID=ID_PUBLICADO \
  --dart-define=EXPECTED_FLOOD_ID=ID_PUBLICADO \
  test/published_http_integration_test.dart
```

`PUBLISHED_TEST_OUTPUT=/ruta/resultados.json` guarda IDs, turnos, cantidades y versiones observadas, sin tokens. La prueba ciudadana HTTP existente usa `RUN_INCIDENT_HTTP_TESTS=true` y `test/world_incidents_http_integration_test.dart`; las coordenadas y arista de prueba deben proceder del grafo real.
