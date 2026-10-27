# Entrega FASE 4A — motor de inundaciones urbanas

Validación local del 26 de octubre de 2026, zona del cliente America/Guayaquil. Evidencia consolidada: [`deploy/validation-phase4a.json`](../deploy/validation-phase4a.json). Los informes detallados y logs permanecen bajo `services/evacuation/reports/phase4a/`, excluido de Git. No se desplegó AWS, no se reinició producción y no se realizó push.

Los escenarios de inundación emplean parámetros sintéticos y no constituyen pronósticos hidrológicos ni recomendaciones oficiales de evacuación.

## Resultado y arquitectura

Se incorporó `urban_flood` mediante un adaptador de amenaza sobre el simulador existente. Se conservan el grafo, movimiento de una arista, HTTP real autenticado, Dijkstra inverso compartido, cachés, histéresis de ruta, reservas y capacidad. La rama `zombie` sigue siendo predeterminada. Terremotos y tsunamis sólo tienen una frontera de extensión; no se aceptan como motores implementados.

El modelo calcula exposición espacial sobre polilíneas OSM, con focos artificiales reproducibles, crecimiento por lluvia y drenaje. Los cierres son un overlay y se combinan con eventos y bloqueos base. Las calles en precaución reciben un costo configurable; las bloqueadas se excluyen. Los refugios expuestos o sin acceso se excluyen para nuevas admisiones sin alterar capacidad u ocupantes existentes. La ausencia de destino mantiene agentes vivos y recuperables. Existen políticas preventiva, tardía y adaptativa.

La [guía técnica](urban-flood.md) documenta fórmulas, parámetros, limitaciones, procedencia y el contrato completo para React FASE 4B. No se añadieron dependencias ni servicios externos. Los datos, fixtures, rondas anteriores y el motor congelado FASE 1 no tienen modificaciones.

## Simulaciones y mediciones reales

Una ronda completa significa los 150 pasos configurados, aunque termine antes la evacuación. Todos los casos siguientes usan 80 agentes, semilla 20261026, concurrencia 16 y pasos acelerados. Las duraciones de benchmark incluyen verificaciones, snapshots y hashing entre pasos; el p95 mide exclusivamente la llamada `Step` completa. No son mediciones AWS.

| Grafo / escenario | Nodos / aristas | Evacuados | Replanificaciones | Máx. bloqueadas / precaución | Ronda ms | Paso p95 ms | RSS pico KiB |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Oficial / focos por semilla | 300 / 383 | 80 | 0 | 69 / 66 | 792,03 | 22,954 | 31.940 |
| Oficial / corredor de estrés | 300 / 383 | 80 | 65 | 49 / 45 | 981,93 | 22,873 | 31.896 |
| Ampliado / focos por semilla | 1.000 / 1.599 | 80 | 0 | 223 / 177 | 1.685,33 | 44,026 | 48.128 |
| Maestro / focos por semilla | 9.179 / 13.452 | 80 | 0 | 834 / 887 | 15.871,81 | 295,604 | 258.596 |

Hubo cero mordidos, decisiones inválidas y timeouts en todos los casos. HTTP exitosas: 863, 1.354, 1.119 y 2.446 respectivamente. Todos terminan sin aislados ni agentes esperando y sin calles aún bloqueadas/en precaución. El maestro termina con un refugio ocupado a capacidad; no se sobrepasó ninguna plaza ni reserva. El tiempo medio de evacuación simulado fue 10,7875, 16,925, 13,9875 y 30,575 unidades, respectivamente.

El caso predeterminado evacúa antes de necesitar cambios de ruta. El escenario de estrés coloca un foco sintético en `OSM-363647979`, seleccionado por uso en rutas iniciales, para demostrar 65 cambios de plan durante la tormenta sin eventos externos. **No es evidencia de riesgo real en ese corredor.** Las diferencias entre grafos cambian centros, apariciones y rutas: no atribuir sus resultados a una mejora del algoritmo.

Se repitieron tanto el corredor oficial como el maestro con `-expect-hash`. Los hashes de toda la trayectoria observable, excluyendo únicamente rendimiento y percentiles HTTP, coincidieron:

| Reproducción | SHA-256 de la trayectoria completa |
| --- | --- |
| Oficial / estrés | `e6b9b30f745e8448aac0bf95970debb9518eb810a6de296d2f2cb54e98dff214` |
| Maestro / focos por semilla | `6e58f150f004a58adf023a59006c8caaf12088026cdedadeba2ee2628e373268` |

Las pruebas también comprueban estados distintos con semillas distintas y equivalencia temporal de perfiles al cambiar `time_step` en un caso sin saturación.

## Compatibilidad y referencia de rendimiento

Las tres rondas urbanas zombie conservaron los resultados previos sobre `manta-v2`: semillas 20261026/27/28, 150 pasos, 20/80/200 agentes.

| Ronda | Evacuados | Mordidos | Activos | Inválidas / timeouts |
| --- | --- | --- | --- | --- |
| 1 | 20 | 0 | 0 | 0 / 0 |
| 2 | 60 | 0 | 20 | 0 / 0 |
| 3 | 132 | 41 | 27 | 0 / 0 |

La regresión histórica congelada de FASE 1 también pasa mediante la suite de evaluación. Los grafos anteriores y las rondas originales permanecen idénticos en Git.

Se ejecutó el benchmark HTTP existente sobre el código previo `54bacbb`, extraído en un directorio temporal, y sobre la implementación actual. Ambos usan 10.000 solicitudes, 200 agentes, concurrencia 16, snapshot estable y calentamiento por agente en la misma máquina.

| Versión | p50 ms | p95 ms | p99 ms | Máximo ms | Éxitos / inválidas / timeouts |
| --- | --- | --- | --- | --- | --- |
| Antes | 1,361 | 3,138 | 4,425 | 10,026 | 10.000 / 0 / 0 |
| Después | 1,304 | 3,004 | 4,084 | 10,242 | 10.000 / 0 / 0 |

Son observaciones de una ejecución por versión, sujetas a ruido y carga del host. No demuestran una mejora causal ni ausencia de toda regresión bajo cualquier carga. El máximo posterior fue ligeramente mayor. No son comparables directamente con latencia HTTPS de AWS ni con el costo de un turno completo del maestro.

Entorno: Linux amd64, Go 1.26.1, GOMAXPROCS 12, Intel i7-1255U. El microbenchmark del modelo sobre fixture pequeña registró **151,0 ns/op, 0 B/op y 0 allocs/op**; no mide HTTP, copias de grafo ni simulador completo.

## Memoria y límites de rendimiento

Heap retenido después de GC, en MB decimales, con un snapshot observable retenido por el benchmark:

| Caso | Paso 0 | Paso 75 | Paso 150 | Entradas máximas de overlay |
| --- | --- | --- | --- | --- |
| Oficial | 1,920 | 2,343 | 2,359 | 93 |
| Oficial / estrés | 1,923 | 2,346 | 2,352 | 98 |
| Ampliado | 5,380 | 5,101 | 5,099 | 465 |
| Maestro | 38,156 | 38,532 | 38,488 | 2.411 |

No se observó crecimiento descontrolado del heap retenido en esas rondas. El modelo además conserva sus cantidades de focos/aristas/refugios tras 10.000 pasos y prueba cero asignaciones al actualizar condiciones. Tres muestras de una ronda no demuestran por sí solas ausencia de fugas a largo plazo.

El núcleo sigue clonando el grafo para cada lectura HTTP y conserva historiales diagnósticos y latencias acotados por la duración. El maestro asignó **17,21 GB acumulados** durante la ronda, aunque retuvo aproximadamente 38,49 MB de heap: asignación acumulada, memoria retenida y RSS son medidas distintas. Este costo y su p95 de paso de 295,6 ms son limitaciones reales; no se cambió el diseño de snapshots ni se habilitó el maestro en producción para ocultarlas. La configuración de inundación limita la duración a 10.000 pasos y rechaza pasos posteriores al final.

## Pruebas ejecutadas

| Validación | Resultado |
| --- | --- |
| `go test -json -count=1 ./...` | 139 pruebas principales; 233 con subcasos, 13 paquetes, cero fallos |
| `go test -race -json -count=1 ./...` | Los mismos 139/233 casos, cero fallos/carreras detectadas |
| `go vet ./...`, `go build ./...` | Correctos |
| `npm install` | Correcto, sin dependencias nuevas |
| OpenAPI, generación TS/Dart/JSON Schema, tokens, `npm run check` | Correctos y sincronizados |
| `npm test` | React 22 y servicio histórico 40 aprobadas |
| `npm run build:web` | Correcto |
| `npm run test:e2e` | 8 pruebas de navegador aprobadas |
| `npm run graph:test` | 10 pruebas Python aprobadas |
| Contratos HTTP zombie | Go real aprobado, además navegador y repositorio Flutter |
| `npm run test:contracts:flood` | Go real, seis pasos, JSON Schema, cierres, grafo estático, `/paso` y errores aprobados |
| Flutter analyze / unitarias | Sin incidencias; 13 aprobadas y 1 integración condicionada omitida en esa suite |
| Integración Flutter HTTP habilitada por checker | 1 aprobada contra Go real |
| Flutter APK debug | Construido; no se afirma prueba nueva en dispositivo |
| Benchmarks existentes y flood | Resultados medidos arriba; replays completos coinciden |

La cobertura nueva comprueba crecimiento, drenaje, reapertura, histéresis, intersección de polilíneas, ceros y configuraciones inválidas, composición OR de cierres, desvíos al cerrar avenidas, aislamiento/recuperación, saturación y cambio de destino, exposición de refugios, tres comportamientos, espera autoritativa, copias profundas, polling concurrente, determinismo y ejecución oficial/maestro. No se sustituyeron las pruebas de integración por invocaciones directas de decisiones.

## Archivos de esta fase

- Contratos: `packages/contracts/openapi.yaml`, `packages/contracts/generated/api.d.ts`, `packages/contracts/generated/schemas.json`, `apps/mobile/lib/core/api/generated/models.dart`.
- Estado: `services/evacuation/internal/world/{models,store,scenario,scenario_test}.go`.
- Modelo: `services/evacuation/internal/flood/{config,model,model_test}.go`.
- Routing/reservas: `internal/decision/{engine,flood_test}.go` y `internal/coordination/{planner,flood_test}.go`, dentro de `services/evacuation`.
- Simulación: `internal/simulation/{config,planner,simulation,scenario,scenario_test}.go`.
- HTTP e integración: `internal/httpapi/api.go`, `internal/application/flood_test.go`.
- Comandos: `cmd/sim/main.go`, `cmd/flood-server/main.go`, `cmd/flood-bench/{main,main_test}.go`.
- Escenarios: `scenarios/flood/urban-storm.json`, `scenarios/flood/urban-storm-stress.json`.
- Herramientas y guía: `package.json`, `tools/qa/check_flood_contracts.mjs`, `README.md`, `docs/{urban-flood,informe-fase4a,reglas-simulacion,algoritmo}.md`, `deploy/validation-phase4a.json`.

Los cambios previos del usuario en `deploy/validation-phase3b2.json`, `docs/informe-fase3b2.md`, `docs/operacion-multigrafo.md`, `docs/revision-rollout-fase3b2.md` y `deploy/validation-phase3b2-rollout.json` permanecen fuera de los commits de esta fase.

## Contratos y reproducción para FASE 4B

`GET /v1/scenario` publica `ScenarioSnapshot` sin duplicar la geometría; `/estado` sólo añade `scenario_type` opcional. `/paso`, `/grafo` y `/healthz` conservan sus contratos. React usará `graph_version` y `world_version` para asociar grafo, condiciones de calles/refugios, agentes, reloj, métricas y procedencia. Debe reemplazar cada overlay recibido y mostrar el texto de limitación. No hay WebSocket ni interfaz React de inundación implementada todavía.

Desde la raíz:

```sh
npm run simulate:flood -- -output reports/phase4a/storm.json -final-output reports/phase4a/final.json
npm run simulate -- -scenario scenarios/flood/urban-storm-stress.json -output reports/phase4a/stress.json
npm run dev:flood -- -scenario scenarios/flood/urban-storm-stress.json -listen 127.0.0.1:8081 -interval 1s
npm run bench:flood -- -scenario scenarios/flood/urban-storm-stress.json -output reports/phase4a/stress-benchmark.json
npm run bench:flood -- -graph data/manta-master.json -output reports/phase4a/master-benchmark.json
```

El servidor experimental conserva el final hasta Ctrl+C. La [guía](urban-flood.md) explica parámetros, semillas, `-expect-hash`, CORS, claves del servidor, estados y unidades exactas. Los datos del mapa son OSM con la procedencia conservada; no hay elevaciones verificadas conectadas. La interfaz futura `ElevationProvider` informa disponibilidad/procedencia y no inventa valores.

## Commits locales

- `eb5565d`: contratos, tipos generados y snapshots privados.
- `329c622`: modelo sintético de exposición, lluvia y drenaje.
- `77c0063`: costos/restricciones de routing y reservas.
- `2b2a4dd`: integración del escenario, comandos, pruebas y fixtures.
- La documentación y evidencia de esta entrega se conservan en un quinto commit separado; `git log -5 --oneline` muestra su identificador.

Se usó la identidad y fecha reales configuradas en Git. No se fabricó historial ni se realizó push.
