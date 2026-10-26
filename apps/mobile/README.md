# CoroDev — Flutter

Cliente Material 3 con Riverpod, GoRouter y Dio. Consume la misma API HTTP que
React; no tiene un repositorio de fixtures en producción. Requiere Flutter
3.41.4 / Dart 3.11 o versiones compatibles y Android SDK para compilar APK.

Desde la raíz del monorepo, inicia la API con `npm run dev:api`. En este directorio:

```bash
flutter pub get
flutter run -d emulator-5554
# Navegador (mantén este puerto en CORS_ORIGINS de la API):
flutter run -d chrome --web-port=5174
```

El emulador Android usa `http://10.0.2.2:3001`; web y otras plataformas usan
`http://localhost:3001`. Para un dispositivo físico usa la dirección LAN del host:

```bash
flutter run --dart-define=API_MODE=mock --dart-define=API_BASE_URL=http://HOST_LAN_IP:3001
# API Gateway (reemplaza el dominio y stage):
flutter run --dart-define=API_MODE=remote --dart-define=API_BASE_URL=https://API_DOMAIN/STAGE --dart-define=API_TIMEOUT_MS=10000
```

No incluir credenciales, query o fragmentos en `API_BASE_URL`. Los modos `mock` y
`remote` consumen HTTP mediante el mismo repositorio. La URL puede incluir un
stage de API Gateway. El interceptor de debug registra solo método HTTP, estado
y duración, sin URL, payload ni headers.

```bash
flutter analyze
flutter test
# API real en ejecución (no usa fixtures):
flutter test --dart-define=RUN_HTTP_TESTS=true test/http_integration_test.dart
flutter build apk --debug
flutter build web
```

`test/app_test.dart` verifica tema, Home, carga, listado/detalle, búsqueda vacía,
error y retry, validación, guardia contra doble envío y diagnóstico.
`test/repository_test.dart` verifica configuración, stage prefix, envelope, timeout,
API apagada, error HTTP y respuesta inválida. La integración HTTP es optativa en
la suite normal y ejecuta el repositorio Dart contra el servidor compartido.

La marca, colores y modelos se regeneran desde la raíz. No editar
`lib/core/theme/{brand,tokens}.g.dart`, `lib/core/api/generated/models.dart`
ni `android/app/src/main/res/values/brand.xml`.
Android permite HTTP solo en debug; release requiere HTTPS. El scaffold incluye
firma de desarrollo para el build local; configurar una firma de producción antes
de distribuir, sin guardar claves en el repositorio. Ningún servicio AWS se despliega.

Guía completa: [entorno local](../../docs/development/local-setup.md),
[contratos](../../docs/api/contracts.md) y [AWS](../../docs/aws/integration.md).

## Track A: Escape de Manta Zombie

La pestaña **Escape** mantiene la navegación existente y muestra turno, contadores,
refugios, zombies visibles y búsqueda por ID de sobreviviente. La observación se
consulta cada dos segundos con `WorldRepository`; las decisiones permanecen en Go.

La URL pública `WORLD_API_BASE_URL` permite mantener la API demo en el puerto 3001
y observar Go en el 8080. Si se omite, usa `API_BASE_URL`, lo que conserva las
fixtures sintéticas del mock. No utiliza ni necesita API keys en Flutter.

```sh
# API Go expuesta a la interfaz del emulador mediante LISTEN_ADDR=0.0.0.0:8080
flutter run --dart-define=WORLD_API_BASE_URL=http://10.0.2.2:8080
# Prueba del repositorio Dart contra el backend Go local:
flutter test --dart-define=RUN_WORLD_HTTP_TESTS=true --dart-define=WORLD_API_BASE_URL=http://127.0.0.1:8080 test/world_http_integration_test.dart
```

`world_test.dart` comprueba la consulta de sobrevivientes, respuestas inválidas,
propagación de request ID, navegación y búsqueda. La prueba HTTP del mundo queda
separada de la integración demo y se omite si no se habilita expresamente.

## FASE 2: rutas y refugios

Escape añade posición geográfica, refugio asignado, siguiente movimiento, ruta publicada y reservas/disponibilidad. Al buscar un único ID o tocar un sobreviviente, el mapa muestra su ruta usando la geometría real de las aristas. Los avisos provienen de calles cerradas y amenazas visibles del snapshot; los sleepers dormidos permanecen ocultos.

Los polígonos distinguen zonas de aparición de la envolvente de referencia urbana. La red operativa es una selección de calles, y la envolvente no implica cobertura vial completa. Los refugios son ficticios, no instalaciones oficiales. La consulta admite posiciones fuera de las zonas de origen. El indicador de conexión en Escape usa el mundo Go, sin depender del mock demo.

Para comprobar la variante urbana contra Go real desde la raíz:

```sh
FLUTTER_BIN=/ruta/flutter/bin/flutter npm run test:contracts:http -- --urban --browser --flutter
```

La opción `--urban` selecciona el grafo `data/manta-v2.json` y `scenarios/urban/round1.json`; omitirla verifica explícitamente el grafo histórico `manta-v1.json` con el escenario original, usando el motor actual. La comparación entre motores corresponde al evaluador del backend.
