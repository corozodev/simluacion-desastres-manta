# Coordinación de refugios — FASE 2

`internal/coordination` implementa `world.TurnPlanner`. Se ejecuta una vez sobre
el snapshot observable al preparar cada turno, antes de publicar el estado para
las solicitudes concurrentes de `/paso`. No realiza asignaciones desde HTTP ni
consulta posiciones de sleepers dormidos.

## Interfaz e integración

```go
planner := coordination.New(engine, coordination.Options{Stickiness: 0.15})
simulator.SetPlanner(planner)
```

El motor proporciona `Candidates(ctx, snapshot, survivor) []DecisionResult`: una
ruta candidata por refugio viable, con costo y exposición estimada. El resultado
de `Prepare` es una copia del mundo con `target_shelter_id`, `planned_route` y
reservas coherentes. El simulador conserva autoridad sobre posiciones, estados,
capacidades, ocupación y aplicación de movimientos. La interfaz pública de
`POST /paso` conserva únicamente `siguienteNodo`.

`Stats()` devuelve estadísticas del último plan: asignados, retenidos,
reasignados, sin ruta candidata, limitados por capacidad, candidatos rechazados,
cancelación y duración. Son estadísticas de planificación; no se confunden con
latencia HTTP. El número de rutas candidatas descartadas no representa por sí
solo un fallo de red ni una mordida.

## Asignación global

1. Calcular plazas libres reales: `capacity - occupancy`. Las reservas observadas
   del turno anterior no se restan otra vez: se reconstruyen para todos los
   sobrevivientes activos del nuevo snapshot.
2. Validar candidatos: refugio existente y disponible, ruta trazable por aristas
   transitables, inicio/fin correctos, costos finitos y siguiente movimiento
   compatible con el recorrido. El siguiente paso evita nodos ocupados, exclusión
   completa de hordas y cruces opuestos del recorrido zombie conocido. Las rutas
   no atraviesan la exclusión de hordas. La exposición futura sigue siendo una
   estimación del motor, no una garantía de supervivencia.
3. Mantener una reserva anterior si su ruta sigue disponible, tiene el mismo
   riesgo estimado que la mejor opción y su costo no supera a esta más del 15%.
   `Stickiness` modifica esa tolerancia; el valor cero selecciona el 15% por
   defecto. Una opción con mayor riesgo no se conserva solo por estabilidad.
4. Para los restantes, priorizar los sobrevivientes con menos alternativas;
   después, la mayor pérdida de riesgo/costo que supondría perder su mejor
   destino. Asignar en orden determinista por ID cuando persistan empates.
5. Elegir destino por menor riesgo estimado y luego costo. En alternativas
   idénticas equilibrar la proporción de ocupación/reservas; cada asignación
   consume una plaza antes de procesar la siguiente. Así, 200 sobrevivientes con
   cuatro alternativas equivalentes de 60 plazas se distribuyen 50 por refugio.

Es una heurística global de escasez y arrepentimiento, no una prueba de óptimo de
costo mínimo. La conservación de reservas puede sacrificar alguna asignación
alternativa más costosa. Las comparaciones del evaluador deben mostrar el efecto
real de la coordinación sobre evacuación y supervivencia.

## Ciclo de una reserva

La reserva pertenece a un sobreviviente activo y su destino actual. Morir elimina
su reserva; una ruta invalidada, un refugio lleno o una reasignación liberan el
destino anterior al preparar el siguiente plan. La llegada se resuelve en el
simulador: la reserva se transforma en ocupación real y el sobreviviente
`evacuated` deja de solicitar movimientos. La ocupación nunca la escribe el
coordinador. El refugio conocido de una persona evacuada permanece visible, sin
contar como reserva.

Se publica para cada refugio:

```text
available = capacity - occupancy - reserved
```

Ningún plan asigna más reservas que plazas libres. Un sobreviviente sin capacidad
asignable no obtiene una reserva ficticia. El coordinador consulta `Escape` para
todos los sobrevivientes sin destino: el motor puede justificar una salida de
una arista tanto por peligro actual como por una amenaza futura de runner
calculada exclusivamente a partir de observaciones. La salida no consume una
reserva y debe pasar las mismas comprobaciones de arista, bloqueos, hordas y
cruces opuestos. Si no existe una mejora justificada, se publica la ruta
`[nodo_actual]`, que el motor conserva como una espera coherente. Un contexto
cancelado no publica reservas anteriores como si hubieran sido recalculadas.

Las capacidades continúan configurables en el grafo. Los valores de 60 por
refugio son supuestos de simulación, no capacidades oficiales de instalaciones
de emergencia; los cuatro refugios son ficticios.

## Evidencia y límites

El diagnóstico original dejó **202 de 240 plazas sin ocupar**: la falta de
capacidad no explica principalmente el resultado 38/200 de esa semilla. La
coordinación corrige sobreasignaciones potenciales y prepara destinos observables;
su impacto debe aislarse mediante la comparación con el hook desactivado.

Las reservas no son una promesa de llegada segura y no impiden que un cambio del
mundo vuelva inaccesible el destino. No se deducen garantías de supervivencia de
los costos heurísticos. `Prepare` no guarda una tabla autoritativa compartida:
las entradas son snapshots independientes; solo las estadísticas necesitan mutex.

Desde `services/evacuation`:

```sh
go test -race ./internal/coordination
go vet ./internal/coordination
```

Las pruebas cubren 200 asignaciones, distribución, límites de capacidad,
liberación por muerte/ocupación, destinos alternativos, estabilidad, riesgos,
bloqueos, hordas, cruces opuestos, cancelación, permutación del orden de entrada,
lectura concurrente y lectura del plan coherente por el motor real.
Dos regresiones con el motor real verifican que una persona sin reserva pueda
escapar de una amenaza futura aunque su nodo aún no esté ocupado, y que sin
amenaza futura conserve la espera sin deambular ni crear reservas.
