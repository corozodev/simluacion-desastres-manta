# Diagnóstico de supervivencia — línea base FASE 1

Medición del 26 de octubre de 2026, con el código original antes de optimizar
rutas o reemplazar el mapa. `data/manta-v1.json` conserva el grafo original,
`scenarios/round3.json` la configuración y `internal/evaluation/phase1` el motor
congelado para evaluación. La simulación realiza HTTP real, no llamadas directas
presentadas como integración.

## Resultado reproducido

Semilla 20261028, 200 sobrevivientes, 20 walkers, 8 runners, 3 hordas y
10 sleepers; 150 turnos; 300 nodos y 325 aristas; cuatro refugios de 60 plazas.
Se reproduce **38 evacuados, 150 mordidos y 12 activos**. Por tanto, la
proporción evacuada es 19%, mientras que la proporción viva al finalizar es
**50/200 = 25%**. Las 10.500 solicitudes fueron exitosas, sin inválidas/timeouts.
La latencia local de esta repetición no representa rendimiento AWS.

Los archivos nuevos `reports/phase2/baseline-round3.json`,
`baseline-round3-diagnostics.json` y `baseline-initial-round3.json` conservan los
resultados y posiciones. Los informes originales de FASE 1 no se modifican.
El diagnóstico detallado es un artefacto privado offline, con posiciones
iniciales de sleepers; no es una respuesta de `/estado`.

## Evidencia y causas

| Medida | Resultado |
| --- | --- |
| Turnos inmóviles acumulados por sobrevivientes activos | 8.034 |
| Turnos sin ruta a un refugio disponible bajo restricciones observables | 9.751 |
| De ellos: restricciones de zombies visibles/hordas | 9.538 |
| De ellos: bloqueo de calles que desconecta refugios | 213 |
| Refugios llenos al finalizar | 0 |
| Plazas sin ocupar al finalizar | 202 de 240 |
| Coincidencias iniciales sobreviviente/zombie | 26 sobrevivientes |
| Sobrevivientes inicialmente en exclusión de horda | 8 |
| Distancia mínima inicial al refugio: media/máximo | 22,91 / 60 movimientos |
| Reversiones de arista observadas | 81 |
| Mordidos en los primeros tres turnos | 13 |

Las mordidas fueron todas por coincidencia de nodo final: **101 causadas por
runners**, 38 por walkers, 10 por sleepers despiertos y una por horda. No hubo
mordidas por cruce opuesto en esta ejecución. La prevención de cruces ya existía;
esta ausencia no elimina la necesidad de comprobar todos los segmentos de runners.

21 de los mordidos habían coincidido inicialmente con algún zombie. Ese dato es
una condición inicial contribuyente, no atribuye causalidad a esa coincidencia
para toda muerte posterior. Al finalizar, de los 12 activos, nueve carecían de
ruta segura por restricciones visibles y tres por cierre de calle. Los evacuados
llegaron en el turno 46,55 en promedio; su eficiencia media frente al refugio
inicial más próximo fue 0,883. Esta referencia ignora zombies y puede diferir del
refugio finalmente elegido.

## Qué confirma y qué no confirma

La capacidad total no fue el principal cuello de botella de esta semilla: quedaron
202 plazas vacías. La larga distancia por saltos, las exclusiones de hordas en
corredores y la pérdida de rutas alternativas merecen la auditoría geográfica.
Los runners explican 101/150 mordidas, de modo que ampliar el mapa por sí solo
no demuestra que se haya resuelto el problema del planificador.

No se puede atribuir el 19% únicamente a la selección geográfica: se requieren
experimentos separados de mapa, motor, predicción y coordinación, con estado
inicial registrado. El informe geográfico cuantifica articulaciones, puentes y
accesibilidad; el informe de FASE 2 debe unir ambas evidencias sin mezclar cambios
de topología, refugios y reglas de aparición con mejoras algorítmicas.

Los contadores de destinos/rutas invalidadas son cero en el baseline porque no
había rutas completas publicadas ni asignación global observable. No son una
medición del número de reconstrucciones internas de Dijkstra. Las búsquedas de
diagnóstico clasifican acceso físico, cierres, restricciones visibles y capacidad;
no simulan conocimiento de sleepers ocultos ni afirman una probabilidad exacta.

## Reproducción

Desde `services/evacuation`, con Go disponible:

```sh
go run ./cmd/evaluate -graphs data/manta-v1.json -strategies phase1 -rounds 3 -seeds historical -output reports/phase2/reproduccion-baseline
go test -race ./internal/simulation ./internal/diagnostics
```

Los informes detallados deben mantenerse fuera del directorio web público. El CLI `simulate` ejecuta el motor actual incluso al cargar v1; para reproducir FASE1 usar exclusivamente el evaluador con `-strategies phase1`.
Para comparación futura usar el motor congelado mediante el evaluador integrado;
la ruta de producción puede evolucionar y no representa automáticamente FASE 1.
