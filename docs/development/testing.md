# Pruebas y comprobaciones

Los comandos siguientes describen cómo verificar el proyecto. Los resultados de esta entrega, con sus límites, se conservan en [validation.md](validation.md). No interpretes la existencia de un script como evidencia de una ejecución exitosa.

## Verificaciones habituales

```sh
npm run check
npm test
npm run build:web
npm run build:api
npm run mobile:check
npm run mobile:test
npm run mobile:build
```

`check` combina validación OpenAPI, comparación de derivados, TypeScript y ESLint. `npm test` ejecuta pruebas de los workspaces JavaScript que declaran ese script; no incluye Flutter ni Playwright. Los scripts `mobile:*` utilizan `FLUTTER_BIN` si está definido o buscan Flutter en `PATH`.

| Capa | Ubicación | Propósito |
| --- | --- | --- |
| API | `services/mock-api/test/api.test.ts` | Health, paginación, búsqueda, detalle, validación, errores, salidas inválidas, CORS y controles de desarrollo mediante `Fastify.inject` |
| Web | `apps/web/src/tests/App.test.tsx`, `api.test.ts` | Pruebas Vitest/Testing Library de navegación, consultas, estados, formulario y adaptador HTTP |
| Flutter | `apps/mobile/test/app_test.dart`, `repository_test.dart` | Tema, pantallas, repositorio sustituible, estados, formulario y transporte |
| Navegador con API real | `tests/e2e/app.spec.ts` | Navegación, paginación/búsqueda/detalle, formulario, vacío, inexistente y diagnóstico |

Las pruebas de interfaz con repositorios falsos comprueban presentación; las pruebas HTTP reales comprueban compatibilidad entre procesos. Son verificaciones complementarias.

## Playwright: web y API reales

Detén los servidores que ocupen 3001 y 5173: Playwright administra sus propios procesos y no reutiliza servidores existentes.

```sh
npx playwright install chromium
npm run test:e2e
```

Hay cuatro escenarios en dos proyectos: desktop y viewport móvil, ocho ejecuciones. Los proyectos usan Chromium y la API compilada, que Playwright construye e inicia automáticamente. Si ya dispones de un Chromium compatible, puedes indicar su ejecutable:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/ruta/a/chromium npm run test:e2e
```

Usa una ruta real, no un nombre de directorio. Un viewport móvil en Chromium no equivale a probar un teléfono Android ni el cliente Flutter. Los traces de fallos quedan en los artefactos de Playwright ignorados por Git.

## Flutter contra el mismo servidor HTTP

Mantén una API real en `http://localhost:3001` y ejecuta:

```sh
npm run mobile:integration
```

Este script habilita `RUN_HTTP_TESTS=true` para `test/http_integration_test.dart`. Para usar otro puerto o prefijo:

```sh
cd apps/mobile
flutter test \
  --dart-define=RUN_HTTP_TESTS=true \
  --dart-define=API_BASE_URL=http://localhost:3002 \
  test/http_integration_test.dart
```

La ejecución ordinaria de `flutter test` no demuestra por sí sola acceso al servidor real: revisa si el test HTTP fue habilitado o quedó omitido. Esta prueba usa Dart en el host, por eso su URL es `localhost`, no `10.0.2.2`.

## Escenarios manuales reproducibles

```sh
# API disponible, vacío, inexistente y validación
curl -i http://localhost:3001/health
curl -i 'http://localhost:3001/v1/demo/items?q=no-coincidencia-zzzz'
curl -i http://localhost:3001/v1/demo/items/no-existe
curl -i -X POST http://localhost:3001/v1/demo/submit \
  -H 'Content-Type: application/json' -d '{"title":" "}'
```

Para fallos artificiales inicia el servidor con ambas condiciones habilitadas:

```sh
NODE_ENV=development ENABLE_DEV_CONTROLS=true npm run dev:api
```

```sh
# Error 500 con el mismo envelope
curl -i http://localhost:3001/v1/demo/items -H 'x-demo-fail: true'
# Retardo; curl aborta antes de que el servidor responda
curl -i --max-time 0.1 http://localhost:3001/v1/demo/items -H 'x-demo-delay-ms: 800'
```

`x-demo-delay-ms` admite enteros de 0 a 2000. Los encabezados se ignoran fuera de desarrollo o sin habilitación explícita. El timeout de curl prueba el retardo, no la UI del cliente. Para ver `TIMEOUT` en un cliente usa un timeout menor que el retardo e inyecta el encabezado desde una herramienta o prueba de desarrollo; las pantallas normales no envían encabezados artificiales.

Para comprobar API apagada, detén el servidor, abre Diagnóstico y reintenta. Comprueba que aparece un error recuperable sin bloquear la navegación. Una petición aceptada del formulario no debe modificar el total de los 12 fixtures.
