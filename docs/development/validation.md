> **Archivo histórico del starter, 23 de octubre de 2026.** Las pantallas demo, el build Flutter Web y las cifras de esta página no describen la entrega actual. Consultar [pruebas vigentes](../pruebas.md) y [arquitectura](../arquitectura.md).

# Evidencia de validación

Ejecuciones realizadas el **23 de octubre de 2026**, zona America/Guayaquil. El 27 de octubre de 2026 es únicamente la referencia de planificación del brief. Los resultados siguientes corresponden a comandos ejecutados, sin atribuir cobertura a verificaciones pendientes.

## Entorno utilizado

Linux, Node.js 22.18.0, npm 10.9.3, TypeScript 5.9, Vite 8.3.5, Vitest 5.0.5, Flutter 3.41.4, Dart 3.11.1 y Java 17 para Android. Chromium se ejecutó mediante Google Chrome 156.0.8078.47 instalado en el host. Se conservaron `package-lock.json` y `apps/mobile/pubspec.lock`.

## Resultados

| Comprobación | Resultado observado |
| --- | --- |
| `npm install` | Instalación completa, sin incompatibilidades de engines en la combinación final |
| `npm audit` | 0 vulnerabilidades reportadas en las dependencias npm instaladas |
| `npm run check` | OpenAPI válido, derivados sincronizados, TypeScript estricto y ESLint aprobados |
| Validación del generador de tokens | 9 entradas inválidas rechazadas antes de escribir; las 5 salidas generadas conservaron su contenido |
| `npm test` | React: 16 pruebas; Fastify: 39 pruebas; todas aprobadas |
| `npm run build:web` | Compilación de producción React aprobada |
| `npm run build:api` | Compilación TypeScript de API aprobada |
| `npm run mobile:check` | `flutter analyze`: sin incidencias |
| `flutter test` desde `apps/mobile` (`mobile:test`) | 16 pruebas aprobadas; la integración HTTP queda omitida por defecto |
| `npm run mobile:integration` con URL de prueba | 1 prueba aprobada contra la API compilada real: 9 peticiones HTTP |
| `flutter build apk --debug` desde `apps/mobile` (`mobile:build`) | APK Android debug compilado correctamente |
| `flutter build web` desde `apps/mobile` | Compilación aprobada; sin advertencia de fuente Cupertino faltante |
| `npm run test:e2e` con Chrome del host | 8 pruebas aprobadas: 4 flujos, en escritorio y viewport móvil |

Son **80 pruebas automatizadas aprobadas** al contar las suites JavaScript, Flutter, HTTP real y navegador. La prueba HTTP omitida en la suite ordinaria Flutter se ejecutó aparte; no se cuenta una omisión como aprobación.

## Integración comprobada

La API compilada se inició temporalmente en `127.0.0.1:3002`. El repositorio Dio consumió salud, listado, segunda página, detalle, búsqueda, vacío, 404, validación y confirmación de formulario. Se preservaron los códigos del error y request IDs. El comando reproducible, con esa API activa, es:

```sh
npm run mobile:integration -- --dart-define=API_BASE_URL=http://127.0.0.1:3002
```

Flutter debe estar en `PATH` o configurado mediante `FLUTTER_BIN`. En la máquina de validación también se seleccionó Java 17 mediante `JAVA_HOME` para el build Android; no se cambiaron las herramientas globales.

Playwright compiló e inició otra instancia de la misma API en 3001 e inició Vite en 5173. Comprobó navegación, paginación, búsqueda, detalle, validación y aceptación HTTP 202, resultados vacíos, 404 y diagnóstico. También ejercitó la apertura de navegación móvil. No sustituyó las respuestas HTTP por fixtures del navegador.

Después se conectó React a la misma instancia 3002 usada por Dart. Se inspeccionaron capturas de 1440 px y 390 px de ancho: HTTP 200, marca correcta, sin excepciones JavaScript ni desbordamiento horizontal. Las capturas locales de esa ejecución están en `test-results/visual/`; son artefactos temporales ignorados.

Una comprobación HTTP adicional contra el servidor compilado verificó los cuatro endpoints, error de validación, 404 con request ID y timeout real con `x-demo-delay-ms`, habilitado exclusivamente para desarrollo.

## Artefactos y límites

- APK local: `apps/mobile/build/app/outputs/flutter-apk/app-debug.apk`.
- React: `apps/web/dist/`; API compilada: `services/mock-api/dist/`; Flutter web: `apps/mobile/build/web/`.
- No había dispositivo Android conectado. La instalación y ejecución del APK en un emulador o teléfono no se verificaron. El viewport móvil de Playwright prueba React, no Android nativo.
- No se configuró ni validó iOS. El APK es de desarrollo; no se preparó firma de distribución.
- La generación Dart produce modelos para el subconjunto documentado de OpenAPI. Los transportes fetch/Dio son adaptadores manuales tipados; no se entrega un SDK completo generado ni validación JSON Schema integral en los clientes.
- La API compilada requiere conservar el YAML del contrato en la estructura del monorepo. No es un artefacto autónomo de Lambda.
- No se desplegó AWS ni se verificó conectividad contra un backend remoto. Tampoco se implementaron autenticación o persistencia, que dependen del futuro assignment.
- No se inicializó Git ni se crearon commits. No se incluyeron credenciales ni direcciones IP personales en los archivos fuente.

Las implementaciones se distribuyeron mediante subagentes reales para contratos/API, React, Flutter, documentación/QA y revisión del design system. El orquestador integró los resultados y ejecutó las comprobaciones HTTP y de navegador.
