> **Referencia histórica FASE 1/2.** Arquitectura y estrategias actuales: [arquitectura](arquitectura.md), [nivel PRO](nivel-pro.md) y [pruebas](pruebas.md). Las restricciones de fases posteriores prevalecen.

# Motor determinista de evacuación

`services/evacuation/internal/decision` implementa `world.DecisionEngine` con
`decision.New()`. No consulta servicios externos ni utiliza modelos generativos.

Para cada snapshot observable calcula un Dijkstra inverso con todos los refugios
disponibles como orígenes. Una sola búsqueda produce el siguiente nodo y el refugio
objetivo para cada nodo del grafo; los sobrevivientes del mismo estado comparten
ese resultado. Las calles dirigidas conservan su dirección. Una decisión avanza
exactamente una arista, o espera en el nodo actual.

Se excluyen las aristas bloqueadas, los destinos ocupados por zombies visibles,
el nodo de cada horda y todos sus vecinos físicos, incluidos vecinos de aristas
entrantes o cerradas. Un sleeper dormido nunca participa en el cálculo, incluso si
se recibe accidentalmente dentro de un snapshot. También se prohíbe recorrer en
sentido opuesto cualquier segmento del recorrido zombie del turno actual; se
inspeccionan todos los segmentos intermedios del runner.

Las rutas se comparan primero por exposición acumulada y después por costo de
movimiento. Un nodo a una arista de un zombie recibe 10 puntos de exposición; a
dos aristas recibe 2. Los runners multiplican esos valores por 3. La proximidad
usa la topología física sin dirección, coherente con la detección del simulador.
Son heurísticas explícitas de esta fase, no probabilidades de supervivencia ni
predicción de movimientos futuros.

Cada arista agrega el costo
`1 + distance_m / 1000 + distance_m / (speed_mps * 100)`.
El primer término representa un movimiento; los demás favorecen distancia y
velocidad configurada por tipo de vía sin permitir saltar varios nodos. La
comparación de riesgo es lexicográfica: una ruta con menor exposición tiene
prioridad sobre un ahorro de distancia. Los empates se resuelven por ID de refugio
y siguiente nodo, sin depender del orden de solicitudes concurrentes.

Un refugio lleno no se considera destino. Esta fase no reserva plazas ni coordina
asignaciones de múltiples sobrevivientes; el simulador resuelve la capacidad de
forma autoritativa y determinista al aplicar las llegadas. Un sobreviviente puede
salir de un nodo actualmente peligroso hacia un destino seguro; no puede entrar
en otro nodo excluido. Si no hay ruta al refugio y el nodo actual está ocupado por
un zombie visible o dentro de la exclusión de una horda, intenta una salida de
emergencia de una sola arista. Elige un vecino permitido por menor exposición,
costo de movimiento e ID, en ese orden; devuelve una ruta de dos nodos sin refugio
objetivo. No continúa ni propaga esa salida como una ruta al refugio. Si el nodo
actual es seguro o no hay salida segura, permanece en su nodo.

La caché retiene un único plan, protegido por una exclusión que respeta la
cancelación del contexto. Su clave incluye las versiones del mundo y del grafo y
una huella de los datos que afectan las rutas: topología, distancias, velocidades,
bloqueos, zombies observables y recorridos, capacidades y ocupación. Cambiar estos
datos invalida el plan incluso si el productor reutiliza accidentalmente una
versión. Los resultados devueltos contienen una ruta nueva; el motor no muta el
snapshot ni comparte slices modificables con el consumidor.

Se comprueba el contexto al recibir la solicitud, al esperar la caché y durante
el recorrido del grafo. Las pruebas incluyen calles dirigidas, bloqueos estáticos
y dinámicos, ocupación de refugios, los cuatro tipos de zombie, cruce opuesto del
runner, desempates, cancelación y 200 solicitudes concurrentes. Ejecutar desde
`services/evacuation`:

```sh
go test -race ./internal/decision
```

La predicción temporal de runners y la asignación global de capacidad quedan
para FASE 2. El criterio conservador de exposición puede producir recorridos más
largos; no garantiza una evacuación cuando el mundo deja de tener rutas seguras.

## Extensión de escenarios FASE 4A

La descripción anterior es histórica de FASE 1; el motor productivo con predicción y reservas se explica en [algoritmo FASE 2](algoritmo-fase2.md). La [extensión de inundación](urban-flood.md) conserva esas búsquedas y añade costos de precaución, cierres temporales y disponibilidad de destinos a sus huellas efectivas. Los datos descriptivos de riesgo y timestamps no obligan a recalcular Dijkstra. La rama zombie conserva sus reglas y resultados de regresión.
