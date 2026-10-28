# FASE 8 — Hidrología espacial y duración configurable

El motor radial de inundaciones fue sustituido por `rainfall_runoff_2d`. No hay
selector ni ejecución Legacy. `compound_flood_2d` añade nivel marítimo y aporte
de cauce. Ambos son experimentales sobre **relieve sintético**, sin validación
contra profundidades observadas ni valor de pronóstico oficial.

## Diagnóstico del modelo anterior

`internal/flood/model.go` mantenía tres focos sobre nodos viales: uno fijado por
el laboratorio para estresar un corredor y dos elegidos con semilla. Integraba
un índice `q` mediante crecimiento y decaimiento exponencial, lo recortaba a
0–1 y calculaba `radio = 150 + 650*q`. La exposición disminuía parabólicamente
con la distancia al centro. No existían profundidad, volumen, relieve, conexión
hidráulica ni balance de masa. El drenaje reducía ese índice, sin representar
capacidad de una red. Aumentar lluvia no podía superar el radio máximo.

Las distancias foco–polilínea se preprocesaban una vez. Por turno se actualizaban
exposición, estados viales, disponibilidad de refugios y planificación; por GET
se entregaba un snapshot. El planificador reutiliza búsquedas mientras no
cambien costos efectivos, cierres o destinos. `/paso` consulta planes y conserva
su contrato español, autenticación, vecino transitable o espera.

La capa oficial aplicaba anteriormente factores categóricos experimentales a
los focos; no era un DEM ni una medición de agua. Ahora sólo fija procedencia y
contexto visual: no inyecta volumen ni altera elevaciones o riesgo calculado.
Los resultados históricos FASE 4A–4D se conservan en los JSON de `deploy/`;
las guías del runtime radial se retiraron al quedar sustituidas.

## Dominio y datos

El grafo OSM conserva geometría, navegación y refugios experimentales. El agua
evoluciona en otra malla regular de cuatro vecinos. Al preparar la ejecución se
calculan extensión vial más una celda de margen, elevaciones, conexiones y
celdas atravesadas por cada segmento de calle, incluidos sus interiores. No se
reconstruyen geometrías por turno. Cambiar refugios no modifica la malla.

Resolución solicitada: 50–1.000 m, predeterminada 200 m. Se engrosa en incrementos
de 5% hasta un máximo de 4.096 celdas; el snapshot informa la resolución efectiva.
El descriptor contiene origen suroeste, filas, columnas y pasos geográficos;
las profundidades se publican en orden de filas hacia el norte. No se repite
topología vial ni arrays de elevación en polling.

No hay DEM comprobado en el repositorio. Se revisaron las fuentes oficiales de
[Copernicus DEM](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM)
y su [distribución pública GLO-30 en AWS](https://registry.opendata.aws/copernicus-dem/).
GLO-30 es un modelo de superficie de unos 30 m, incluyendo estructuras y
vegetación. No se descargó ni acondicionó hidráulicamente para esta entrega;
no se afirma que sea inaccesible. Su integración requiere fuente conservada,
checksum, tratamiento de vacíos, datum y conexión costera verificados fuera del
paso crítico. Un DSM sin acondicionar no se presenta como terreno urbano validado.

La fuente utilizada es `synthetic-coastal-basin-v1`: pendiente hacia un borde
oeste experimental, canal central y depresión suave. En metros locales, con
`L` tamaño de celda y `yc` centro del dominio:

```text
z = max(0.02,
    .001*x + .00015*abs(y-yc)
    - .9*exp(-((y-yc)/(2*L))²)
    - .7*exp(-((x-.55*ancho)/(2*L))²-((y-yc-L)/(2*L))²))
```

Esta fórmula **no representa cotas, cauces, cuencas contribuyentes ni línea de
costa reales de Manta**. Cambiar cobertura cambia también este dominio sintético;
una comparación BASE/FULL no aísla únicamente el algoritmo ni aporta validación
geográfica. La semilla afecta a agentes; el campo hidráulico fijo no cambia con
la semilla. La lluvia espacial varía suavemente ±15%, normalizada a media uno.

## Ecuaciones y estabilidad

Cada celda tiene área `A=L²`, profundidad `h`, elevación `z` y saturación `s`.
Se integra precipitación, infiltración y drenaje antes del transporte superficial.
Se usan subpasos `dt ≤ min(30 segundos, L/5)` y se dividen exactamente los cambios
de perfil de lluvia.

```text
lluvia_m = mm_h * dt / 3_600_000
infiltración_m = min(h, infiltración_mm_h * (1-s) * dt / 3_600_000)
s_nueva = min(1, s + infiltración_m / .1)
drenaje_m = min(h, drenaje_mm_h * clamp((z+h-nivel_mar)/.5, 0, 1) * dt / 3_600_000)
H = z + h
Q_ij = L/.06 * h_arriba^(5/3) * sqrt(abs(H_i-H_j)/L)
V_ij ≤ min(Q_ij*dt, abs(H_i-H_j)*A/4)
```

Los flujos se calculan desde el mismo estado y luego se aplican simultáneamente.
Se limita la suma de salidas de cada donante al agua disponible. Las conexiones
ausentes son impermeables; no se permite transferencia a celdas no vecinas.
La fórmula difusiva de Manning es una aproximación sin ecuación de momento,
inercia, velocidad fiable ni solución CFD. Rugosidad `.06`, almacenamiento de
suelo de 100 mm y capacidad de tubos son supuestos sin calibración. No se simulan
alcantarillado explícito, edificios, evapotranspiración ni recuperación del suelo.

El libro de masa acumula agua inicial, lluvia, entradas de cauce y mar,
infiltración, drenaje, salida al mar y almacenamiento superficial:

```text
residual = inicial + lluvia + cauce + mar_entrada
           - infiltración - drenaje - mar_salida - almacenado
```

El benchmark exige `abs(residual) ≤ max(.001 m³, lluvia_m3*1e-9)` y profundidades
no negativas. Este balance verifica consistencia numérica, no precisión física.

## Lluvia, tiempos y costa

Los identificadores existentes se conservan: `storm` llueve hasta 55% del
horizonte y luego drena; `constant` durante todo el horizonte; `pulse` entre 15%
y 45%. El agua acumulada permanece tras cesar la lluvia y se transporta/drena.
La intensidad 0–1 equivale a **0–120 mm/h de escenario**, una escala experimental
sin calibración meteorológica. No es una observación ni probabilidad.

`simulation_duration` del laboratorio cuenta turnos enteros 30–3.000. Su reloj
de evacuación conserva una unidad por turno por compatibilidad. El reloj físico
hidrológico usa `seconds_per_turn` (1–300, predeterminado 60). La lluvia antecedente
(0–24 h) se integra antes del turno cero, con la misma intensidad normalizada;
se pueden añadir saturación inicial 0–1 y profundidad inicial uniforme 0–2 m.
El ledger incluye ese calentamiento. Aporte de cauce y nivel marítimo se aplican
también durante él. `interval_ms` sólo regula la espera de reproducción; no
multiplica lluvia ni tiempo físico. `runtime_elapsed_ms` mide reloj real activo,
incluido ritmo de reproducción, excluidas pausas, y se congela al terminar.

El borde oeste sintético tiene salidas explícitas. Los demás bordes son cerrados.
La proximidad de una celda al borde no la moja: requiere conexión y diferencia
de carga. En Compound, un mar elevado puede entrar por esas salidas e impedir
parte del drenaje; se añade caudal de cauce en una celda aguas arriba. Nivel
marítimo distinto de cero y caudal positivo se rechazan en Rainfall–Runoff.
No hay tsunami, marea astronómica ni cuenca externa real modelada.

## Acoplamiento y evacuación

La máxima profundidad muestreada en las celdas de cada geometría vial determina
`passable`, `caution` o `blocked`. Umbrales predeterminados: 10 cm/30 cm, histéresis
de reapertura 3 cm, todos editables. Son límites de escenario, no criterios de
seguridad certificados. Se publica `depth_m`; el índice de riesgo es
`clamp(profundidad/umbral_bloqueo)`. El core combina cierres base, eventos e
hidráulica sin que una reapertura borre otra fuente. Un cambio de profundidad
sin cambio efectivo de costo/cierre no invalida indiscriminadamente las rutas.

Se conservan `preventive`, `late` y `adaptive`. Preventiva empieza de inmediato;
tardía se activa con riesgo observado ≥.35 o al 55% del horizonte; adaptativa con
riesgo ≥.15, lluvia normalizada ≥.5 o al 20%. Son señales del escenario actual,
sin acceso al futuro hidráulico. Después de empezar conservan la planificación
dinámica compartida, reservas, capacidad y alternativas. No se alteran
probabilidades de supervivencia ni se matan agentes artificialmente. La exposición
excluye nuevos destinos; quienes ya evacuaron permanecen evacuados.

## Duración, clientes y operación

`internal/runlimits` centraliza mínimo 30, máximo 3.000, default 150 y oficial 150.
Zombis personalizados usan `max_ticks`. Official exige BASE, classic, población y
refugios de ronda, 150 turnos/2.000 ms, sin flota; el backend rechaza alteraciones.
Los resultados conservan modo y horizonte para no mezclar puntuaciones. El límite
de pared predeterminado de sesiones pasa a seis horas para cubrir 3.000×5 s más
cálculo (las plantillas actuales usan `SIM_MAX_WALL_TIME=6h`; una instalación
con un valor explícito anterior debe revisarlo antes de ejecutar horizontes largos); los TTL de lease y retención siguen vigentes, espectadores no los renuevan.

No hay finalización temprana por agentes terminales: se ejecuta el horizonte
completo, permitiendo observar retroceso del agua. Hay pausa, reanudación,
cancelación y reinicio explícitos. Cada motor conserva un solo escritor, su
estado propio y arrays acotados. El laboratorio admite una tormenta; la comparación
A/B pausa ésta y procesa dos ejecuciones secuenciales con orígenes idénticos.
Las consultas de estado leen snapshots cacheados; una acción espera el fin del
paso en curso. La preparación, incluidos antecedentes, es síncrona y puede tardar.

React conserva los controles existentes y añade dos modelos funcionales,
duración y parámetros avanzados. Nunca inicia al montar. El mapa agrupa celdas
en tres paths por profundidad, sin animaciones hidráulicas inventadas. Flutter
Android y `/mobile` observan el mismo snapshot y geografía separada, sin crear ni
controlar ejecuciones. El mapa ciudadano conserva su independencia. Se validan
dimensiones, valores finitos y profundidades antes de representar el grid.

Se retienen hasta 512 muestras compactadas de métricas; no mapas completos por
turno. Se puede inspeccionar esa historia de métricas, no reproducir un mapa
pasado. Reiniciar el proceso pierde los motores del laboratorio, como antes.
El servicio de inundaciones sigue separado del zombie; no se atribuye a este
módulo el SLA oficial de `/paso`. No se cambió ni desplegó infraestructura AWS.
La disponibilidad y capacidad real de EC2 2 vCPU/8 GiB no están certificadas.

## Reproducción y evidencia

`npm run bench:hydrology` construye `cmd/flood-bench` y ejecuta escenarios completos
por HTTP real autenticado: seis horizontes con replay, tres perfiles por tres
comportamientos, Compound y FULL con 200 agentes a resoluciones solicitadas
50/200/500 m. Escribe JSON local en `services/evacuation/reports/phase8/`; esos
artifacts se mantienen separados de las aserciones deterministas. Los hashes
excluyen tiempos HTTP, rendimiento, IDs y reloj de pared.

`npm run bench:flood -- -turns 600 -model rainfall_runoff_2d -cell-size 200
-output reports/phase8/manual.json` permite repetir un caso. El reporte conserva
configuración efectiva, checksum del escenario fuente, grafo, balance, historia
acotada, latencia del paso, serialización, CPU, RSS y muestras de heap tras GC.
La serialización se mide localmente; no representa latencia de Internet. La
representación del cliente se mide por separado en pruebas de navegador y no
se confunde con FPS de pintura.

Las pruebas hidráulicas cubren lluvia plana, pendiente, depresión, barrera,
propagación, descarga, mar elevado, saturación, persistencia tras pulso, respuesta
retardada aguas abajo, conservación, no negatividad y copias observables. Las
integraciones ejercitan HTTP autenticado, cierres y reaperturas, reservas,
perfiles, comportamientos, duraciones, reproducibilidad y cancelación.

Los resultados numéricos y el cierre de validación se registran en
[fase8-resultados.json](fase8-resultados.json). La comparación con el antiguo
modelo usa evidencia histórica conservada; las nuevas profundidades en metros
no se comparan numéricamente con su índice adimensional como si midieran lo mismo.

### Resultados ejecutados, 27 de octubre de 2026

Los 25 escenarios completos del benchmark aprobaron sus invariantes. Los seis
horizontes repetidos conservaron exactamente su hash lógico. En BASE, 150 turnos
mantuvieron 80/80 evacuados y 14 cierres máximos, frente a 69 del artefacto radial
histórico: no se inflaron bloqueos para favorecer la apariencia. La evacuación
preventiva termina antes del crecimiento significativo del agua; no se atribuye
a esa igualdad una mayor precisión ni supervivencia.

| Caso | Malla efectiva | Paso completo p99 | RSS máxima del proceso |
| --- | --- | --- | --- |
| BASE, 150 turnos/80 agentes | 1.647 celdas, 200 m | 33,95 ms | 29.776 KiB |
| BASE, 3.000 turnos/80 agentes | 1.647 celdas, 200 m | 21,87 ms | 32.888 KiB |
| FULL, 150 turnos/200 agentes, solicitud 200 m | 3.948 celdas, 220,5 m | 1.168,31 ms | 233.840 KiB |

Son mediciones locales en una estación compartida con otras verificaciones, no
una comparación aislada ni capacidad EC2. El último paso FULL registró 1,34 ms
hidráulicos y 110,08 ms del resto del paso; `evacuation_step_latency_ms` incluye
planificación, HTTP, movimiento y publicación, no sólo caminar. La serialización
FULL registró p99 de 18,15 ms. El residual final BASE/3.000 fue 0,0002212 m³ y su
heap retenido tras GC, 3.306.952 bytes; no se infiere memoria ilimitadamente estable.

El flujo Chromium FULL de inicio/pausa registró 759,25 ms de trabajo del hilo
principal: 495,65 ms de script, 4,18 ms de layout y 7,62 ms de estilos, mediante
contadores CDP. No son métricas de FPS ni tiempo puro de pintura. Conservó 627
nodos DOM y no registró errores JavaScript ni solicitudes API fallidas. Se
corrigió el desbordamiento del HUD a 390 px conservando texto y controles visibles.

El benchmark zombie de 10.000 solicitudes autenticadas registró 10.000 válidas,
cero inválidas/timeouts y p99 local de 14,15 ms sobre un snapshot inicial. La suite
de escenarios y sesiones verifica por separado invalidación y rondas completas;
esta microprueba no certifica el SLA en infraestructura remota.

Validación ejecutada: instalación npm, contratos y regeneración, tokens,
`npm run check`, 166 pruebas React y 40 del mock, build web, tests completos Go y
race detector, `go vet`, build backend, 10 pruebas geográficas, contratos HTTP
generales/inundación/sesiones, laboratorio y visores HTTP/navegador, referencia
oficial contextual e incidentes ciudadanos. Flutter: análisis sin incidencias,
30 pruebas aprobadas, build APK debug; tres integraciones optativas quedan
omitidas en la invocación genérica y las de publicados y reportes se ejecutaron
separadamente contra Go real. No se construyó Flutter Web ni se desplegó.
