# Motor determinista — FASE 2

El diagnóstico previo reprodujo 38 evacuados, 150 mordidos y 12 activos sobre el
mapa original. Los runners causaron 101 de las mordidas; quedaron 202 plazas sin
ocupar. El nuevo motor aborda esa evidencia mediante riesgo futuro y planificación
compartida. La comparación cuantitativa con el motor congelado de FASE 1 pertenece
al evaluador y al informe de FASE 2; implementar un predictor no demuestra por sí
solo una mejora de supervivencia.

## Interfaces y responsabilidad

`decision.New()` crea el motor con predicción activada. La interfaz obligatoria
`NextStep(context.Context, WorldSnapshot, Survivor) DecisionResult` se conserva.
`Candidates` devuelve como máximo una ruta por refugio accesible, con siguiente
nodo, destino, ruta, exposición estimada y costo de movimiento. El coordinador de
capacidad usa esas rutas antes de publicar el snapshot; `POST /paso` únicamente
lee la asignación publicada. Nunca reserva plazas desde HTTP.

La ocupación real elimina refugios llenos. Las reservas anteriores no eliminan
candidatos de una planificación global nueva: el coordinador reconsidera a todo
el conjunto activo. Un sobreviviente con reserva propia puede seguir entrando a
su refugio aunque las plazas disponibles sin reserva sean cero.

Un `planned_route` coherente se sigue mientras sus calles y destino continúen
válidos. También se respeta una salida de emergencia publicada de un salto, sin
refugio objetivo. Si una ruta se compromete, se calcula una alternativa segura o
se conserva el nodo actual. Los slices devueltos son copias independientes.

## Restricciones y costos

Son restricciones duras: aristas inexistentes o cerradas; dirección de calles;
nodos actualmente ocupados por zombies visibles; el nodo de una horda y todos
sus vecinos físicos, aun con calles entrantes o cerradas; y el recorrido opuesto
a cualquier segmento zombie observado en el turno actual. Un sobreviviente puede
salir de un nodo inicialmente peligroso hacia un vecino permitido. El motor nunca
lee sleepers dormidos ni la PRNG del simulador.

Cada arista cuesta `1 + distance_m/1000 + distance_m/(speed_mps*100)`. El primer
término cuenta un movimiento; la velocidad no permite atravesar varias aristas
por turno. Se conserva la exposición local: 10 a un salto y 2 a dos saltos de un
zombie, multiplicados por 3 para runners.

La búsqueda usa costo finito de movimiento más exposición ponderada. Se separa
así una prohibición cierta de una estimación: una zona meramente cercana a un
runner no se vuelve intransitable. Cuando existe ruta, la función positiva de
costo produce progreso hacia un refugio en un mundo estático, sin esperar por una
suposición de riesgo. La exposición es una heurística, no una probabilidad
calibrada ni una garantía de supervivencia.

Por cada refugio se calcula Dijkstra inverso. Para un sobreviviente se consideran
sus vecinos válidos y la continuación compartida de cada uno. Se descartan
continuaciones que regresen al nodo actual o formen ciclos. Esto permite escoger
una alternativa de primer paso sin ejecutar Dijkstra para cada solicitud.

## Predictor de runners

`NewRunnerPredictor(horizon).Predict(ctx, snapshot)` está separado de la búsqueda.
Usa únicamente posiciones, sobrevivientes activos, calles transitables y reglas
observables de detección. Produce:

- `OneTurnNodes`: posiciones alcanzables en hasta dos aristas.
- `TwoTurnNodes`: posiciones alcanzables en hasta cuatro aristas para horizonte 2.
- `TargetPaths`: trayectoria prevista hacia el objetivo observable más cercano a
  tres saltos o menos, con desempate por ID y BFS de calles transitables.
- `EdgeRisk`: exposición a posibles cruces opuestos futuros.

La proximidad de detección usa topología física no dirigida; el recorrido respeta
direcciones y cierres, igual que el simulador. La trayectoria conocida del turno
actual determina las prohibiciones de cruce existentes; no se extrapola una
velocidad geométrica que contradiga la persecución por nodos.

El alcance alternativo tiene peso bajo y el destino de persecución previsto tiene
peso mayor. Un cambio observable de objetivo refresca el pronóstico. Para el
segundo horizonte se mantienen provisionalmente las posiciones de sobrevivientes;
sus movimientos reales y la elección de otros objetivos pueden cambiar la ruta.
No se utiliza conocimiento de decisiones futuras ni de sleepers invisibles.

Solo las dos primeras posiciones de la ruta reciben exposición predictiva. El
cruce futuro se evalúa en el segmento posterior al primer movimiento del
sobreviviente: los zombies se moverán de nuevo antes de ese segmento. Una
posición posible el próximo turno no penaliza indefinidamente toda una ruta larga.
Si el siguiente paso completa una llegada segura al refugio asignado, no recibe
penalización de proximidad futura: esa persona se refugia antes de la siguiente
fase zombie. Las restricciones y colisiones observables del turno actual siguen
siendo obligatorias.

Los mapas son conjuntos de riesgo con pesos relativos. Un nodo previsto que no
se visite constituye un candidato a falso positivo de cobertura, no un fallo de
un clasificador probabilístico. La evaluación debe comparar el conjunto de un
turno con la fase zombie posterior y separar esa cobertura del cambio de mordidas
entre ejecuciones emparejadas. No se atribuye causalidad individual a toda mordida
que difiera entre predicción activada y desactivada.

## Caché, coherencia y oscilaciones

La caché conserva un único paquete inmutable, publicado mediante puntero atómico.
Los lectores de un snapshot anterior pueden continuar usando su paquete mientras
se construye otro. La fase de preparación del turno llena la caché antes de
publicar las asignaciones. El gate de cómputo respeta cancelación; no se sostiene
un mutex durante todas las consultas HTTP.

La huella de rutas incluye la versión y contenido del grafo, bloqueos, posiciones
y recorridos visibles, capacidades y ocupación. No incluye `world_version` ni
turno como invalidaciones ciegas: publicar otra versión con igual información
reutiliza búsquedas. Las posiciones activas se agregan a una huella predictiva
solo cuando hay runners y la predicción está activada. Si solo cambian objetivos,
se refresca el predictor y se reutilizan los Dijkstra; si cambia un cierre o una
amenaza, se reconstruye la parte afectada del paquete.

El plan publicado evita que consultas concurrentes elijan destinos diferentes.
`Candidates` mantiene una ruta previa hard-safe dentro de un margen configurable
cuando exposición y costo son comparables; el coordinador añade estabilidad de
destino. Esto reduce cambios por diferencias pequeñas sin mantener una ruta
claramente peor. No afirma eliminar oscilaciones inevitables ante amenazas que
cambian cada turno.

Sin destino accesible, `Escape` permite una sola arista hacia un vecino permitido
si el nodo actual está ocupado/excluido, o permite reducir estrictamente una
exposición futura a runner. Si está seguro y no hay refugio disponible, espera;
no deambula arbitrariamente. Una salida sin refugio no se propaga como si fuera
una ruta completa.

## Opciones, ablation y contadores

```go
engine := decision.NewWithOptions(decision.Options{
    Prediction: true, // false para comparación emparejada
    Horizon: 2, // 1 o 2
    RiskWeight: 0.6,
    PredictionWeight: 12,
    Stickiness: 0.15,
})
```

Cero en opciones numéricas selecciona esos valores predeterminados. Los pesos son
configurables para medir consecuencias; el evaluador debe conservar el mismo
mapa y condiciones iniciales al compararlos. `Stats()` separa hits, paquetes
construidos, búsquedas inversas, pronósticos y búsquedas reutilizadas. No son
latencia HTTP ni número de rutas publicadas.

Ejecutar desde `services/evacuation`:

```sh
go test -race ./internal/decision
go vet ./internal/decision
```

Se conservan las 14 pruebas anteriores y se añaden casos de predicción
activada/desactivada, cambios de objetivo/cierres, aislamiento de sleepers,
capacidades/reservas, coherencia de planes publicados, histéresis, progreso,
200 lectores, cancelación y reutilización selectiva entre publicaciones.
