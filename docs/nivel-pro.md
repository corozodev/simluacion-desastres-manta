# Nivel PRO: implementación y demostración

[Índice](INDEX.md) · [Arquitectura](arquitectura.md) · [Matriz y mediciones](pruebas.md)

Las tres funciones intervienen en el motor Go. La flota sigue siendo experimental:
el preset `official` la rechaza. Dos aristas por turno representan el doble de
movimientos discretos del peatón; no acreditan el doble de velocidad en metros por
segundo. El [informe histórico de FASE 7](informe-fase7.md) conserva las decisiones
y regresiones originales.

| Función | Estado | Código y prueba | Qué observa el jurado |
| --- | --- | --- | --- |
| Predicción de corredores | CUMPLE, modelo no calibrado | [Predictor](../services/evacuation/internal/decision/probability.go), [regresión de ruta anticipada](../services/evacuation/internal/decision/phase2_test.go) | Capa opcional de riesgo por nodo y ruta del superviviente seleccionado; no hay trayectoria individual futura publicada |
| Capacidad y asignación | CUMPLE | [Coordinador](../services/evacuation/internal/coordination/planner.go), [saturación y 200 agentes](../services/evacuation/internal/coordination/planner_test.go) | Ocupadas/capacidad, reservadas y libres; cambio del destino y ruta actuales |
| Cinco camionetas, cuatro plazas y recogida/entrega | CUMPLE en modo experimental | [Flota](../services/evacuation/internal/simulation/fleet.go), [conservación y bloqueos](../services/evacuation/internal/simulation/fleet_test.go) | ID, posición, carga, estado/destino y recorrido real del último turno |
| Doble velocidad física por tipo de vía | PARCIAL | `moveFleet`: hasta dos aristas por turno; peatón: una | El mapa representa nodos y aristas observados, sin inferir velocidades métricas |

## Predicción: observaciones y horizonte

`RunnerPredictor.Probabilities` proyecta los extremos de cada corredor a uno y dos
turnos. Usa el grafo, cierres, posiciones visibles de corredores y supervivientes
activos, incluidos pasajeros a bordo. Detecta presas hasta tres saltos físicos;
proyecta hasta dos aristas dirigidas/transitables por turno. Ante una presa asigna
70 % de masa a la persecución y 30 % al movimiento aleatorio; sin presa, todo el
peso es aleatorio. El segundo horizonte mantiene inmóvil la última posición
observada de la presa. La unión de varios corredores aproxima independencia.

No recibe RNG, dormidos ocultos, futuros cierres ni memoria privada de políticas
experimentales. Las probabilidades corresponden al modelo, sin calibración local.
La [publicación de sesiones](../services/evacuation/internal/sessions/lifecycle.go)
recalcula `runner_forecast` después de cada paso y conserva su turno. El mapa
rechaza pronósticos de otro turno y limita la capa a los 64 nodos con mayor riesgo
positivo del turno siguiente; el título muestra también el segundo horizonte.

El [motor `legacy_current`](../services/evacuation/internal/decision/engine.go)
conserva su predictor heurístico `Predict`: envolventes y persecución probable con
pesos relativos. Su mapa público probabilístico es una observación complementaria,
no la representación exacta de todos los pesos internos. El algoritmo alternativo
[`predictive_temporal_astar`](../services/evacuation/internal/decision/algorithms.go)
busca sobre nodo/etapa y sí usa las distribuciones de uno y dos turnos. Incluye
riesgo de cruce opuesto y compara una espera inicial; limita expansiones y no
promete el óptimo temporal global. `baseline_shortest_path` y
`dynamic_risk_astar` no añaden esa penalización predictiva temporal. Seleccionar un
algoritmo y activar una capa son operaciones diferentes.

Al moverse una presa, corredor o cierre, cambia la huella de contenido y se
reconstruyen entradas incompatibles. `TestPredictionReactsToObservableTargetChangesAndClosures`
y `TestPredictionAvoidsTheOriginalEnginesLikelyChaseEndpoint` comprueban ese cambio
sin revelar información privada. Los límites HTTP se miden separadamente del
cálculo del plan en [pruebas](pruebas.md).

## Refugios: capacidad, reservas y concurrencia

`Planner.Prepare` obtiene candidatos por refugio, los valida y asigna primero a
los agentes más restringidos, seguido del costo/riesgo de perder su mejor opción.
Conserva destinos válidos dentro de una tolerancia de costo del 15 % si no empeora
el riesgo. Resuelve empates de forma determinista y balancea ocupación relativa.
Sin la asignación PRO se usa orden greedy por ID, conservando la capacidad.

```text
capacidad = límite configurado
ocupación = personas realmente admitidas
reservas = agentes activos asignados, incluidos pasajeros con destino válido
disponibles = capacidad − ocupación − reservas
```

Las reservas se reconstruyen desde el conjunto activo, no se acumulan desde el
turno anterior. Antes de coordinar peatones se protegen las plazas de pasajeros.
El simulador valida asignaciones y reconcilia reservas bajo su único escritor;
una llegada sólo consume una plaza admisible. Muerte, entrega, destino inaccesible
o reasignación liberan la reserva. Un refugio lleno sale de candidatos; se elige
otro alcanzable con plaza o se publica espera/salida segura sin inventar destino.

Las peticiones concurrentes `/paso` leen el mismo plan publicado y no reservan.
`Test200SurvivorsBalancedWithoutOverassignmentOrMutation`,
`TestPermutationAndConcurrentPrepareStayDeterministic` y
`TestFullOrBlockedDestinationReassignsToAlternative` verifican saturación,
concurrencia y reasignación. [Pruebas del simulador](../services/evacuation/internal/simulation/phase2_test.go)
comprueban que una llegada sin asignación no roba una reserva ajena.

En React, verde significa plazas libres, ámbar 20 % o menos libre y rojo ninguna
libre. La señal usa ocupación **más reservas**; rojo no significa que todas las
personas hayan llegado. El título del refugio y **Refugios y agentes** separan las
cuatro cifras. La lista muestra destino actual y permite observar su ruta; no
mantiene una cronología visual de todas las reasignaciones.

## Rescate: selección, recorrido y supervivencia

`initializeFleet` crea cinco camionetas de cuatro plazas, con depósitos en los
refugios ordenados por ID, de manera cíclica. No consume RNG. Después de los zombis
y antes de los peatones, cada vehículo recorre hasta dos aristas reales.
`fleetRoute` usa BFS sobre calles permitidas, evitando amenazas observables,
hordas y cruces opuestos publicados. La ruta de flota minimiza saltos, no tiempo
métrico por tipo de vía.

`fleetPickup` considera sólo objetivos activos, sin otro vehículo, no reclamados,
alcanzables y con refugio viable. Prioriza utilidad positiva:
`4*necesidad + 2*(ETA_pie−ETA_recogida−ETA_entrega) − 0.25*ETA_recogida`.
La necesidad suma cercanía a amenazas visibles; las ETA vehiculares redondean
saltos/2 y la peatonal cuenta saltos. Los empates son por ID. Conserva un objetivo
viable, revalida cada turno y recoge en orden determinista a las personas que
coinciden en el nodo y caben en vehículo y refugio. No optimiza una gira global de
múltiples paradas ni fuerza viajes sin utilidad.

Abordar/desembarcar en el nodo actual no consume otro movimiento. Un pasajero
permanece `active`, comparte el nodo del vehículo y sigue expuesto a mordidas;
queda fuera del movimiento peatonal y `/paso` devuelve espera para él.
`fleetDeliver` incrementa evacuados y ocupación únicamente al llegar al refugio,
tras verificar colisiones y capacidad. Ante cierre se recalcula destino/ruta;
sin ruta, espera a bordo y libera reservas que ya no sean admisibles.

Estas convenciones sobre depósitos, embarque y exposición son supuestos
experimentales explícitos. `TestFleetCapacityDeliveryAndPassengerConservation`
comprueba cuatro pasajeros, entrega posterior y conservación;
`TestFleetReplansBlocksAndReleasesUnreachableReservation` y
`TestFleetReassignsShelterAtomically` cubren cierre, reapertura y destino alterno.
Los tests de pasajeros cubren mordidas por nodo y cruce, incluida entrega detenida.

## Demostración reproducible

1. Ejecutar `make dev` y abrir `/escape`. Antes de iniciar sólo se explora el grafo.
2. Elegir ronda **Apocalipsis**, grafo básico, 200 agentes. En **Configuración
   avanzada**, usar semilla `42`, modo experimental, aleatorio clásico,
   `legacy_current`, 150 turnos y las tres funciones PRO activadas. Mantener los
   cuatro refugios originales. Pulsar **Iniciar simulación** explícitamente.
3. En **Capas**, activar predicción. Seleccionar una persona desde **Refugios y
   agentes** para seguir su ruta; consultar las cifras de cada refugio y los
   títulos de las camionetas. La línea discontinua de vehículo corresponde al
   recorrido del último turno, no a una intención futura. Las métricas muestran
   pronóstico publicado, ocupación/capacidad y pasajeros a bordo/entregados.

La misma configuración y semilla reproducen el resultado lógico; tiempos HTTP,
polling y animación no forman parte del determinismo. Las coincidencias de
vehículos en un nodo son reales; sus etiquetas se separan sin cambiar posiciones.
El visor `/mobile` y Flutter sólo observan la ejecución publicada y no ofrecen
controles. El pronóstico detallado se muestra en la sesión de escritorio; no se
supone publicado en todos los visores.

Para demostrar **A: replanificación anticipada**, **B: refugio lleno y reasignación**
y **C: embarque de cuatro y entrega**, las regresiones controladas usan el motor
real y fixtures exclusivamente de pruebas; no se crea un simulador de demostración:

```sh
node tools/scripts/go.mjs test ./internal/decision -run 'TestPredictionAvoidsTheOriginalEnginesLikelyChaseEndpoint|TestPredictionReactsToObservableTargetChangesAndClosures'
node tools/scripts/go.mjs test ./internal/coordination -run 'TestFullOrBlockedDestinationReassignsToAlternative|Test200SurvivorsBalancedWithoutOverassignmentOrMutation'
node tools/scripts/go.mjs test ./internal/simulation -run 'TestFleetCapacityDeliveryAndPassengerConservation|TestFleetReassignsShelterAtomically'
```

La ronda urbana anterior permite observar capacidades reales; no garantiza que
un evento visual concreto ocurra justo al abrir el mapa, ni expone el motivo
causal de cada cambio de ruta. Una prueba controlada y una observación en vivo
aportan evidencias diferentes. Para repetir R3 completa con PRO y HTTP autenticado:

```sh
npm run compare:agents -- --mode experimental --rounds 3 --seeds 42 --repeats 2 \
  --algorithms legacy_current,predictive_temporal_astar --fleet \
  --output reports/delivery-20261027/pro-r3
```

La medición local de entrega repitió los hashes lógicos y registró 42.026
solicitudes HTTP sin errores/timeouts. `legacy_current` recogió 37 y entregó 34;
el temporal recogió 63 y entregó 55. No todos los recogidos llegaron vivos al
refugio. El máximo p95 por ejecución fue 8,120 ms; no es un SLA AWS. Con semilla 42
la flota **no mejoró la supervivencia general** respecto de sus pares sin flota.
La [matriz y metodología](pruebas.md) registra resultados, alcance y evidencia.

## Revisión de movilidad y visualización — 28/10/2026

Auditoría del código vigente y fixtures unitarias breves. No se reprodujo la
incidencia original de Ronda 3: no se aportó su snapshot ni su configuración
completa. La flota corresponde a PRO experimental; `official` sigue sin flota.

### Camionetas

Se confirmó un fallo de orden: las recogidas reclamadas se registraban antes de
validar su accesibilidad. Un vehículo posterior podía retener un objetivo
inaccesible mientras uno anterior, capaz de rescatarlo a otro refugio, quedaba
inactivo ese turno. La regresión controlada fallaba antes de corregirlo. Ahora
`moveFleet` libera primero los objetivos inválidos de toda la flota y después
asigna tareas. Se conservan puntuación de utilidad, seguridad y desempates.

| Pregunta de auditoría | Resultado |
| --- | --- |
| 1. ¿Qué ocurre al llegar al refugio? | Se comprueban colisión y capacidad; los pasajeros activos pasan a evacuados, aumenta la ocupación y se vacía el vehículo. |
| 2. ¿Descargar evalúa nuevas tareas? | Sí, en la misma iteración. Abordar/descargar no consume aristas; sólo puede utilizar las restantes de las dos permitidas. |
| 3. ¿Puede atascarse en idle por falta de actualización? | No hay un latch de idle. Sí existía la demora de un turno por reserva inaccesible descrita arriba. |
| 4. ¿Se vuelve a evaluar en turnos posteriores? | Sí. Una prueba parte de espera sin utilidad e inicia recogida al aparecer una amenaza observable que hace útil el rescate. |
| 5. ¿Se consideran supervivientes alcanzables aún activos? | Sí: activos, a pie, sin otra reclamación, con recogida y refugio seguros y utilidad positiva. |
| 6. ¿Otros vehículos reservan objetivos? | Sí, para evitar perseguir duplicados. La depuración previa elimina reclamaciones imposibles antes de asignar al primer vehículo. |
| 7. ¿Se liberan al morir, evacuar o quedar inaccesibles? | Las recogidas se revalidan antes de asignar; las reservas de plazas se reconstruyen desde agentes activos y se reconcilian tras muerte/entrega/reasignación. Pasajeros sin refugio admisible liberan su destino reservado. |
| 8. ¿Se respetan restricciones reales? | BFS usa aristas transitables y dirigidas, amenazas despiertas, nodo/vecinos de hordas y cruces opuestos observados. No consulta sleepers ocultos. |
| 9. ¿Hay un error descarga → idle permanente? | No se confirmó. La prueba descarga y comienza otra recogida sin exceder dos aristas. Se corrigió la reserva obsoleta, no el ciclo de descarga. |
| 10. ¿Cuándo es legítimo permanecer en el refugio? | Sin objetivos activos/libres, sin ruta segura, sin refugio con plaza o sin utilidad positiva. La ida/vuelta desde depósito puede no ahorrar turnos. |

`wait_reason` identifica la categoría de espera sin buscar rutas adicionales
para diagnosticarla: usa los resultados del recorrido de selección existente.
La revalidación de objetivos antes de asignar sí usa las comprobaciones de ruta
necesarias para liberar la reclamación inválida. Las regresiones mantienen cinco
vehículos, cuatro plazas, entrega posterior al embarque, exposición a mordidas,
conservación y hasta dos aristas reales por turno. No se afirma doble velocidad
métrica ni que una flota deba permanecer siempre en movimiento.

### Supervivientes

El flujo sigue siendo snapshot coherente → HTTP autenticado `/paso` → routing →
validación de vecino/cierre/horda → aplicación serial del turno. Timeout o fallo
HTTP dejan al agente en su nodo; turno/nodo obsoleto produce conflicto HTTP.
Los códigos observables existentes se reutilizan en `immobility_reason`:

| Categoría | Motivos y alcance |
| --- | --- |
| Bloqueo | `no_geographic_route`, `blocked_route`, `visible_threat_route`, `shelter_full`; describen conectividad y ocupación observables. El grafo de inicio validado ya exige acceso geográfico a refugios. |
| Espera válida posible | `wait_with_route`: hay conectividad, pero no se publica el motivo interno exacto. Incluye decisiones temporales de esperar y falta de asignación por reservas; no acredita por sí solo que esperar sea óptimo. `scenario_wait` corresponde a una espera explícita del escenario hidráulico. |
| Pasajero / rescate | `aboard` si permanece en el mismo nodo dentro de una camioneta. La recogida asignada se muestra desde el objetivo real de flota; a pie continúa decidiendo y no se fabrica una espera de rescate. |
| Fallo | `timeout`, `decision_error` e `invalid_movement`, diferenciados de las esperas válidas. |

`stationary_turns` cuenta turnos consecutivos, se reinicia al cambiar de nodo y
se congela en terminales. Los pasajeros se cuentan una vez, independientemente
del número de segmentos. Se reutilizan los mapas de disponibilidad ya calculados
por turno y lecturas O(1) por persona; no se añade routing por persona para
explicar la inmovilidad. El informe privado de diagnóstico sigue separado.

La histéresis existente limita cambios pequeños de costo/riesgo. Reversiones e
invalidaciones siguen registradas offline; no se confirmó un bug de oscilación
ni de caché obsoleta que justifique alterar algoritmos. El pronóstico temporal
puede preferir esperar en un nodo seguro. No se forzó movimiento para animar el
mapa ni se cambiaron políticas zombie, RNG o el evaluador FASE 1.

### Visualización y archivos

La selección de persona en `AgentShelterPanel` y `/mobile` muestra estado,
destino y diagnósticos disponibles. La selección de camioneta reutiliza el popup
compacto del mapa y muestra ID, estado, carga, objetivo, refugio y espera; soporta
teclado y devuelve el foco al cerrar. Las variantes, colores, agrupación y límites
se describen en el [catálogo visual](../packages/visualization/README.md#variantes-de-zombis).
La leyenda está en **Capas** y conserva las claves existentes de supervivientes,
refugios y camionetas. Dormidos ocultos no generan marcadores.

Archivos funcionales: `internal/simulation/fleet.go`, `simulation.go` y
`internal/world/models.go` en Go; `Escape.tsx`, `WorldMap.tsx`,
`maps/AgentShelterPanel.tsx`, `maps/mobilityLabels.ts`, `mobile/MobileViewer.tsx`,
`visualization/AnimatedEntities.tsx`, `model.ts`, `ZombieGlyph.tsx` y sus CSS en
React. Las fuentes compartidas son `openapi.yaml`, `tokens.json` y `catalog.json`;
los derivados TypeScript, JSON Schema y Dart se regeneraron. Pruebas en
`simulation/fleet_test.go`, `mobility_test.go`, `httpapi/api_test.go` y los cuatro
archivos React de mapa, panel, visualización y visor móvil.

### Validación focalizada y límites

Comandos ejecutados (desde raíz; filtros deliberados):

```sh
npm run contracts:validate
npm run contracts:generate
npm run tokens:generate
npm run generated:check
node tools/scripts/go.mjs fmt ./internal/world ./internal/simulation ./internal/httpapi
node tools/scripts/go.mjs vet ./internal/simulation ./internal/world ./internal/httpapi
node tools/scripts/go.mjs test ./internal/simulation -run 'TestFleet|TestIdleFleet|TestObservableImmobility|TestStationary|TestSleeperHiddenUntilWithinTwoNodesThenWalkerCadence' -count=1 -v
node tools/scripts/go.mjs test ./internal/httpapi -run 'TestMobilityDiagnosticsKeepExactPasoOverHTTP|TestStepValidationAndExactResponse' -count=1
node tools/scripts/go.mjs test ./internal/decision -run 'TestPhase7TemporalSearchUsesObservableForecastAndCanWait|TestOnboardSurvivorNeverReceivesWalkingDecision' -count=1
npm run test --workspace @corodev/web -- src/tests/phase7-map.test.tsx src/tests/agent-panel.test.tsx src/tests/visualization.test.tsx
npm run test --workspace @corodev/web -- src/tests/mobile.test.tsx -t 'diagnóstico de inmovilidad'
npm run typecheck --workspace @corodev/web
npx eslint apps/web/src/features/{Escape.tsx,WorldMap.tsx,maps/AgentShelterPanel.tsx,maps/mobilityLabels.ts,mobile/MobileViewer.tsx,visualization/AnimatedEntities.tsx,visualization/ZombieGlyph.tsx,visualization/model.ts} apps/web/src/tests/{phase7-map.test.tsx,agent-panel.test.tsx,visualization.test.tsx,mobile.test.tsx}
git diff --check
```

Las pruebas Go específicas pasan: flota, motivos/cuenta de espera, activación de
sleepers y `/paso` con HTTP real autenticado y motor de routing real para peatón
y pasajero. La respuesta conserva exclusivamente `siguienteNodo`. Las pruebas
React (38 casos aprobados) comprueban siluetas, agrupación por tipo, selección/leyenda, nodos de horda,
privacidad de sleepers, movimiento reducido y ausencia de reloj por entidad.
El caso móvil seleccionado pasa; sus otros ocho casos se omiten deliberadamente.
ESLint sobre los archivos TypeScript modificados, `typecheck`, `go vet` de los
tres paquetes afectados, derivados y `git diff --check` pasan. Una comprobación
local de los tres documentos editados verificó sus 25 enlaces/anclas relativos;
no se ejecutó el verificador global de documentación.

Fallos durante preparación: la regresión de reserva confirmó el bug antes del
arreglo; se corrigieron fixtures de depósito/distancia de amenaza. Una fixture
geográficamente desconectada fue rechazada por el validador y retirada, porque
no representa un mundo inicial admitido. No se relajó la validación del grafo.

No se ejecutaron suites globales, E2E, benchmarks, rondas completas, pruebas de
pintura en navegador ni Flutter. No se midió p95 nuevo, capacidad ni FPS: esas
mediciones quedan pendientes fuera de este alcance. La revalidación de flota y
el diagnóstico ocurren en el escritor del turno, sin nuevos cálculos en el
handler `/paso`; esto no sustituye una medición de latencia. No hubo operaciones
AWS, cambios productivos, commits ni despliegues.
