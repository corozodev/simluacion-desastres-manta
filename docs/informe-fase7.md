# FASE 7 — políticas, planificación y funciones PRO

Implementación local del **27 de octubre de 2026, Ecuador (UTC−05:00)**.
La evidencia resumida está en [validation-phase7.json](../deploy/validation-phase7.json).
Esta fase conserva el motor FASE 1 congelado, los grafos y reportes históricos,
el JSON español de `POST /paso`, su autenticación `x-api-key`, Flutter legacy
inactivo y los servicios independientes de inundaciones. No agrega dependencias,
servicios AWS ni almacenamiento. No se hizo push ni despliegue.

## Implementación y reutilización

Se reutilizan `world.Store`, el simulador de escritor único, HTTP loopback
real autenticado, el catálogo BASE/FULL_MANTA, las cuatro zonas de aparición,
el predictor anterior, Dijkstra inverso por refugio, la coordinación de capacidad,
los diagnósticos FASE 2 y las sesiones FASE 5. `legacy_current` sigue siendo el
planificador predeterminado; `classic_random` conserva exactamente un `Intn` por
paso aleatorio, incluso cuando sólo existe una salida. La regresión histórica
38 evacuados / 150 mordidos / 12 activos sigue cubierta por el evaluador congelado.

Cada sesión construye sus propios motores, cachés, PRNG, overlays y memoria.
Reiniciar conserva configuración y semilla pero crea otra ID y credencial.
Pausar detiene turnos sin consumir aleatoriedad; recuperar una credencial sólo
observa. Los cambios de políticas requieren una ejecución nueva.

| Componente | Estado ejecutable |
| --- | --- |
| 7A | Tres políticas, memoria privada acotada, baseline exacto y pruebas de cadencia/detección/bloqueos |
| 7B | Planificador anterior y tres seleccionables, caché, costos, amenazas, espera y fallback |
| 7C | Pronóstico observable probabilístico, reservas coherentes y flota experimental 5×4 |
| 7D | Selectores reales, reglas oficiales validadas en Go, flota/capacidad/pronóstico en React |
| 7E | Comparación explícita secuencial de dos algoritmos en React; matrices independientes por CLI, replay, JSON/CSV |
| 7F | Unitarias, race, contratos HTTP, navegador real, Flutter, regresión de inundación y mediciones locales |

## Políticas zombie

`classic_random` deja intactas las reglas existentes: caminante una arista cada
dos turnos propios; runner hasta dos aristas y persecución sólo al detectar
una presa a tres saltos; horda inmóvil por defecto; sleeper oculto hasta detectar
presa a dos saltos, después cadencia caminante. La proximidad física no dirigida
se distingue de las rutas dirigidas/transitables. Primero se mueven zombis.
Se conservan coincidencia final y cruces opuestos de todos los segmentos.

Las otras dos políticas se usan sólo para deambular, conservando cadencias,
detección, persecución y velocidad. Son **experimentales** porque cambian la
distribución de direcciones, aunque respeten los límites físicos.

- `correlated_random_walk`: `w(e)=exp(1.4*cos(ángulo con dirección previa))`;
  muestreo ponderado sembrado sobre vecinos transitables ordenados.
- `adaptive_exploration`: además divide el peso por `1+visitas_recientes(e.to)`;
  conserva hasta 16 nodos recientes y una dirección objetivo local estocástica.
  La persistencia dura entre 1 y 8 movimientos con continuación de probabilidad
  0,65. Es una caminata persistente acotada; **no implementa una ley de Lévy**.

Todo vecino permitido conserva peso positivo. Un callejón permite volver atrás;
no hay saltos largos, destinos omniscientes ni comunicación privada al planificador.

## Planificadores y costos

El costo vial se reutiliza:

```text
c(e) = [1 + distancia_m/1000 + distancia_m/(velocidad_mps*100)] * multiplicador_overlay
J(ruta) = suma(c(e)) + 0.6 * riesgo_visible + penalización_predictiva
```

Un zombie visible ocupa un destino prohibido; una horda excluye además todos
sus vecinos físicos, incluso si las calles son entrantes o cerradas. Los cruces
opuestos publicados son restricciones estrictas. Los sleepers dormidos se ignoran
incluso si un snapshot defectuoso intentara incluirlos. Bloqueos y direcciones
se validan otra vez en el simulador.

- `legacy_current`: comportamiento previo con búsquedas inversas compartidas,
  envolvente de exposición y retención de rutas; conserva pesos anteriores.
- `baseline_shortest_path`: mínimo costo vial ponderado dentro del subgrafo
  permitido, sin exposición blanda adicional. No ignora restricciones duras.
- `dynamic_risk_astar`: A* con costo vial + riesgo visible. Usa como heurística
  admisible la distancia vial inversa ponderada al refugio.
- `predictive_temporal_astar`: A* sobre `(nodo, etapa_temporal)`, con dos etapas
  de pronóstico y cola estática. Agrega `12*p1(nodo1)` y
  `12*(0.35*p2(nodo2)+p_cruce_opuesto(arista2))`. Llegar a un refugio admisible
  termina la exposición antes del siguiente turno zombie.

```text
preparar(snapshot observable):
  construir restricciones y huella de grafo/turno/contenido efectivo
  reutilizar búsquedas inversas compatibles; pronosticar si corresponde
  por nodo origen y refugio: buscar ruta, cachear resultado del snapshot
  conservar ruta previa sólo si sigue segura y cerca del mejor costo
  coordinar destinos sobre todas las plazas reales; publicar plan coherente
/paso(sobreviviente, nodo, turno):
  leer snapshot y plan; devolver un vecino seguro o el mismo nodo
simulador:
  aplicar y validar el paso; resolver mordida, llegada y reservas
```

La espera temporal compara comenzar ahora con retrasar un turno; exige mejora
superior al margen de retención del 15%. No se publican rutas con ciclos para
simular esperas. El temporal favorece rutas simples, satura el horizonte y limita
expansiones a `4*|V|+16`, con fallback de ruta base segura. **No garantiza el óptimo
entre todos los paseos temporales posibles**. Cancelación y falta de ruta producen
espera válida. La conexión interna de `application` tiene timeout completo de
**400 ms**, menor que 500 ms; fallos siguen sujetos a espera. La preparación global
ocurre antes de las solicitudes y se mide por separado.

Las cachés incluyen versiones y contenido efectivo del grafo/estado, bloqueos,
recorridos visibles, destinos y capacidad. Sólo se reutilizan resultados dentro
del motor de una sesión; rutas retornadas son copias. No se implementó D* Lite:
no se demostró una ventaja que justificara añadir otro estado incremental.

## Pronóstico y calidad

El predictor nuevo calcula distribuciones de extremos de runners para uno y dos
turnos a partir de estado observable. Cada runner reparte masa normalizada: 70%
para persecución del objetivo actualmente detectable y 30% para incertidumbre
aleatoria; sin presa detectable, 100% aleatorio. Respeta hasta dos aristas legales.
El segundo horizonte conserva las posiciones observadas de las presas. La unión
de varios runners se aproxima como `1-producto(1-p_runner)`. Las aristas se expresan
en el sentido del sobreviviente expuesto a un cruce opuesto.

Son probabilidades **del modelo, sin calibración empírica**. No se anticipan eventos
privados, cambios de objetivo reales ni sleepers dormidos; tampoco se conoce la
memoria privada de los zombis experimentales. El predictor histórico y sus pesos
no se sustituyen dentro de `legacy_current`.

La evaluación fija el pronóstico **antes** de avanzar el mundo y lo compara con
el extremo visible del turno siguiente. `hits/misses` cuentan extremos reales
con/sin soporte positivo; `false_positives` cuenta nodos con soporte no ocupados.
El Brier promedio evalúa todos los nodos, incluidos ceros y extremos omitidos,
no sólo candidatos favorables. El score sin muestras vale cero por convenio,
no como evidencia de precisión. Los informes CLI auditan el predictor aunque
esté desactivado para decisiones, separando medición de intervención.

## Capacidad y flota

La asignación global previa se reutiliza: orden por restricciones/regret, costo,
riesgo, capacidad y retención. Al desactivar el PRO se usa selección independiente
greedy por ID, conservando los límites atómicos. Ninguna consulta `/paso` reserva
plazas. El simulador reconstruye reservas desde asignaciones activas y revalida
rutas/capacidad cada turno. Muerte, llegada o cambio de destino liberan la plaza;
una sesión caducada libera todo su estado. No hay leases independientes del reloj
del simulador. Falta de capacidad puede dejar agentes sin destino, con espera o
salida segura; no se inventa un refugio.

La flota es **experimental**, pues el reto no fija depósitos, orden de embarque,
exposición vehicular ni prioridad de admisión. Convenciones implementadas:

1. Cinco camionetas, cuatro pasajeros cada una. Depósitos en refugios ordenados
   por ID de forma cíclica, sin consumir RNG ni modificar poblaciones iniciales.
2. Después de zombis y antes de peatones, cada camioneta recorre hasta dos aristas
   dirigidas/transitables reales. Recoger/entregar en el nodo actual no consume una
   arista adicional. El vehículo y sus pasajeros comparten nodo real.
3. Objetivos vivos/accesibles con refugio viable. Utilidad positiva requerida:
   `4*necesidad + 2*(ETA_pie-ETA_recogida-ETA_entrega) - 0.25*ETA_recogida`.
   La necesidad suma proximidad visible; empates por ID. Se evita iniciar viajes
   sin ahorro/beneficio; no se fuerza actividad para mejorar estadísticas.
4. Embarque en orden de ID, sólo con plaza de vehículo y refugio. La capacidad
   reservada de pasajeros se proyecta como ocupación efectiva para el coordinador
   peatonal, conservando la ocupación real hasta la entrega.
5. Revalidación/replanificación cada turno. Sin ruta, pasajeros esperan a bordo;
   no se teletransportan ni se evacúan anticipadamente. Una reserva inaccesible
   se libera y puede reasignarse. La entrega exige el refugio y su capacidad real.
6. Pasajeros siguen `active` y son presas observables en el nodo del vehículo;
   quedan excluidos del movimiento peatonal y `/paso` devuelve espera si se consulta.
   No hay inmunidad: se resuelven coincidencias/cruces en cada segmento vehicular,
   incluida la comprobación previa a entregar un vehículo detenido. Esta convención
   de submovimientos es explícitamente experimental.

Se contabilizan recogidos, entregados, aristas recorridas y viajes con entrega.
Los pasajeros sólo incrementan evacuados y ocupación en el refugio. Movimientos y
retrocesos vehiculares entran en diagnósticos por agente. Hay pruebas de saturación,
conservación, vehículos sin ruta, muertos, cierre/reapertura, hordas, cambio de
refugio, mordidas antes de entregar y ausencia de solicitudes peatonales a bordo.

## Contrato y React

La fuente es `packages/contracts/openapi.yaml`; TypeScript, Dart y JSON Schema
se regeneraron. Las extensiones son opcionales; `/paso` mantiene exactamente
`sobrevivienteId`, `nodoActual`, `turno` → `siguienteNodo`.

`config` de creación/reinicio añade `mode`, `zombie_policy`,
`evacuation_algorithm` y `pro.{runner_prediction,shelter_assignment,rescue_fleet}`.
Omitirlos conserva modo editable experimental, zombis clásicos, motor anterior,
predicción/asignación activadas y flota apagada. Inundaciones rechaza opciones
zombie explícitas y conserva su composición anterior.

`official` exige BASE, zombis clásicos, población 20/80/200 según ronda,
refugios predeterminados, 150 turnos y 2.000 ms. No permite flota. **Oficial describe
las reglas configuradas**, no certifica las cantidades de zombis o posiciones
de refugios de nuestras fixtures como datos del jurado. FULL_MANTA mantiene su
habilitación y cupos propios, únicamente experimental.

Los snapshots añaden opcionalmente `fleet`, `fleet_metrics` y `vehicle_id`;
los estados privados añaden `runner_forecast`, ligado al turno, y los resultados
`analytics`. No se publican diagnósticos iniciales privados ni topología repetida.
`analytics.replans` cuenta **invalidaciones de rutas previas publicadas**, no todas
las llamadas al planificador; `arrival_turn=0` indica ausencia de llegada. La
eficiencia es saltos iniciales libres de amenazas divididos por aristas recorridas,
no una medida de optimalidad temporal global.

React conserva el mapa SVG, rutas, animaciones y panel de refugios/agentes. Muestra
camionetas/ocupación y permite una capa opcional de hasta 64 nodos de pronóstico
con mayor probabilidad. Los sprites de pasajeros a bordo se sustituyen por la
ocupación del vehículo. No se cambia política durante ejecución: se retira el
formulario. El formulario oficial impide modificar sus condiciones obligatorias.

El laboratorio compara explícitamente dos algoritmos con idéntica configuración
restante y semilla, en sesiones independientes **secuenciales**, respetando incluso
el cupo FULL=1. Abrirlo, montar React o refrescar no crea ejecuciones. Exporta JSON
con configuración/resultados y CSV con métricas; excluye credenciales. El replay
crea dos sesiones nuevas con las mismas entradas. Sus credenciales permanecen sólo
en memoria: cerrar la página pierde su observación y las sesiones caducan según
las reglas FASE 5. La sesión principal conserva su recuperación en `sessionStorage`.

## Reproducción, mediciones y límites

```sh
# R1/R2/R3, 150 turnos, dos semillas, cuatro algoritmos, dos repeticiones.
# Acelerado, pero cada decisión usa HTTP real autenticado.
GOMAXPROCS=2 npm run compare:agents -- --seeds 7,42 --repeats 2

# Misma herramienta con ritmo nominal de ronda; no confundir con acelerado.
GOMAXPROCS=2 npm run compare:agents -- --realtime --seeds 7 --repeats 1

# Experimento independiente, nunca etiquetado como comparación oficial.
GOMAXPROCS=2 npm run compare:agents -- --mode experimental --rounds 3 \
  --seeds 7 --algorithms baseline_shortest_path,predictive_temporal_astar \
  --zombie-policy adaptive_exploration --fleet --output reports/phase7/adaptive-fleet

GOMAXPROCS=2 npm run bench:backend -- --output reports/phase7/http-static.json
```

Se verificó además la consistencia de exportación predictiva con dos rondas R2 completas adicionales; la matriz principal de rendimiento conserva sus 60 ejecuciones.

La CLI verifica el hash de población inicial y grafo entre configuraciones, y
el digest de **todos los snapshots observables de cada turno**, incluidos eventos
y recorridos de vehículos, entre repeticiones. Sólo excluye latencias HTTP.
Exporta CPU de proceso por diferencia de `getrusage`, RSS máximo acumulado del
proceso y heap Go observado; esos valores no son memoria máxima exclusiva de una
sesión ni CPU de producción. Los reportes detallados permanecen en `reports/`,
excluidos de Git. El resumen versionado conserva resultados y hashes de artefactos.

**Entorno distinto del objetivo AWS:** Linux amd64, Go 1.26.1, 12 CPU lógicas
visibles y 16.042.712 KiB de RAM total; `GOMAXPROCS=2` limita paralelismo Go pero
no equivale a una instancia dedicada de 2 vCPU/8 GiB ni impone 8 GiB. Se ejecutó
localmente, con servicios de escritorio del propietario presentes. El benchmark
final se lanzó después de las suites pesadas; los tiempos nunca son aserciones
de determinismo. No se valida EC2 ni latencia WAN.

Se midieron **48 rondas BASE** (R1/R2/R3 × semillas 7/42 × cuatro algoritmos × dos repeticiones), 150 turnos cada una, con digest de cada turno reproducido. **Cero decisiones inválidas y cero timeouts**. La tabla suma cada semilla una vez; no duplica población por las repeticiones. P95 es el máximo percentil por ejecución, no un percentil combinado.

| Ronda (población sumada) | Algoritmo | Evacuados | Mordidos | Activos | Máximo p95 HTTP (ms) |
| --- | --- | ---: | ---: | ---: | ---: |
| R1 (40) | `legacy_current` | 37 | 0 | 3 | 1.256 |
| R1 (40) | `baseline_shortest_path` | 37 | 0 | 3 | 1.387 |
| R1 (40) | `dynamic_risk_astar` | 37 | 0 | 3 | 1.582 |
| R1 (40) | `predictive_temporal_astar` | 37 | 0 | 3 | 1.541 |
| R2 (160) | `legacy_current` | 119 | 7 | 34 | 2.059 |
| R2 (160) | `baseline_shortest_path` | 130 | 0 | 30 | 1.998 |
| R2 (160) | `dynamic_risk_astar` | 140 | 0 | 20 | 1.946 |
| R2 (160) | `predictive_temporal_astar` | 126 | 0 | 34 | 1.936 |
| R3 (400) | `legacy_current` | 276 | 32 | 92 | 3.847 |
| R3 (400) | `baseline_shortest_path` | 307 | 31 | 62 | 3.896 |
| R3 (400) | `dynamic_risk_astar` | 230 | 72 | 98 | 3.886 |
| R3 (400) | `predictive_temporal_astar` | 277 | 64 | 59 | 3.868 |

El benchmark estático independiente hizo **10.000 solicitudes reales**, concurrencia 16, p50 **1.045 ms**, p95 **2.373 ms**, p99 **2.926 ms** y máximo 5.234 ms, sin errores/timeouts. Usa el snapshot inicial caliente de R3; no representa por sí solo replanificación ni producción.

El máximo p95 de las 48 rondas fue **3,896 ms**, inferior al objetivo local de 150 ms. Esto no valida un SLA en AWS. En R3, el mínimo ponderado supera a los otros en estas dos semillas; A* dinámico y temporal muestran regresiones de mordidas. Se conserva el predeterminado anterior.

También se ejecutaron **12 rondas experimentales R3/semilla 7**, dos algoritmos y dos repeticiones por condición:

| Condición | Algoritmo | Evacuados / mordidos / activos | Recogidos / entregados |
| --- | --- | --- | --- |
| Caminata correlacionada | `baseline_shortest_path` | 118 / 52 / 30 | Desactivada |
| Caminata correlacionada | `predictive_temporal_astar` | 118 / 57 / 25 | Desactivada |
| Exploración adaptativa | `baseline_shortest_path` | 88 / 111 / 1 | Desactivada |
| Exploración adaptativa | `predictive_temporal_astar` | 117 / 57 / 26 | Desactivada |
| Flota (zombi clásico) | `baseline_shortest_path` | 137 / 31 / 32 | 23 / 23 |
| Flota (zombi clásico) | `predictive_temporal_astar` | 107 / 46 / 47 | 23 / 23 |

La flota entregó **23 pasajeros** en cada configuración; no cambió los totales finales respecto a su algoritmo sin flota en esta semilla. El turno medio de llegada pasó de 30,204 a 29,825 (mínimo ponderado) y de 18,234 a 18,056 (temporal). No se atribuye causalmente una mejora de supervivencia. Todas las repeticiones experimentales conservaron su digest lógico. Los 60 escenarios suman **9.000 turnos**.

Los resultados detallados incluyen muertes por tipo/mecanismo, llegadas por agente, eficiencia, invalidaciones/reversiones, calidad predictiva, viajes, saturación y CPU/memoria con su alcance descrito. [Resumen versionado con hashes y métricas](../deploy/validation-phase7.json).

No se cambia el predeterminado por una mejora supuesta: las rutas de riesgo pueden
prolongar exposición, oscilar o dejar más agentes activos; la predicción corta
puede ser pesimista. Los resultados no garantizan supervivencia. FULL_MANTA no
recibe la misma promesa de rendimiento que BASE. D* Lite, calibración predictiva,
óptimo temporal completo y certificación en 2 vCPU/8 GiB permanecen fuera de lo
verificado. No se ejecutó la matriz completa de 48 rondas a ritmo de 2 segundos;
la matriz completa es acelerada con HTTP real. El navegador sí ejercita sesiones
con ticks reales de 2 segundos, incluidos pausa, recarga y comparación.

## Validación ejecutada

| Comando | Resultado |
| --- | --- |
| `npm install` | Aprobado; existing resolutions; 0 vulnerabilities reported |
| `npm run contracts:validate` | Aprobado |
| `npm run contracts:generate` | Aprobado |
| `npm run tokens:generate` | Aprobado |
| `npm run check` | Aprobado; OpenAPI/generated consistency/TypeScript/ESLint |
| `npm test` | Aprobado; 154 web + 40 historical service tests; final default parallelism |
| `npm run build:web` | Aprobado |
| `npm run test:backend` | Aprobado |
| `npm run test:race` | Aprobado, includes sessions |
| `npm run build:backend` | Aprobado |
| `go vet ./... (via wrapper)` | Aprobado |
| `npm run graph:test` | Aprobado; 10 |
| `npm run test:contracts:http` | Aprobado; Go real y x-api-key |
| `npm run test:contracts:http -- --flutter` | Aprobado; repositorio Dart contra Go HTTP real |
| `npm run test:contracts:simulations` | Aprobado; 654 assertions; real HTTP, policy/fleet/replay/auth/schema |
| `npm run test:contracts:flood` | Aprobado; 6 real HTTP steps |
| `npm run test:simulations:browser` | Aprobado; real React/Go independent contexts, PRO configuration, comparison and export |
| `npm run test:e2e` | Aprobado; 12 desktop/mobile |
| `npm run test:visualization:browser` | Aprobado; zombie BASE and flood FULL_MANTA |
| `npm run test:lab:flood` | Aprobado; real flood lab and comparative workflow |
| `npm run mobile:check` | Aprobado; Flutter on FLUTTER_BIN=/home/naielik/Android/flutter/bin/flutter |
| `npm run mobile:test` | Aprobado; 24, 2 conditional integrations skipped |
| `npm run mobile:build` | Aprobado; debug APK |
| `npm run compare:agents (official preset)` | Aprobado; 48 full accelerated rounds over authenticated HTTP, two seeds and two logical repeats |
| `npm run compare:agents (experimental)` | Aprobado; 12 full accelerated rounds; correlated, adaptive, fleet; repeated outcomes identical |
| `npm run bench:backend` | Aprobado; 10000/10000 valid real HTTP requests |

Además de la regresión inicial anterior a reemplazos, los tests nuevos cubren
separación de sesiones, RNG clásico exacto, límites/cadencia, callejones, hordas,
sleepers, cruces opuestos, overlays, capacidad global insuficiente, pasajeros,
fallo/cancelación del planificador, puntuación predictiva, replay oficial y
experimental, bloqueo del formulario, privacidad y descargas. Se corrigió una
fixture E2E que afirmaba una ruta resaltada aunque sólo publicaba espera.
Un primer `npm test` tuvo un timeout de cinco segundos bajo suites/benchmarks
concurrentes; el archivo aislado, la suite acotada y el `npm test` final estándar
pasaron. No se ocultaron fallos con reintentos automáticos.

## Integración AWS y cumplimiento Track A

El binario y cliente web se compilan con la infraestructura y librería estándar
existentes. Se mantiene `SIM_AUTOSTART=false`; no aparecen claves en `VITE_`,
exports o logs. El servidor legacy sigue inactivo y la flota no modifica `/paso`.
Los [artefactos de validación](../deploy/validation-phase7.json) identifican el build
local; el despliegue requiere autorización posterior y cliente/backend compatibles.
No se modificaron cuenta, región, instancia, presupuesto ni caducidad AWS vigente.

Track A dispone localmente de navegación válida, motor auténtico HTTP, tres
planificadores adicionales, predicción medible, capacidad/reservas y flota probada
experimental. Se preserva la comparación con originales y se declaran regresiones.
No se declara homologación del reto, mejora universal ni latencia de EC2.

## Referencias metodológicas

- Codling, Plank y Benhamou (2008), [Random walk models in biology](https://pmc.ncbi.nlm.nih.gov/articles/PMC2504494/): persistencia, sesgo y memoria como referencia; no se infiere comportamiento zombie real.
- Zaburdaev, Denisov y Klafter (2015), [Lévy walks](https://arxiv.org/abs/1410.5100): referencia de persistencia y velocidad finita; no se implementan vuelos ni una distribución de Lévy.
- Silver (2005), [Cooperative Pathfinding](https://ojs.aaai.org/index.php/AIIDE/article/view/18726): referencia del espacio-tiempo; aquí la capacidad de refugios y las colisiones del reto difieren de MAPF.
- Koenig y Likhachev (2002), [D* Lite](https://publications.ri.cmu.edu/d-lite): evaluado conceptualmente, no implementado ni anunciado como mejora medida.
