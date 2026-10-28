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
