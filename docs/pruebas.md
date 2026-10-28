# Pruebas, auditoría Track A y medición

[Índice](INDEX.md) · [Arquitectura](arquitectura.md) · [Nivel PRO](nivel-pro.md) · [Limitaciones](limitaciones.md)

Resultados de la auditoría local del **27 de octubre de 2026, Ecuador**,
anteriores a esta limpieza y a la instrumentación CloudWatch. La evidencia histórica
permanece en los informes [FASE 1](informe-fase1.md), [FASE 2](informe-fase2.md),
[FASE 7](informe-fase7.md) y [FASE 8](informe-fase8.md). Sus resultados corresponden
a aquellas versiones; no se presentan como pruebas repetidas durante la limpieza.

## Matriz de cumplimiento

`CUMPLE` indica implementación y evidencia local, sin certificar homologación.
`PARCIAL` identifica un alcance menor que la interpretación completa del requisito.
`NO IMPLEMENTADO` y `NO VERIFICADO` distinguen ausencia de función y de comprobación.

| Requisito | Estado | Implementación | Prueba / cómo verificar | Demo |
| --- | --- | --- | --- | --- |
| Grafo Manta ~300 intersecciones, ID/coordenadas, distancia/tipo de calle | CUMPLE | [BASE](../services/evacuation/data/manta-v2.json), 300 nodos/383 aristas | [Variantes](../services/evacuation/internal/graph/urban_test.go), `npm run graph:test` | `/escape`, BASE |
| Velocidades por tipo de vía | PARCIAL | [Costo vial](../services/evacuation/internal/decision/engine.go) usa distancia/velocidad; movimiento es una arista/turno | `TestDistanceSpeedAndMovementCosts` en [engine_test.go](../services/evacuation/internal/decision/engine_test.go) | No cinemática física en m/s |
| Cuatro refugios | CUMPLE | BASE y [validación HTTP](../services/evacuation/internal/httpapi/api.go) | `TestHTTPRequiresCompetitionShelterCount` en [api_test.go](../services/evacuation/internal/httpapi/api_test.go) | Marcadores/capacidad |
| Turnos 2 s; zombies primero | CUMPLE | [Simulator.Step/Run](../services/evacuation/internal/simulation/simulation.go) | [Validación official](../services/evacuation/internal/sessions/policies_test.go), rondas completas | Iniciar official |
| Caminante: una calle cada dos turnos, aleatorio | CUMPLE | [moveZombies](../services/evacuation/internal/simulation/zombies.go) | `TestWalkerFrequencyAndSeededValidMovement` en [simulation_test.go](../services/evacuation/internal/simulation/simulation_test.go) | R1 |
| Corredor: detección ≤3 nodos, hasta dos aristas | CUMPLE | [Persecución transitable](../services/evacuation/internal/simulation/zombies.go) | `TestRunnerPursuitRecordsIntermediateNodes` en [simulation_test.go](../services/evacuation/internal/simulation/simulation_test.go) | R2/R3 |
| Horda bloquea nodo y vecinos físicos | CUMPLE | [Routing](../services/evacuation/internal/decision/engine.go) | `TestHordeBlocksAllPhysicalNeighborsIncludingIncomingClosedStreet` en [engine_test.go](../services/evacuation/internal/decision/engine_test.go) | R2/R3 |
| Dormido oculto hasta ≤2 nodos; después caminante | CUMPLE | [moveZombies](../services/evacuation/internal/simulation/zombies.go), snapshot observable | `TestSleeperHiddenUntilWithinTwoNodesThenWalkerCadence` en [simulation_test.go](../services/evacuation/internal/simulation/simulation_test.go) | R3; ocultos no se dibujan |
| Colapso de puente y dos bloqueos dinámicos | CUMPLE | [R2](../services/evacuation/scenarios/urban/round2.json), [R3](../services/evacuation/scenarios/urban/round3.json) | `TestDynamicBlockBeforeDecisionsAndInvalidNeighborStay`; rondas de 150 turnos | R2 t40; R3 t35/t80 |
| Eliminar transitabilidad / replanificar | CUMPLE | Overlay de cierres; grafo fuente inmutable | [Invalidación](../services/evacuation/internal/decision/engine_test.go), [reasignación](../services/evacuation/internal/coordination/planner_test.go) | Desvíos en mapa |
| Mordidas por nodo/cruce opuesto; excluir mordidos | CUMPLE | [Simulador](../services/evacuation/internal/simulation/simulation.go) | `TestSameNodeCollisionBeforeShelterAdmission`, `TestOppositeEdgeCollisionAndRunnerIntermediateEdge` en [simulation_test.go](../services/evacuation/internal/simulation/simulation_test.go) | Contadores R2/R3 |
| `POST /paso`, JSON español, espera/vecino válido | CUMPLE | [HTTP](../services/evacuation/internal/httpapi/api.go), [OpenAPI](../packages/contracts/openapi.yaml) | [Validación exacta](../services/evacuation/internal/httpapi/api_test.go), `npm run test:contracts:http` | CLI `simulate`; web observa sesiones |
| `/paso` público asociado a la ejecución del mapa | PARCIAL | El endpoint público consulta `/estado` inactivo; cada sesión usa su propio HTTP loopback | Contratos verifican aislamiento; acordar el runtime con el jurado antes de evaluar | El turno de React no se envía al `/paso` público |
| `x-api-key` | CUMPLE | Hash en comparación constante, clave independiente de sesión | [Cliente autenticado](../services/evacuation/internal/simulation/client_test.go), errores 401 | Provisión privada |
| `GET /estado` y mapa vivo | CUMPLE | `/estado` es runtime preparado e inactivo; sesiones usan `/state` y `/published` | [Publicados](../services/evacuation/internal/sessions/published_test.go), `test:spectators:http` | `/escape` controla; `/mobile` y Flutter observan |
| Respuesta HTTP <500 ms | PARCIAL | Deadlines [cliente](../services/evacuation/internal/simulation/client.go)/[servidor](../services/evacuation/internal/httpapi/api.go), fallback espera | Mediciones locales abajo; WAN/EC2 actual sin carga | Sin SLA externo demostrado |
| Inicio manual, acceso público y escenarios | CUMPLE | [Sesiones](../services/evacuation/internal/sessions/manager.go), [servidor](../services/evacuation/cmd/server/main.go) | `TestNoAutostartAndIndependentPrivateState`, `test:simulations:browser` | Abrir no crea ejecución |
| PRO: predicción anticipada de corredores | CUMPLE | [Predictor observable](../services/evacuation/internal/decision/predictor.go), [probabilidades](../services/evacuation/internal/decision/probability.go), [A* temporal](../services/evacuation/internal/decision/algorithms.go) | [Reacción a objetivo/cierre](../services/evacuation/internal/decision/phase2_test.go), [búsqueda temporal](../services/evacuation/internal/decision/algorithms_test.go) | [Caso A](nivel-pro.md) |
| PRO: capacidad, ocupación, reservas y reasignación | CUMPLE | [Planner global](../services/evacuation/internal/coordination/planner.go), escritor único | `Test200SurvivorsBalancedWithoutOverassignmentOrMutation`, `TestFullOrBlockedDestinationReassignsToAlternative`, [race](../services/evacuation/internal/coordination/planner_test.go) | [Caso B](nivel-pro.md) |
| PRO: cinco camionetas, cuatro pasajeros | CUMPLE | [Flota experimental](../services/evacuation/internal/simulation/fleet.go) | `TestFleetCapacityDeliveryAndPassengerConservation`, [flota](../services/evacuation/internal/simulation/fleet_test.go), R3 con 200 agentes | [Caso C](nivel-pro.md) |
| PRO: velocidad doble | PARCIAL | Hasta dos aristas reales/turno frente a una peatonal | [Invariantes de flota](../services/evacuation/internal/simulation/fleet_test.go): recorrido ≤2, vecinos/cierres | Doble avance topológico; no m/s por vía |
| PRO: prioridad, recogida, rutas y entrega | CUMPLE | [Utilidad y planificación](../services/evacuation/internal/simulation/fleet.go) | [Replanificación, reservas, exposición y entrega](../services/evacuation/internal/simulation/fleet_test.go) | Trayecto real, pasajeros, entregados |
| Extensión: inundaciones conservativas y reportes | CUMPLE | [Flood](../services/evacuation/internal/flood), [laboratorio](../services/evacuation/internal/floodlab), [incidentes](../services/evacuation/internal/incidents) | `bench:hydrology`, `test:contracts:flood`, `test:lab:flood`, espectadores | `/flood-lab`, escenarios sintéticos |

## Tres rondas reproducibles

Los [presets urbanos](../services/evacuation/scenarios/urban) ya fijan R1=20,
R2=80 y R3=200 sobrevivientes, 150 turnos y concurrencia de decisiones 16/16/32.
R1 sólo tiene caminantes; R2 añade corredores/hordas y colapso; R3 añade dormidos
y dos cierres. Cantidades de zombies y refugios son fixtures editables, no datos
oficiales del organizador. `official` exige BASE, `classic_random`, 150 turnos/2.000 ms,
población de ronda, refugios originales y ausencia de flota.

Comprobación rápida: `make smoke`. Rondas completas aceleradas, **HTTP real
autenticado**, sin esperar quince minutos:

```sh
npm run simulate -- -scenario scenarios/urban/round1.json -output reports/delivery/r1.json
npm run simulate -- -scenario scenarios/urban/round2.json -output reports/delivery/r2.json
npm run simulate -- -scenario scenarios/urban/round3.json -output reports/delivery/r3.json
```

Prueba de fuego a ritmo nominal, **tres rondas secuenciales de cinco minutos**
(más compilación/preparación):

```sh
npm run simulate -- -scenario scenarios/urban/round1.json -interval 2s -output reports/realtime/r1.json
npm run simulate -- -scenario scenarios/urban/round2.json -interval 2s -output reports/realtime/r2.json
npm run simulate -- -scenario scenarios/urban/round3.json -interval 2s -output reports/realtime/r3.json
```

Se ejecutan 150 turnos aunque todos los agentes sean terminales. Si procesar un
turno supera dos segundos, la duración aumenta; no se aceleran reglas para
compensarlo. La CLI inicia un proceso local aislado con credencial efímera,
no la instancia pública ni la sesión que observa React.

Comparación explícita con dos algoritmos y dos repeticiones lógicas:

```sh
GOMAXPROCS=2 npm run compare:agents -- --rounds 1,2,3 --seeds 42 --repeats 2 \
  --algorithms legacy_current,predictive_temporal_astar --output reports/delivery/official
GOMAXPROCS=2 npm run compare:agents -- --mode experimental --fleet --rounds 3 \
  --seeds 42 --repeats 2 --algorithms legacy_current,predictive_temporal_astar \
  --output reports/delivery/pro-r3
```

`compare:agents --realtime` añade ritmo a **cada configuración**: dos algoritmos,
una semilla y una repetición ocupan al menos 30 minutos para R1-R3. Sus defaults
son cuatro algoritmos, dos semillas, dos repeticiones (48 rondas); no es el comando
de la prueba de quince minutos.

## Metodología y rúbrica

- `N=E+A+B`: población inicial, evacuados, activos y mordidos. Supervivencia viva
  `S=100*(E+A)/N`; evacuación `V=100*E/N`. Un vivo fuera de refugio no es evacuado.
- Ponderación solicitada: `(S_R1+2*S_R2+3*S_R3)/6`. Si el jurado puntúa llegadas
  a refugio, aplicar la misma fórmula a `V` y etiquetarla como evacuación ponderada.
- Eficiencia implementada: saltos iniciales mínimos al refugio más cercano sin
  amenazas / aristas realmente recorridas. `analytics.mean_route_efficiency`
  promedia sólo evacuados; excluye esperas y agentes sin llegada. No mide m/s ni
  optimalidad temporal global. [Cálculo](../services/evacuation/internal/simulation/simulation.go).
- `/paso` se cronometra en cliente con reloj monotónico: TCP/HTTP loopback,
  handler y lectura/decodificación completos. Excluye cola previa por trabajador
  y planificación global anterior a publicar. Tiempos internos se miden aparte.
  Percentiles: ordenar `n` duraciones y elegir rango `ceil(p*n)` para p50/p95/p99.
- `T=success+invalid+timeout`; disponibilidad observada `100*success/T`, fallos
  `100*(invalid+timeout)/T`. `invalid` incluye errores HTTP, transporte y respuestas
  ilegales; timeouts se clasifican aparte. Sin solicitudes no hay evidencia de disponibilidad.
- Rúbrica facilitada: supervivencia 50%, eficiencia 20%, latencia 15%, disponibilidad 15%.
  Latencia puntúa 10/7/4/0 con p95 ≤150/≤300/≤500/>500 ms. Disponibilidad puntúa 10/6/3/0
  con fallos <0,5%/<2%/<5%/resto. Fijadas las normalizaciones de supervivencia y
  eficiencia del jurado: `total_sobre_10=0.50*S10+0.20*E10+0.15*L10+0.15*A10`.
  No se declara una calificación oficial con fixtures locales.

[Compare](../services/evacuation/cmd/compare/main.go) exporta JSON/CSV,
configuración, semilla, grafo y hashes iniciales/lógicos. Las repeticiones comparan
todos los snapshots observables por turno, excluyendo tiempos. CPU/RSS/latencias
no verifican determinismo. Fallos HTTP hacen terminar con error; el benchmark
estático conserva sus contadores incluso al fallar. No promediar percentiles para
inventar un percentil conjunto ni confundir tiempo de routing con latencia HTTP.

## Mediciones locales de esta consolidación

Código medido: partida `b26ff44`, motor sin cambios; Linux amd64, Go 1.26.1, 12 CPU lógicas visibles,
RAM total 16.042.712 KiB y `GOMAXPROCS=2`. Limitar paralelismo Go **no representa EC2
de 2 vCPU/8 GiB**. Mediciones secuenciales, sin otras suites del proyecto durante
la ventana de benchmark; escritorio del propietario presente. No se midió WAN
ni capacidad AWS ni se ejecutó aquí la secuencia nominal de quince minutos.

Después de medir se corrigió un bloqueo de cierre repetido de la aplicación
HTTP (`App.Close`); no cambia reglas, routing ni PRNG. Su regresión reproduce
32 cierres concurrentes y cancelación repetida/reinicio del laboratorio por HTTP.
Los tiempos de esta tabla corresponden al código anterior a ese arreglo de
lifecycle, y no se presentan como una nueva medición posterior al arreglo.

12 ejecuciones oficiales y cuatro PRO completaron 150 turnos: **2.400 turnos**,
hashes repetidos idénticos, 93.962 solicitudes válidas y cero inválidas/timeouts.
Una repetición por configuración figura abajo; no se duplica población. P95 es
el máximo entre ambas repeticiones, no un percentil agregado.

| Configuración, semilla 42 | E / B / A | Vivos | Evacuación | Eficiencia | Máx. p95 HTTP ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| R1 `legacy_current` | 17 / 0 / 3 | 100% | 85% | 0,914 | 1,068 |
| R1 `predictive_temporal_astar` | 17 / 0 / 3 | 100% | 85% | 0,914 | 0,947 |
| R2 `legacy_current` | 60 / 0 / 20 | 100% | 75% | 0,939 | 1,987 |
| R2 `predictive_temporal_astar` | 60 / 0 / 20 | 100% | 75% | 0,939 | 1,966 |
| R3 `legacy_current`, sin flota | 169 / 1 / 30 | 99,5% | 84,5% | 0,862 | 4,280 |
| R3 `predictive_temporal_astar`, sin flota | 170 / 18 / 12 | 91% | 85% | 0,879 | 4,939 |
| R3 `legacy_current`, flota experimental | 137 / 3 / 60 | 98,5% | 68,5% | 0,831 | 5,895 |
| R3 `predictive_temporal_astar`, flota experimental | 166 / 8 / 26 | 96% | 83% | 0,877 | 8,120 |

Sin flota: supervivencia ponderada 99,75% (legacy) y 95,5% (temporal); evacuación
ponderada 81,42% y 81,67%. PRO recogió/entregó 37/34 personas con legacy y 63/55 con
temporal. **La flota reduce evacuados en ambas configuraciones de esta semilla**.
El temporal también registra más mordidos que legacy sin flota. Se conserva el
predeterminado y se publican regresiones; no se atribuye mejora universal al PRO.

Benchmark separado: snapshot inicial R3 estable, 200 agentes, una solicitud de
calentamiento por sobreviviente y 10.000 solicitudes medidas por carga:

| Carga | p50 ms | p95 ms | p99 ms | Máximo ms | Éxitos / fallos / timeouts |
| --- | ---: | ---: | ---: | ---: | ---: |
| Sostenida, concurrencia 16 | 1,003 | 2,493 | 3,352 | 11,716 | 10.000 / 0 / 0 |
| Sostenida, concurrencia 200 | 12,413 | 25,167 | 70,662 | 136,055 | 10.000 / 0 / 0 |
| Ráfagas sincronizadas, concurrencia 200 | 14,737 | 32,154 | 107,585 | 151,709 | 10.000 / 0 / 0 |

```sh
GOMAXPROCS=2 npm run bench:backend -- --requests 10000 --concurrency 16 --output reports/delivery/http-c16.json
GOMAXPROCS=2 npm run bench:backend -- --requests 10000 --concurrency 200 --output reports/delivery/http-c200.json
GOMAXPROCS=2 npm run bench:backend -- --requests 10000 --concurrency 200 --burst --output reports/delivery/http-burst200.json
```

Evidencia cruda local: `services/evacuation/reports/delivery-20261027/` (privada,
ignorada por Git); repetir genera otros tiempos. Snapshot estable no mide cambios
de zombies/rutas/reservas: las rondas sí. No extrapolar solicitudes/s a espectadores.

`npm run bench:hydrology` también terminó **PASS: 25 escenarios completos,
12.510 turnos**, seis horizontes de 30–3.000 con replay lógico idéntico, nueve
combinaciones lluvia/comportamiento, inundación compuesta y tres mallas del
maestro con 200 agentes. Residual absoluto máximo de masa: 0,000221203 m³,
dentro de la tolerancia física del benchmark. En FULL, solicitar celdas de 50/200 m
produce resolución efectiva de 216,097/220,5 m para respetar el límite de 4.096
celdas; no se presenta como una malla efectiva de 50 m. Esta medición coexistió
con otras suites: sus tiempos no acreditan SLA hidráulico ni zombie. Evidencia
privada: `services/evacuation/reports/phase8/summary.json`.

## Validación de entrega

Las suites HTTP/navegador levantan procesos locales efímeros; nunca hacen carga
sobre producción. [QA](../tools/qa/README.md) detalla flags Flutter y capturas
privadas. Flutter es complementario, sin build Web. Chromium con perfiles móviles
no acredita Safari real ni ejecución física Android.

| Comprobación ejecutada en esta consolidación | Resultado |
| --- | --- |
| `npm install` | PASS; auditoría reportó cero vulnerabilidades |
| `contracts:validate`, `contracts:generate`, `tokens:generate`, `npm run check` | PASS; contrato, generados, tipos y lint sincronizados |
| `npm test` | PASS histórico: 166 pruebas web; el servicio starter probado entonces fue retirado después |
| `npm run build:web` | PASS |
| `npm run graph:test` | PASS: 10 pruebas offline |
| `npm run test:backend -- -timeout 5m` | PASS; incluye aplicación, sesiones, flota, capacidad, hidrología y laboratorio |
| `npm run test:race -- -timeout 5m` | PASS global, sin carreras detectadas; laboratorio 184,211 s, sesiones 95,430 s, aplicación 89,660 s |
| `node tools/scripts/go.mjs vet ./...`, `npm run build:backend` | PASS |
| Regresión focal de cierre y moderación con `-race` | PASS; 32 cierres concurrentes, doble cancelación/reinicio HTTP, operador real y rechazo de anónimo/local/revocado |
| `npm run test:contracts:http -- --flutter` | PASS: JSON HTTP y una integración Dart legacy |
| `npm run test:contracts:simulations` | PASS: 4.662 aserciones |
| `npm run test:contracts:flood` | PASS |
| `npm run test:spectators:http -- --flutter` | PASS: dos integraciones Dart de publicados/incidentes; cargas locales de 1/10/50 lectores sin errores |
| `npm run test:e2e` | PASS: 12 casos Chromium escritorio/móvil |
| `npm run test:spectators:browser` | PASS: React/Go y espectadores móviles reales en Chromium |
| `npm run test:simulations:browser` | PASS; inicio manual, mínimo de 30 turnos y flujos vigentes sin comparador UI retirado |
| `npm run test:visualization:browser` | PASS; snapshot pausado sincronizado antes de comprobar congelación visual |
| `npm run test:lab:flood` | PASS: Go/React/Chromium reales, BASE/FULL, candidatos, rutas, pausa/reinicio y comparación API conservada |
| `npm run mobile:check`, `mobile:test`, `mobile:build` | PASS: analyze, 30 pruebas/3 integraciones omitidas por defecto, APK debug; las integraciones HTTP anteriores se habilitaron explícitamente |
| `make verify` | PASS integral web/Go; salida 0 |
| `make help/setup/dev/smoke/stop` | PASS: setup repetible sin sobrescribir, doble dev rechazado, cierre confirmado y recuperación de registro parcial sin borrar datos |
| Demo PRO R3/200, semilla 42, React/Go reales | PASS: cinco vehículos, recorrido publicado, forecast, métricas y pausa; capturas privadas escritorio/390 px sin desborde |
| Enlaces documentales | PASS: 453 referencias verificadas al integrar |
| Docker, imagen `corodev-backend:delivery-review` | PASS: build, usuario no-root, readonly, health, inicio idle, sesión official R3, 200 decisiones autenticadas y aislamiento |
| Inventario AWS de sólo lectura | PASS: STS no-root, instancia running m7i-flex.large en Ohio, 2 vCPU/8 GiB, gp3 cifrado 20 GiB y Budget 50 USD/mes HEALTHY; sin cambios ni carga |
| Empaquetado AWS local | PASS: paquete de imagen, React HTTPS, OpenAPI, rollout y checksums (aprox. 40 MB) en `deploy/releases/delivery-review-20261027`; no ejecuta operaciones AWS ni implica despliegue |
| Benchmark HTTP y comparación de agentes | PASS: 30.000 solicitudes estáticas y 16 rondas completas; tablas anteriores |
| `npm run bench:hydrology` | PASS: 25 escenarios, 12.510 turnos; conservación, límites físicos y replays |

La línea base reveló literales de prueba `StatusUpdate` desactualizados, un bloqueo
real al cerrar una aplicación ya cancelada y expectativas antiguas de autorización.
Se corrigieron sin modificar el evaluador ni las reglas del motor. La revisión
HTTP ahora prueba éxito/409 con identidad de operador real y denegación para
sesión local; no se relajó la seguridad para aprobar una prueba. Los fallos
iniciales de web/Flutter por expectativas obsoletas también se corrigieron antes
de ejecutar sus suites finales completas.

`make verify` final terminó **PASS** (salida 0): documentos, contrato/derivados, lint/tipos, Go/race, geografía, HTTP real y builds; después 166 pruebas web y las del servicio starter de aquella versión. Navegador, Flutter, benchmarks y Docker se ejecutaron además, según la tabla.


## Publicación AWS autorizada

El commit `47f51fa` se publicó y desplegó el 27 de octubre de 2026, preservando
credenciales, límites y datos ciudadanos. [Evidencia y hashes de aquella entrega](../deploy/deployment-delivery-20261027.json).
Por HTTPS se verificaron health, capacidades y publicados; una tormenta BASE de
ocho agentes avanzó, pausó, reanudó, aceptó doble cancelación, reinició y volvió
a avanzar. Se dejó cancelada. `/paso` conservó 401/200 y vecino/espera válido;
`/estado` permaneció en turno 0. CloudFront completó invalidación; las tres páginas
y los assets comprobados coinciden por hash con el build preparado.

No se ejecutaron suites, E2E, benchmarks ni una ronda de 150 turnos durante el
despliegue. Estas comprobaciones acotadas no certifican rendimiento FULL_MANTA
ni capacidad sostenida de EC2. Los contenedores anteriores y backup privado se
conservan para reversión.
