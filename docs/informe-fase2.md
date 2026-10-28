# Informe FASE 2 — Manta, rutas y preparación AWS

> Informe histórico de la versión indicada. Los resultados se conservan; los flujos, despliegue y componentes vigentes están en [arquitectura](arquitectura.md) y [pruebas](pruebas.md).

Entrega local del 26 de octubre de 2026, America/Guayaquil. Código funcional, datos OSM y mediciones; no se inició FASE 3. El informe, datos y motor de FASE 1 se conservan. No se inicializó Git ni se crearon commits. Este documento se genera de JSON reales con `python3 tools/qa/report_phase2.py`.

## A. Diagnóstico inicial

Se reprodujo exactamente la semilla 20261028: **38 evacuados, 150 mordidos, 12 activos** en 150 turnos. Son 50 vivos(25%), mientras que solo 19% llegó al refugio. Hubo 8034 turnos inmóviles y 9751 turnos sin ruta observable segura; 101 mordidas fueron de runners, 38 de walkers, 10 de sleepers despiertos y 1 de horda. Todas fueron por coincidencia final de nodo; no se mezcló mecanismo con tipo de zombie. Quedaron 202 plazas vacías y ningún refugio lleno: capacidad total no era el principal cuello de botella de esa ejecución.

El mapa 300/325 tenía 225 articulaciones, 226 puentes de grafo y 26 ciclos. Las 3 hordas iniciales dejaban 95/300 nodos sin acceso a refugio. También había 26 coincidencias iniciales sobreviviente/zombie. La hipótesis geográfica queda respaldada por estas mediciones, pero no explica sola las muertes por runners. Ver [diagnóstico geográfico](diagnostico-geografico.md) y [diagnóstico de supervivencia](diagnostico-supervivencia.md).

## B. Nuevo mapa y sus límites

| Variante | Nodos | Aristas | Longitud vial km | Articulaciones | Puentes de grafo | Ciclos |
| --- | --- | --- | --- | --- | --- | --- |
| v1 histórico | 300 | 325 | 24.952 | 225 | 226 | 26 |
| v2 operativo | 300 | 383 | 43.196 | 158 | 136 | 84 |
| Ampliado experimental | 1000 | 1599 | 137.338 | 118 | 100 | 600 |
| Maestro urbano | 9179 | 13452 | 972.521 | 1578 | 1794 | 4274 |

Se adquirieron 25 teselas OSM completas y polígonos públicos de GeoManta. El maestro abarca las seis parroquias marcadas urbanas por esa fuente; no toda Manabí ni todo el cantón rural. Hay fuente comprimida, checksum, geometrías y trazabilidad por segmento. Se preservaron conexiones troncales reales hacia San Mateo que un filtro anterior omitía. Ninguna arista operativa omite una intersección real; no se conectaron nodos por mera proximidad.

**El operativo no representa todas las calles de Manta:** contiene 4,44% de la longitud vial del maestro. La exigencia de aproximadamente 300 nodos limita simultáneamente cobertura y alternativas. La envolvente gráfica es una referencia visual, no un límite municipal exacto. El ampliado no se activa automáticamente.

Más ciclos no garantizan robustez ante cualquier ataque: el peor corte de dos aristas deja 65/300 nodos sin refugio en v2 frente a 37/300 en v1; la peor horda deja 93/300 frente a 44/300. En ampliado esos valores bajan a 39/1000 y 45/1000. No se ajustó la topología usando las semillas de evacuación. Ver [fuentes, geometría, refugios y compromisos](grafo-fase2.md).

## C. Escenarios y comparabilidad

`scenarios/urban/round{1,2,3}.json` tiene 20/80/200 sobrevivientes y 150 turnos. Los orígenes son polígonos municipales verificables: Tarqui Centro, Los Esteros, Barbasquillo y Jocay. La distribución inicial es equilibrada y configurable; zombies se distribuyen por el territorio operativo. La navegación puede salir de la zona inicial. Capacidades asumidas: 60 por refugio, 240 en total. Refugios ficticios y ubicaciones están publicados en la documentación geográfica.

Las cantidades zombie se conservaron: ronda 1=8 walkers; ronda 2=12 walkers+4 runners+2 hordas; ronda 3=20 walkers+8 runners+3 hordas+10 sleepers. El puente físico de ronda 2 es `E-4420ceab96c993b4`; el colapso es ficticio. Ronda 3 bloquea dos calles. Las reglas de movimiento/mordida/visibilidad/duración no cambiaron.

Se predeclararon semillas `historical,7,42`. Histórica corresponde a 20261026/20261027/20261028 según ronda. El replay conserva posiciones/refugios históricos mediante remapeos geográficos registrados y el avance inicial de PRNG; con el mismo grafo reproduce 38/150/12. La topología puede alterar persecuciones posteriores. Los escenarios urbanos cambian deliberadamente refugios y condiciones iniciales para utilizar las cuatro zonas y evitar coincidencias imposibles; su mejora no se atribuye solo al algoritmo.

## D. Algoritmos e integración

Producción mantiene un único motor determinista con opciones. Dijkstra inverso compartido por refugio combina turnos, distancia/velocidad y riesgo estimado finito. Se respetan bloqueos, hordas y todos sus vecinos, posiciones zombies actuales y cruces opuestos de cada segmento runner. Solo se cruza una arista por turno. El predictor matemático desacoplado estima posiciones/transiciones a 1–2 turnos a partir de información observable; la envolvente futura es riesgo, no una prohibición absoluta ni una garantía.

Las cachés inmutables separan búsqueda de ruta y cambios de objetivos del pronóstico; se reutilizan búsquedas por contenido real, no se invalidan solo por cambiar world_version. Se conservan rutas seguras dentro de histéresis acotada. Una llegada segura al refugio se evalúa antes de la fase zombie siguiente.

El coordinador prepara asignaciones/reservas antes de publicar. Usa escasez/regret e histéresis 15%, sin sobreasignar. La simulación mantiene autoridad sobre posiciones/capacidad/ocupación, libera reservas y convierte la reserva en ocupación. Un escape no reserva plaza. `/paso` solo lee el plan coherente. El motor FASE 1 permanece congelado exclusivamente en `internal/evaluation/phase1`.

A geografía, B diagnóstico/simulación, C rutas/predictor, D coordinación y E infraestructura/clientes trabajaron con archivos exclusivos; el coordinador estabilizó contratos, evaluador, HTTP, integración, regresiones y medición. Ver [algoritmo](algoritmo-fase2.md), [reservas](nivel-pro.md#refugios-capacidad-reservas-y-concurrencia) y [reglas](reglas-simulacion.md).

## E. Evaluación comparativa

### Experimento A: solo geografía

Motor histórico congelado, misma semilla/cantidades/reglas/capacidad y 150 turnos. Refugios y apariciones históricos se remapean y cada distancia se registra en JSON. **E/M/A = evacuados/mordidos/vivos no evacuados**.

| Ronda | Semilla | v1 E/M/A | v2 E/M/A | Ampliado E/M/A |
| --- | --- | --- | --- | --- |
| 1 | 20261026 | 20/0/0 | 20/0/0 | 20/0/0 |
| 1 | 7 | 14/1/5 | 17/0/3 | 20/0/0 |
| 1 | 42 | 18/0/2 | 20/0/0 | 20/0/0 |
| 2 | 20261027 | 23/22/35 | 50/30/0 | 77/3/0 |
| 2 | 7 | 32/30/18 | 44/36/0 | 68/12/0 |
| 2 | 42 | 32/26/22 | 64/16/0 | 70/10/0 |
| 3 | 20261028 | 38/150/12 | 58/141/1 | 129/59/12 |
| 3 | 7 | 39/147/14 | 35/165/0 | 126/74/0 |
| 3 | 42 | 16/135/49 | 65/134/1 | 134/66/0 |

En la semilla histórica de ronda 3, cambiar mapa elevó evacuados 38→58 en 300 nodos y 129 en el ampliado, con el mismo motor. No es universal: en semilla 7 ronda 3, v2 evacuó 35 frente a 39 de v1. El promedio de evacuados de ronda 3 sube 31→52,67, pero vivos medios bajan 56→53,33. La ampliación 1000 obtuvo 129,67 evacuados medios y 133,67 vivos. Queda demostrada la influencia de la topología sin confundir mayor evacuación con mayor supervivencia.

### Experimentos B/C/D: mismo v2 y protocolo urbano

Por cada ronda/semilla, las cuatro variantes tienen idénticos hashes de grafo, configuración y estado inicial. `phase1` es motor original sobre las condiciones urbanas nuevas; `improved` activa predicción y coordinación; `no-prediction` desactiva solo predicción; `no-reservations` elimina el hook global, conservando motor/predictor.

| Ronda | Semilla | Original E/M/A | Nuevo E/M/A | Sin predicción E/M/A | Sin reservas E/M/A |
| --- | --- | --- | --- | --- | --- |
| 1 | 7 | 20/0/0 | 20/0/0 | 20/0/0 | 20/0/0 |
| 1 | 42 | 17/0/3 | 17/0/3 | 17/0/3 | 17/0/3 |
| 1 | 20261026 | 20/0/0 | 20/0/0 | 20/0/0 | 20/0/0 |
| 2 | 7 | 56/14/10 | 59/7/14 | 76/1/3 | 66/0/14 |
| 2 | 42 | 60/0/20 | 60/0/20 | 60/0/20 | 60/0/20 |
| 2 | 20261027 | 60/0/20 | 60/0/20 | 60/0/20 | 59/21/0 |
| 3 | 7 | 92/50/58 | 107/31/62 | 110/50/40 | 107/49/44 |
| 3 | 42 | 170/10/20 | 169/1/30 | 120/33/47 | 169/31/0 |
| 3 | 20261028 | 138/62/0 | 132/41/27 | 129/41/30 | 132/38/30 |

Promedios sobre las tres semillas, sin elegir únicamente ejecuciones favorables:

| Ronda | Variante | Evacuados | Mordidos | Activos | Total vivo | Turno medio de evacuación | Eficiencia media |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | phase1 | 19.00 | 0.00 | 1.00 | 100.00% | 18.72 | 0.855 |
| 1 | improved | 19.00 | 0.00 | 1.00 | 100.00% | 18.72 | 0.855 |
| 1 | no-prediction | 19.00 | 0.00 | 1.00 | 100.00% | 18.72 | 0.855 |
| 1 | no-reservations | 19.00 | 0.00 | 1.00 | 100.00% | 19.12 | 0.855 |
| 2 | phase1 | 58.67 | 4.67 | 16.67 | 94.17% | 15.23 | 0.787 |
| 2 | improved | 59.67 | 2.33 | 18.00 | 97.08% | 19.01 | 0.767 |
| 2 | no-prediction | 65.33 | 0.33 | 14.33 | 99.58% | 22.44 | 0.767 |
| 2 | no-reservations | 61.67 | 7.00 | 11.33 | 91.25% | 18.84 | 0.775 |
| 3 | phase1 | 133.33 | 40.67 | 26.00 | 79.67% | 16.11 | 0.837 |
| 3 | improved | 136.00 | 24.33 | 39.67 | 87.83% | 20.78 | 0.885 |
| 3 | no-prediction | 119.67 | 41.33 | 39.00 | 79.33% | 14.10 | 0.853 |
| 3 | no-reservations | 136.00 | 39.33 | 24.67 | 80.33% | 18.68 | 0.859 |

La eficiencia es promedio por ejecución respecto a distancia inicial al refugio más próximo sin zombies; puede diferir del destino final. No es una solución óptima conjunta. En ronda 3, el nuevo motor pasa de 133,33 a 136 evacuados medios y de 159,33 a 175,67 vivos medios: 68% evacuados y 87,83% vivos. Esta comparación aísla algoritmo; no equipara directamente 38 históricos con 132 urbanos de la semilla histórica.

Regresión explícita: en ronda 2 semilla 7, predicción activada dio 59 evacuados/7 mordidos/14 activos; desactivada, 76/1/3. En ronda 3 histórica, el original urbano evacuó 138 frente a 132 del nuevo, aunque el nuevo dejó 159 vivos frente a 138. Se conserva la configuración global por mayor supervivencia agregada, sin afirmar dominio por semilla ni optimalidad.

| Ronda | Variante | Inmovilidad acumulada media | Turnos sin ruta media | Máximo p95 HTTP de las semillas ms |
| --- | --- | --- | --- | --- |
| 1 | phase1 | 188.0 | 188.7 | 4.212 |
| 1 | improved | 188.0 | 188.7 | 3.831 |
| 1 | no-prediction | 188.0 | 188.7 | 4.223 |
| 1 | no-reservations | 188.0 | 188.7 | 7.123 |
| 2 | phase1 | 1818.7 | 2737.3 | 4.393 |
| 2 | improved | 2330.3 | 2925.3 | 4.000 |
| 2 | no-prediction | 1832.7 | 2690.0 | 3.929 |
| 2 | no-reservations | 2091.0 | 2603.3 | 4.988 |
| 3 | phase1 | 4739.0 | 5104.0 | 6.311 |
| 3 | improved | 6907.7 | 5977.0 | 5.384 |
| 3 | no-prediction | 8103.7 | 6976.3 | 5.533 |
| 3 | no-reservations | 4772.0 | 5288.7 | 6.841 |

La ausencia de rutas se desglosa por geografía, calles, amenazas y capacidad en cada informe; los mecanismos/tipos de mordida y tiempos por sobreviviente están registrados. Todos los 63 ensayos finales, 9450 turnos y 243681 solicitudes de simulación tuvieron 0 inválidas/0 timeouts y conservaron poblaciones. La disponibilidad medida es éxito/total, no un SLA externo.

### Auditoría de predicción y límites causales

En las nueve ejecuciones nuevas hubo 26976 candidatos de posición futura no ocupados sobre 32238 candidatos y 0 posiciones reales de runner no cubiertas. Es una envolvente de posibilidades, no predicciones simultáneas: su amplia cobertura puede generar desvíos innecesarios. Con/sin predicción hubo una diferencia neta de 45 mordidas menos al activarla. No se presenta ese delta como 45 intercepciones individuales demostradas: las decisiones cambian persecuciones y trayectorias posteriores. La regresión de ronda 2 documenta el costo real de sobreestimar riesgo.

No se calcula una puntuación oficial de prueba de fuego: el material aportado no incluye pesos/fórmula suficientes. Las proporciones medidas se publican sin inventar una rúbrica.

## F. Rendimiento y calidad

Benchmarks finales secuenciales, sin otros tests del proyecto en paralelo: Linux amd 64, Go 1.26.1, GOMAXPROCS 12, v2,200 sobrevivientes activos, 10.000 solicitudes por carga, una de calentamiento por sobreviviente. HTTP loopback real, reloj monotónico, incluye transporte/decodificación; percentiles de rango más próximo. El snapshot permanece estable; los ensayos 150 turnos complementan con replanificación/cierres/capacidad.

| Carga | p50 ms | p95 ms | p99 ms | Máximo ms | Disponibilidad |
| --- | --- | --- | --- | --- | --- |
| Sostenida 16 | 1.321 | 3.017 | 4.268 | 9.520 | 100% |
| Sostenida 200 | 11.913 | 48.855 | 88.352 | 175.737 | 100% |
| Ráfagas de 200 | 8.459 | 14.567 | 119.122 | 136.113 | 100% |

Las 30.000 solicitudes medidas tuvieron 0 errores/0 timeouts; p 95≤150 ms y máximo<500 ms en esta máquina. El benchmark previo a la corrección de bind se conserva en `http-before-ipv4-regression-fix`; la tabla usa la medición final cronológica, no el resultado más favorable.

En las rondas urbanas se separaron tiempos: máximo p 95 de planificación 20.608 ms, publicación 1.270 ms, turno 33.935 ms y adquisición de snapshot 3.176 ms. El motor histórico calcula en HTTP; la planificación del nuevo ocurre antes de publicar. Las cifras locales no equivalen a EC 2.

Pasaron **88 pruebas principales Go y subcasos con race**, vet/build, 10 Python, 22 React, 40 mock, 8 e 2 e escritorio/móvil, TypeScript/ESLint, generación consistente y builds web/mock. Flutter analyze limpio, 21 pruebas y 2 integraciones condicionadas omitidas en suite normal; la integración del mundo Go se ejecutó explícitamente con Chromium y Dart contra v1/v2. APK debug compilado; no se afirma prueba en dispositivo.

Docker detectó un defecto de integración real: un wildcard IPv 4 anunciaba `::1` y el health 200 ocultaba 200 decisiones fallidas en un contenedor sin IPv 6. Se corrigió el bootstrap para respetar IPv 4, añadió regresión y se repitió el paquete. La imagen final `sha256:ee09a3b6a38c89df40d30c0042cb800e101cd79ff062c992ee885cd5635fa105` (100.04 MiB) pasó 200 decisiones internas, auth, vecinos/bloqueos, reservas, visibilidad y health, no-root/readonly, 2 CPU/1 GB. La evidencia es `deploy/validation-phase2-final.json`.

## G. AWS

Preparados Docker multi-stage con digests, health, reinicio, HTTPS Caddy, CloudFormation EC 2/S 3 privado/CloudFrontOAC/CloudWatch/Budget, IAM mínimo, release/rollback y documentación de red/secretos. La imagen final usa v2 y escenario urbano compatibles. **No se desplegó AWS:** faltan CLI/acceso autenticado, cuenta y región autorizadas. No existe URL pública comprobada, gasto real, Budget creado ni captura `budget.png`. No se inventaron esas evidencias.

Estimación ilustrativa documentada: **24,03 USD/mes** para un ejemplo `us-east-1`,730 horas, con fuentes oficiales y supuestos; no es cargo observado ni cotización. La región debe confirmarse antes de usar la plantilla; el Budget precede a recursos con consumo. Ver [despliegue/rollback](despliegue.md), [costos](costos.md) y [diagrama](arquitectura.svg).

## H. Clientes

React conserva `/escape`, tema y Mock/HTTP. Ahora dibuja geometrías reales, polígonos de origen y envolvente de referencia, zoom/desplazamiento/reset, rutas seleccionadas, posición, próximo nodo, refugio, reservas y amenazas observadas. Sigue mostrando sobrevivientes fuera de su origen. El estado de conexión depende del mundo Go, sin requerir health del demo. Flutter conserva navegación y presenta mapa/ruta/detalles equivalentes. Ningún cliente recibe API keys privilegiadas ni sleepers dormidos; no hay controles de IA ficticios.

## I. Riesgos y límites abiertos

- 300 nodos no alcanzan para toda la vialidad urbana sin omitir intersecciones; el operativo es representativo y mantiene cuellos de botella. No se declara cobertura completa por ocupar una envolvente grande.
- Algunas personas vivas no llegan en 150 turnos; la coordinación greedy no garantiza costo óptimo y el predictor puede sobreestimar exposición. Se publican semillas/regresiones y ablations completas.
- Los escenarios urbanos usan nuevos orígenes/refugios y evitan coincidencias iniciales; comparar directamente su porcentaje con FASE 1 sin aislar factores sería incorrecto.
- Modelado peatonal OSM no sustituye verificación de aceras en terreno. Polígonos municipales y PDOT tienen versiones distintas, documentadas.
- Estado en memoria, observación pública local, sin WebSocket; polling funcional. Antes de publicación externa completar cuenta/región, DNS/HTTPS, política de acceso y medición sobre la instancia.
- No hay score oficial computable sin rúbrica suficiente ni prueba Android física/iOS. Reportes privados incluyen sleepers iniciales y deben mantenerse fuera del hosting público.

Se conservaron intermedios (`geography-intermediate-*`, `urban-prototype-*`, `urban-before-*`, `*-before-final-diagnostics`) porque cambiaron filtros de fuente o se corrigieron defectos concretos de admisión/escape/diagnóstico. No se usan para sustituir semillas finales ni ocultar resultados desfavorables.

## J. Reproducir y posibles acciones siguientes

Desde la raíz del monorepo:

```sh
npm install
npm run contracts:generate
npm run graph:generate
npm run graph:test
npm run check
npm test
npm run test:race
npm run build:web
npm run build:backend
npm run test:e2e
FLUTTER_BIN=/ruta/flutter/bin/flutter npm run test:contracts:http -- --urban --browser --flutter
npm run evaluate -- -graphs data/manta-v1.json -strategies phase1 -output reports/phase2/baseline
npm run evaluate -- -graphs data/manta-v2.json -strategies phase1 -output reports/phase2/geography
npm run evaluate -- -graphs data/manta-expanded.json -strategies phase1 -output reports/phase2/expanded-geography
npm run evaluate -- -protocol urban -graphs data/manta-v2.json -strategies phase1,improved,no-prediction,no-reservations -output reports/phase2/urban
npm run bench:backend -- -requests 10000 -concurrency 16 -output reports/phase2/http-16.json
npm run bench:backend -- -requests 10000 -concurrency 200 -output reports/phase2/http-sustained-200.json
npm run bench:backend -- -requests 10000 -concurrency 200 -burst -output reports/phase2/http-burst-200.json
docker build -t corodev-evacuation:phase2 -f services/evacuation/Dockerfile .
python3 tools/qa/verify_docker.py
python3 tools/qa/report_phase2.py
```

Los argumentos de rutas de wrappers Go son relativos a `services/evacuation`; reportes detallados son privados. Semillas, pesos, grafos y posiciones están incluidos por ejecución. Repetir cambia latencias, no se fuerzan tiempos reproducibles. Para arrancar web/backend/Flutter consultar [README](../README.md).

Para una eventual FASE 3: confirmar cuenta/región y desplegar con Budget real; resolver con la organización el límite de intersecciones; estudiar el ampliado y cruces temporales; calibrar predictor sobre más semillas y mejorar asignación. WebSocket solo tras estabilizar despliegue. **Ninguna acción FASE 3 se inició.**
