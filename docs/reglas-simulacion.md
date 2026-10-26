# Reglas del simulador — FASE 1

El estado real pertenece exclusivamente a `internal/simulation`: PRNG con semilla,
cadencia de cada zombie, sleepers dormidos y eventos futuros. `world.Store` publica
copias del estado observable. Un sleeper dormido nunca figura en `/estado`, ni en
el snapshot que consulta el motor. El grafo base permanece inmutable y los cierres
dinámicos viven en `blocked_edges`.

## Orden de un turno

1. Incrementar turno y aplicar eventos programados de cierre/apertura.
2. Actualizar zombies y registrar todos los nodos recorridos.
3. Publicar el snapshot de decisión, con sobrevivientes todavía en sus nodos
   anteriores y zombies ya actualizados.
4. Enviar `POST /paso` por HTTP para cada sobreviviente activo, con `x-api-key`,
   turno y nodo. El número de trabajadores es configurable.
5. Esperar las respuestas acotadas, validar adyacencia, cierres y hordas y aplicar
   los movimientos. Un fallo, respuesta inválida o timeout conserva el nodo.
6. Resolver mordidas, antes de admitir sobrevivientes en refugios.
7. Admitir en refugios con capacidad disponible.
8. Publicar el snapshot final, eventos del turno y métricas acumuladas.

Las solicitudes fallidas o inseguras generan eventos genéricos
`decision_invalid`; los tiempos agotados generan `decision_timeout`. Estos
eventos identifican turno y sobreviviente, sin incluir credenciales ni cuerpos
de error del servidor. Las latencias acumuladas se publican como métricas.

Un único mutex serializa turnos. Las consultas HTTP leen copias del Store y no
necesitan el mutex del simulador. Ninguna consulta `/paso` mueve personajes. El
procesamiento de respuestas y admisión a refugios usa orden ascendente por ID,
independientemente del orden en que terminan las solicitudes concurrentes.

## Movimiento y zombies

Todos recorren únicamente aristas transitables del grafo; los movimientos respetan
`directed`, bloqueos estáticos y cierres dinámicos. Un sobreviviente recorre como
máximo una arista por turno, independientemente de longitud o velocidad.

| Tipo | Regla implementada |
| --- | --- |
| Walker | Descansa el primer turno y recorre una arista aleatoria válida en los turnos pares de su propia cadencia. Los vecinos están ordenados y la PRNG tiene semilla. Sin salida, permanece. |
| Runner | Detecta sobrevivientes activos a tres saltos o menos. Elige el más cercano; empates por ID. Persigue por BFS de calles transitables hasta dos aristas y se detiene al alcanzar el nodo objetivo. Sin objetivo detectado accesible, deambula hasta dos aristas aleatorias. |
| Horde | Inmóvil por defecto. Bloquea su nodo y todos los vecinos topológicos, incluidos vecinos conectados por aristas entrantes o cerradas. `horde_move_every > 0` habilita explícitamente un desplazamiento aleatorio de una arista con esa cadencia. Los escenarios incluidos usan cero. |
| Sleeper | Invisible mientras duerme. Despierta al comenzar la fase zombie si hay un sobreviviente activo a dos saltos o menos. Ese turno descansa; en el siguiente se mueve una arista y continúa con cadencia Walker. Conserva tipo `sleeper` y `awake: true`. |

La proximidad de detección es topológica no dirigida, sin considerar cierres:
un cierre no hace físicamente más distante una intersección. La ruta recorrida sí
respeta direcciones y cierres. Es un supuesto explícito donde el enunciado no fija
cómo medir esa proximidad. No hay predicción oculta de sleepers ni decisiones
externas de IA.

## Mordidas y refugios

Hay mordida si zombie despierto y sobreviviente comparten nodo **al final** del
turno, o si cruzan una misma conexión en sentidos opuestos durante ese turno.
Cada segmento del recorrido de un runner participa en esta última comprobación;
no basta con comparar su nodo inicial y final. La regla no añade mordidas por
coincidir únicamente en un nodo intermedio: el enunciado no las especifica.

La comparación de cruces usa los nodos extremos. Aristas paralelas que enlazan
las mismas intersecciones se consideran la misma calle para esta regla, porque
`/paso` identifica nodos y no la arista elegida. No se intenta inferir un orden
subturno de los dos movimientos de un runner.

Las hordas impiden **entrar** en los nodos bloqueados. Un sobreviviente inicialmente
dentro de esa zona puede quedarse o salir hacia un vecino seguro; no recibe una
mordida automática por estar junto a la horda. Solo el nodo realmente ocupado por
el zombie produce mordida al final del turno.

Un sobreviviente mordido queda `bitten` y deja de consultar movimientos. Tras las
mordidas, un sobreviviente en un refugio disponible pasa a `evacuated`, incrementa
su ocupación y también deja de consultar. Un refugio lleno conserva activos los
que llegan. No hay reservas de plaza ni asignación global de capacidad en FASE 1.

## Inicialización y escenarios

`scenarios/round1.json`, `round2.json` y `round3.json` son configuraciones
modificables. Incluyen 20, 80 y 200 sobrevivientes, respectivamente, 150 turnos y
cantidades de zombies asumidas explícitamente. No son cantidades publicadas por
la competición. Se puede sustituir la distribución aleatoria por
`initial_survivors` e `initial_zombies` con nodos concretos para reproducir casos.

Para generar posiciones, se ordenan nodos por ID y se muestrea uniformemente con
reemplazo fuera de los refugios. Se permiten varios sobrevivientes en un nodo y
coincidencias iniciales con zombies. No hay inmunidad ni eliminación artificial
de posiciones peligrosas. Los sleepers iniciales están dormidos; los demás
zombies están despiertos.

Los eventos especifican `edge_id` o, si está vacío, `edge_index` dentro de los IDs
de arista ordenados. Un evento cierra o vuelve a abrir la arista indicada; no abre
una arista marcada estáticamente `blocked` en el grafo base. La ronda 2 cierra
`E-4420ceab96c993b4`, corredor que contiene el puente `bridge=yes` de la vía OSM
32491400 (Avenida 24 de Mayo). El colapso es un evento **simulado**, no una
afirmación de un desastre real. El ID está ligado al grafo Manta versionado; para
otra fixture hay que reemplazarlo por una arista existente. La ronda 3 programa
dos cierres. Cambiar el grafo manteniendo
índices puede cambiar las calles afectadas; para un escenario congelado hay que
usar IDs explícitos.

## Tiempo, fallos y métricas

`Run(ctx, turns, 2*time.Second)` usa un período nominal de dos segundos por turno,
incluida la espera restante después del último. Si el trabajo excede el período,
no se acumula una espera adicional. `Run(ctx, turns, 0)` es acelerado y no crea
esperas de tiempo real. Una cancelación previa al turno no modifica estado; una
cancelación durante las solicitudes completa ese turno con las respuestas
disponibles y los fallbacks antes de devolver el error de contexto.

El cliente HTTP limita cada solicitud completa a 500 ms como máximo, admite un
timeout configurado más corto y nunca sigue redirects que pudieran reenviar la
clave. El presupuesto incluye conexión, lectura y decodificación. Los códigos
408/504 se clasifican como timeout; otros errores HTTP, red, JSON o movimientos
inseguros se cuentan como inválidos. Los tiempos agotados cuentan solo en timeout.
Esto incluye un cuerpo que se detiene después de recibir cabeceras HTTP 200,
incluso si ya llegó un objeto JSON completo pero falta el fin de la respuesta.
Un timeout durante esa lectura conserva su clasificación y no se transforma en
un error de formato JSON.

Las latencias se miden con reloj monotónico alrededor de cada llamada al cliente,
sin incluir la espera en la cola del trabajador. Incluyen fallos y timeouts.
Los percentiles p50/p95/p99 acumulados usan rango más próximo
`ceil(p * cantidad)`. La disponibilidad observada se define como
`requests_success / (requests_success + requests_invalid + requests_timeout)`;
sin solicitudes vale 1 por convenio, no como medición de disponibilidad externa.
Se cuentan evacuados, mordidos, activos y turnos. Los tiempos son evidencia de la
ejecución local, no una garantía de latencia en AWS.

Semilla, grafo, escenario y respuestas de decisión iguales producen iguales
movimientos, eventos y resultados, aunque cambie el orden de los trabajadores.
Las latencias reales no son deterministas; fallos o timeouts externos pueden
alterar el resultado, deliberadamente. Las pruebas de determinismo excluyen
únicamente los campos de latencia y no inventan tiempos reproducibles.

## FASE 2: aparición, planificación y diagnóstico

Las configuraciones históricas `scenarios/round*.json` conservan exactamente la
inicialización de FASE 1, incluida la posibilidad de coincidencias iniciales.
`use_spawn_zones: true` habilita la generación urbana: solo los sobrevivientes
se distribuyen entre los candidatos geográficos de `Graph.spawn_zones`.
Las rutas y los zombies utilizan la red completa. Las geometrías aproximadas y
su procedencia pertenecen al importador; el simulador comprueba que cada candidato
existe y está dentro de su polígono, y excluye los nodos de refugio al aparecer.

`spawn_zone_weights` permite configurar pesos no negativos por `zone_id`.
Se usa reparto por restos mayores, con empate por ID, para conservar exactamente
20/80/200 sobrevivientes. Los pesos predeterminados del grafo son explícitos;
las configuraciones urbanas incluidas usan cuatro pesos iguales. No son una
prescripción oficial del jurado. Se elige un nodo candidato con la PRNG sembrada.

Los zombies urbanos se generan sobre todos los nodos operativos no refugio,
independientemente de las zonas de origen. `allow_initial_overlaps: false`
impide coincidencias zombie/sobreviviente y ubicar una horda inicialmente junto
a un sobreviviente. Esta opción solo modifica la inicialización urbana; no
cambia mordidas, persecución ni dificultad durante la simulación. Está documentada
como cambio de escenario y no debe confundirse con una mejora algorítmica.
Se permiten varios sobrevivientes en un nodo y varias unidades zombie en un nodo.

Para comparar mapas, las posiciones explícitas pueden remapearse externamente.
`initial_random_node_count` reproduce el avance de la PRNG usado al generar
la población histórica: con ambas listas iniciales explícitas, consume una
selección de nodo por entidad usando la cantidad de candidatos de origen.
No altera el estado inicial proporcionado. El evaluador registra las distancias
de remapeo y reconoce el cambio de topología.

`SetPlanner(world.TurnPlanner)` instala una planificación global anterior a las
consultas HTTP. `Prepare` recibe únicamente un snapshot observable copiado; el
simulador acepta solo refugio objetivo y ruta de cada sobreviviente activo.
Valida rutas vecinas y asignaciones contra capacidad real; descarta propuestas
que intenten cambiar posición, estado, capacidad u ocupación. `/paso` sigue
siendo una consulta de lectura y su JSON no cambia.

Las reservas se reconstruyen desde asignaciones activas. Una llegada convierte
su reserva en ocupación; morir libera la asignación. Una llegada sin reserva
solo consume una plaza no reservada. El snapshot final mantiene
`occupancy + reserved <= capacity` y `available = capacity - occupancy - reserved`.
Las rutas publicadas se recortan al nodo actual después de aplicar el paso.

`Simulator.Diagnostics()` devuelve un reporte offline independiente: posiciones
iniciales reales, métricas por sobreviviente, inmovilidad, ausencia de ruta,
reversiones de arista, evacuación/eficiencia, mordidas por tipo y mecanismo, y
tiempos de preparación/publicación/turno. Este reporte incluye posiciones
iniciales de sleepers dormidos para reproducibilidad y **nunca debe publicarse
por HTTP ni colocarse en el hosting web**. `/estado` conserva únicamente datos
observables. La ausencia de ruta se clasifica con búsquedas inversas sobre
geografía, cierres, restricciones visibles y capacidad, en ese orden.
Es una condición contribuyente: la causa de mordida se registra por separado.

Los contadores `route_invalidations` solo inspeccionan rutas observables
publicadas por el planificador. El motor FASE 1 no publica rutas completas, por
lo que cero no significa que su caché nunca se recalculase. La duración
`timings.planning` mide el hook global, no el cálculo interno del motor HTTP.
La línea temporal registra contadores acumulados de espera y ausencia de ruta.


## FASE 2: origen, planificación y medición

Las reglas de movimiento, mordida, visibilidad y duración anteriores se conservan. Los escenarios históricos siguen en `scenarios/round*.json`. Los nuevos `scenarios/urban/round*.json` usan cuatro polígonos municipales, pesos iniciales iguales y `use_spawn_zones:true`. Se asignan cantidades por restos mayores y empates deID. Zombies se distribuyen en el territorio operativo, sin limitarse a zonas iniciales. El protocolo urbano evita coincidencias iniciales y exclusiones de horda sobre sobrevivientes; es un cambio de condiciones iniciales explícito, no una modificación de reglas zombie ni una mejora atribuible por sí misma al algoritmo.

`SetPlanner` prepara reservas/destinos/rutas una vez antes de solicitudes HTTP. Las reservas se validan contra capacidad y rutas reales; el planificador no puede cambiar posición, estado, ocupación o capacidad. Un sobreviviente sin reserva no consume una plaza reservada a otra persona. Las salidas de emergencia no reservan plazas y pueden responder a amenazas futuras estimadas; una espera publicada se conserva.

Las comparaciones geográficas congelan posiciones originales, refugios y cantidades, remapean a nodos próximos y registran distancias. `initial_random_node_count` reproduce los avances iniciales de PRNG cuando se usan posiciones explícitas; permite recuperar exactamente38/150/12 en el replay histórico. Una topología diferente puede alterar persecuciones y consumo posterior de aleatoriedad, incluso manteniendo semilla y coordenadas.

Los diagnósticos separan mecanismos de mordida y tipo de zombie, condiciones iniciales contribuyentes, inmovilidad, ausencia de rutas, eficiencia y tiempos. Las plazas sin ocupar (`capacity-occupancy`), reservadas y disponibles (`capacity-occupancy-reserved`) son medidas distintas. La clasificación final se calcula después de todas las admisiones, mientras que la clasificación de cada decisión conserva el estado previo.

La evaluación de pronóstico compara una envolvente de nodos posibles con posiciones observadas después del siguiente turno. Nodos posibles no ocupados son candidatos falsos positivos, no una probabilidad mal calibrada: la envolvente no predice ocupación simultánea. La diferencia neta de mordidas entre ejecuciones con/sin predictor tampoco demuestra una intercepción causal concreta, porque cambian trayectorias posteriores.
