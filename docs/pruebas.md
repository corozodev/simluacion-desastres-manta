# Pruebas FASE 2 — validación final

Evidencia del 26 de octubre de 2026. El [informe comparativo](informe-fase2.md) se genera de JSON medidos mediante `python3 tools/qa/report_phase2.py`. Los detalles de FASE 1 se conservan debajo como historial.

- 88 pruebas principales Go y subcasos: `-race`, vet y build correctos. Incluye replay exacto 38/150/12,200 sobrevivientes/150 turnos deterministas, reservas, predicción y regresión del wildcard IPv4 en contenedor.
- React 22, mock 40, Python 10 y Playwright 8 aprobadas; TypeScript/ESLint y builds correctos; generación TypeScript/Dart/JSON Schema sincronizada.
- Flutter analyze limpio,21 pruebas;2 integraciones condicionadas omitidas en suite normal. Repositorio Dart y navegador real probaron explícitamente v1/v2. APK debug construido; no equivale a una sesión en dispositivo.
- 63 ejecuciones comparativas de150 turnos, con semillas históricas+7+42 y condiciones iniciales registradas. Las cuatro variantes urbanas comparten hashes de grafo,configuración y apariciones. Los casos negativos se conservan.
- Docker final pasó 200 decisiones internas reales, clave solo de servidor, vecinos/bloqueos, reservas, visibilidad y health con no-root/readonly y 2 CPU/1 GB. `python3 tools/qa/verify_docker.py` lo reproduce y limpia su propio contenedor.

## Latencias finales locales

Cada carga usa 10.000 solicitudes TCP/HTTP reales,200 sobrevivientes, snapshot estable y calentamiento por sobreviviente. Percentiles de rango más próximo, tiempo completo cliente/transporte/decodificación. Las rondas completas complementan con cambios de mundo. Máximos de p95 por rondas urbanas: planificación 20,608 ms,publicación 1,270 ms,turno 33,935 ms y lectura de snapshot 3,176 ms.

| Carga | p50 ms | p95 ms | p99 ms | Máximo ms |
| --- | --- | --- | --- | --- |
| Concurrencia 16 | 1.321 | 3.017 | 4.268 | 9.520 |
| Sostenida 200 | 11.913 | 48.855 | 88.352 | 175.737 |
| Ráfagas 200 | 8.459 | 14.567 | 119.122 | 136.113 |

0 errores/0 timeouts en las 30.000 solicitudes finales; disponibilidad observada 100%. El máximo individual fue menor a 500 ms y p95 menor a 150 ms en esta máquina. No es un resultado AWS ni una promesa de producción. El p99 y los máximos se publican, incluso cuando son bastante mayores que el p95.

Reproducir con los comandos del [informe](informe-fase2.md#j-reproducir-y-posibles-acciones-siguientes), [README](../README.md) y [QA](../tools/qa/README.md). `reports/phase2/evidence-final.json`, `tools/qa/client-validation-phase2.json` y `deploy/validation-phase2-final.json` identifican datos/código/imágenes. Los reportes detallados son privados y no deben alojarse en S3 web.

---

# Pruebas y mediciones FASE 1

Validación del 26 de octubre de 2026 (America/Guayaquil). Evidencia local; no es una medición AWS ni una garantía de producción. Los JSON de `services/evacuation/reports` contienen los valores originales. `evidence.json` identifica versión del grafo, entorno y SHA-256 de código Go/configuraciones usados; esta copia no tiene metadatos Git.

## Comprobaciones ejecutadas

| Comando o suite | Resultado |
| --- | --- |
| `npm install` | Correcto; lockfile conservado; sin dependencias nuevas |
| `npm run contracts:validate`, `contracts:generate`, `tokens:generate`, `generated:check` | Correctos; TypeScript/Dart/JSON Schema sincronizados |
| `npm run check` | OpenAPI, consistencia generada, TypeScript y ESLint correctos |
| `npm test` | React 19 y mock 40 pruebas aprobadas |
| `npm run build:web`, `npm run build:api` | Builds correctos |
| `go test -race ./...` | 50 pruebas principales y subcasos aprobados, sin carreras detectadas |
| `go vet ./...`, `go build ./...` | Correctos |
| `npm run graph:generate`, `npm run graph:test` | Regeneración offline idéntica; 3 pruebas Python aprobadas |
| `npm run test:contracts:http` | Go real: health, grafo, estado, `/paso`, errores 400/401/409 y request ID conformes a JSON Schema |
| QA HTTP con `--browser --flutter` | Chromium y repositorio Dart consumieron Go real; grafo 300/325, búsqueda, móvil 390 px sin desborde, sin API key en navegador |
| `npm run test:e2e` | 8 pruebas aprobadas en viewport escritorio/móvil; demos conservadas |
| Flutter analyze | Sin incidencias |
| Flutter test | 19 aprobadas; 2 integraciones condicionadas omitidas en la suite normal |
| Integración Flutter mundo habilitada | 1 prueba HTTP real aprobada; la integración demo condicionada previa no se ejecutó en esta fase |
| Flutter build apk --debug | APK generado correctamente; no se afirma prueba en dispositivo |

Go instalado: `/usr/local/go/bin/go` (1.26.1). Flutter: `/home/naielik/Android/flutter/bin/flutter` (3.41.4, Dart 3.11.1). Node 22.18.0, npm 10.9.3. No se ejecutó actualización de SDK.

## Cobertura que importa

- Grafo: IDs/coordenadas/extremos/distancias, duplicados, conectividad a refugios, vecinos, dirección, cierres y trazabilidad de cada recorrido OSM.
- Simulación: cuatro tipos de zombie, frecuencia Walker, persecución/path intermedio Runner, exclusión de Horde, activación oculta Sleeper, cierres antes de decisiones, mordidas finales y por cruce opuesto, capacidad, conservación de sobrevivientes y exclusión de refugiados.
- Determinismo: respuestas procesadas en orden estable, PRNG con semilla y comparación del estado completo de dos rondas 3 de **150 turnos y 200 sobrevivientes**, mediante HTTP real, incluyendo los dos cierres. Solo se excluyen percentiles de latencia de la comparación.
- HTTP: credencial, JSON y nombres exactos, coherencia de turno/nodo, espera ante respuesta inválida/no vecina/cerrada, solicitudes concurrentes, cancelación y timeouts.
- Regresiones: petición con cuerpo incompleto limitada por deadline de red; respuesta con cabeceras 200 y cuerpo detenido, incluso esperando EOF después de JSON completo. Los timeouts se cuentan correctamente y no mueven al sobreviviente.
- Rutas: bloqueos/hordas/zombies visibles/cruces intermedios, refugios llenos, invalidación aun con versión reutilizada, costo por vía sin saltos múltiples, salida segura de emergencia y 200 consultas concurrentes.

## Rondas completas medidas

Todas se ejecutaron **secuencialmente, aceleradas, 150 turnos**, sobre `manta-osm-1861b6730dcb`, sin otras verificaciones del proyecto en paralelo durante la toma final. Concurrencia 16/16/32 y semillas 20261026/20261027/20261028. Las solicitudes recorren TCP/HTTP loopback hasta `/paso`; incluyen adquisición de snapshot, motor y decodificación. El reloj es monotónico y los percentiles usan rango más próximo `ceil(p*n)`. No se incluye tiempo de compilación ni espera en cola del trabajador.

| Ronda | Iniciales | Evacuados | Mordidos | Activos | HTTP exitosas | p50 ms | p95 ms | p99 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 20 | 20 | 0 | 0 | 445 | 2.829 | 4.000 | 7.113 |
| 2 | 80 | 23 | 22 | 35 | 6376 | 2.069 | 4.015 | 5.053 |
| 3 | 200 | 38 | 150 | 12 | 10500 | 2.642 | 5.539 | 7.612 |

En cada ronda hubo **0 solicitudes inválidas y 0 fuera de plazo**; disponibilidad observada de `/paso` 100% bajo la definición éxito/total. No representa disponibilidad externa durante cinco minutos reales: el modo acelerado reproduce 150 turnos sin esas esperas. Los escenarios contienen cantidades de zombies asumidas, editables y explícitas, no cantidades oficiales.

La ronda 3 evacuó 38/200: la corrección del contrato no implica una tasa óptima de supervivencia. Predicción temporal de runners, asignación coordinada y topología con más conexiones son prioridades de FASE 2.

## Benchmark HTTP de snapshot estable

10000 solicitudes medidas, **200 sobrevivientes activos, concurrencia 16**, tras una solicitud de calentamiento por sobreviviente. Snapshot inicial de ronda 3 sin avanzar turnos. Incluye transporte y lectura; el cálculo de Dijkstra se comparte mediante caché. Las rondas de arriba complementan esta medición con cambios de zombies/bloqueos/capacidad.

- p50: **1.205 ms**; p95: **2.656 ms**; p99: **3.685 ms**.
- Máximo: **8.262 ms**; 10000 éxitos, 0 inválidas, 0 timeouts.
- Duración medida: 857.346 ms; rendimiento observado: 11663.9 solicitudes/s.
- Entorno: linux amd64, go1.26.1, GOMAXPROCS=12.

En esta ejecución local, los percentiles medidos cumplen el objetivo p95 ≤150 ms y todas las solicitudes medidas del benchmark quedaron por debajo de 500 ms. La carga, hardware y distribución de otras máquinas pueden cambiar esos resultados. No hay afirmación de SLA ni extrapolación al despliegue AWS.

## Reproducir

Desde la raíz:

```sh
npm run check
npm test
npm run test:race
npm run graph:test
npm run test:contracts:http
FLUTTER_BIN=/home/naielik/Android/flutter/bin/flutter npm run test:contracts:http -- --browser --flutter
npm run test:e2e
npm run simulate -- -scenario scenarios/round1.json -output reports/round1.json
npm run simulate -- -scenario scenarios/round2.json -output reports/round2.json
npm run simulate -- -scenario scenarios/round3.json -output reports/round3.json
npm run bench:backend -- -requests 10000 -concurrency 16 -output reports/http-benchmark.json
```

Los informes de latencia cambiarán al repetirlos. Conserva la evidencia anterior si necesitas compararla y vuelve a calcular hashes cuando cambie la implementación. Para otras instalaciones, reemplaza `FLUTTER_BIN` por la ruta local o usa Flutter en PATH.
