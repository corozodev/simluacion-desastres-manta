# Entrega FASE 4D — datos oficiales, procedencia y AWS

Trabajo y validación local del **26–27 de octubre de 2026**, America/Guayaquil. Se conservan timestamps UTC y hashes en [`deploy/validation-phase4d.json`](../deploy/validation-phase4d.json). No se realizó push, despliegue, modificación de recursos ni consulta a la cuenta AWS.

## Integración verificada

La aplicación muestra una capa oficial independiente con atribución, permite incorporarla opcionalmente a una tormenta sintética y continúa funcionando sin Internet o sin copia disponible. El simulador y `/paso` conservan autoridad exclusiva sobre rutas/movimiento. El escenario zombie permanece independiente.

Se verificaron las capacidades reales de [Susceptibilidad de Inundaciones](https://sgrportal.gestionderiesgos.gob.ec/server/rest/services/Susceptibilidad_de_Inundaciones/MapServer/0) y [EVENTOS_X_LLUVIAS](https://sgrportal.gestionderiesgos.gob.ec/server/rest/services/Hosted/EVENTOS_X_LLUVIAS/FeatureServer/0), además de los ítems del portal. Hallazgos de la copia:

| Dato | Resultado real |
| --- | --- |
| Susceptibilidad | EPSG:32717; Query/GeoJSON; límite 2.000; paginación **no soportada** |
| Área | Envolvente del maestro Manta, sin afirmar límites municipales |
| IDs intersectantes | 61; se excluyen explícitamente `SIN` y `NO APLICABLE` antes de solicitar geometrías |
| Clases conservadas | **13 ALTA, 11 MEDIA y 35 BAJA**; 59 polígonos / 3.463 vértices |
| Salida | GeoJSON MultiPolygon, longitud/latitud EPSG:4326 solicitada al servidor |
| Resolución de presentación | Tolerancia solicitada 0,0001 grados; el anillo degenerado de 9465 se recuperó con mayor detalle |
| Atribución y fechas | CONAGE 2024 y todas las entidades declaradas; atributos `anno:2025`; consulta de copia `2026-10-27T04:42:05.275571955Z` |
| Actualización/publicación de polígonos | No declaradas; modificación del ítem del portal 2026-10-06, identificada por separado |
| Licencia | El portal no declara licencia explícita; se conserva la atribución sin asignar una licencia supuesta |
| Eventos de lluvias | 16 puntos, catorce de Manta y dos de Montecristi; fechas 2025-02-16 a 2025-04-14 |
| Última actualización declarada del subconjunto de eventos | 2025-04-15; se conserva la fecha de cada registro |

La [copia versionada y su README](../services/evacuation/data/reference/README.md) contienen consultas y trazabilidad. El checksum verifica integridad local; no es firma de la fuente. Las geometrías seleccionadas se conservan enteras, sin afirmar un recorte topológico. No se descargan campos de responsables/identidad de los registros históricos. `N/A` en cierre nunca se interpreta como evento activo.

## Contratos, motor y frontend

Se preservaron semánticamente **29 paths y 65 schemas** anteriores. Se añadieron cinco paths y trece esquemas, más dos extensiones opcionales: `LabRunConfig.geographic_reference` y `DataProvenance.geographic_reference`. TS/JSON Schema están generados; Dart no cambia al no incorporar nuevos flujos Flutter en esta fase. Los endpoints, cuerpos y errores están en la [guía A–E](datos-oficiales-y-demo.md).

`internal/reference` consulta metadatos y una lista de IDs acotada al bbox; obtiene lotes de hasta 50, comprueba completitud, transforma en el servidor con `outSR=4326`, normaliza polígonos, valida coordenadas/anillos y limita bytes/vértices/registros. Se descartan errores ArcGIS aun con HTTP 200. Hay dos intentos como máximo por solicitud, timeout de ocho segundos y presupuesto de 60 segundos por adquisición. No se suponen offsets en la capa que no los soporta.

La copia privada se reemplaza atómicamente con sincronización a disco. Las consultas y la simulación usan RAM/caché; sólo una actualización optativa trabaja con Internet. Corrupción, timeout, caída de proveedor o guardado fallido se muestran sin perder la copia activa. Sin una copia válida, el backend acepta una tormenta totalmente sintética y muestra la capa indisponible. No se fabrican polígonos para rellenar vacíos.

El factor experimental se calcula una vez, al preparar la ejecución, usando la mayor clase que interseca el radio máximo de cada foco. Respeta agujeros y segmentos. Factor = `1 + peso × rango`, con BAJA=0, MEDIA=1 y ALTA=2; `NONE` conserva factor 1 y declara ausencia de intersección. La semilla, lluvia, focos y grafo no se sustituyen. La referencia cambia el crecimiento de un índice sintético, sin darle unidades físicas. Con lluvia cero no genera exposición. La versión/clase/IDs/factor quedan en la procedencia; refrescar la fuente no cambia el mundo activo.

React añade una novena capa con 59 paths, bordes discontinuos, leyenda y colores distintos de la exposición cyan. El panel muestra fuente, fechas, CRS, versión y atribución; separa eventos históricos de reportes ciudadanos. La consulta de disponibilidad tiene intervalo de 30 s y la geometría se conserva por versión. No se vuelve a descargar por cada polling del mundo. En la demo de semilla 42 se registraron focos MEDIA×1,25, ALTA×1,5 y NONE×1, con el peso experimental 0,25 explícito.

## Benchmarks reales

Linux amd64, Go 1.26.1, GOMAXPROCS=12, 80 agentes, concurrencia 16, 150 pasos acelerados y `/paso` HTTP autenticado real. Los siguientes casos antes/después usan el escenario original `urban-storm.json`, semilla 20261026. La medición final se ejecutó sin otras suites/builds simultáneos. Los tiempos son locales y variables.

| Modo sintético original | Antes media Step | Después media Step | Antes p95 | Después p95 | Resultado |
| --- | ---: | ---: | ---: | ---: | --- |
| 300 nodos / 383 aristas | 5,0085 ms | 4,7499 ms | 25,4819 ms | 22,9010 ms | Hash completo idéntico; 80/80 evacuados |
| 9.179 nodos / 13.452 aristas | 117,8481 ms | 102,0732 ms | 361,3418 ms | 290,0993 ms | Hash completo idéntico; 80/80 evacuados |

Hashes de timeline conservados: competición `19755377bbc09a875aff67eafa89da1ebc13041eed9b04b5d59a69a4523f0505`; maestro `6e58f150f004a58adf023a59006c8caaf12088026cdedadeba2ee2628e373268`. Se mantuvieron los valores observables y los escenarios anteriores. Estos tiempos no acreditan una optimización causal ni un SLA. La primera medición provisional del maestro, mientras había otras comprobaciones, obtuvo p95 429,0976 ms; se conserva separada como `after-flood-master-initial.json` y no se oculta esa variación.

Los focos aleatorios del escenario original no intersectaron las clases seleccionadas en esta copia (`NONE`). Para medir el caso con influencia real se añadió **un escenario sintético explícito**, `reference-corridor.json`: semilla 42, mismo número de agentes y lluvia, foco en el nodo real `OSM-363647979`, radio máximo 800 m. Interseca el polígono MEDIA `23151`, factor 1,25. Cada par sólo cambia la referencia:

| Corredor | Sintético | Con referencia |
| --- | ---: | ---: |
| Competición · media Step | 6,3484 ms | 7,4739 ms |
| Competición · p95 Step | 23,1123 ms | 23,1786 ms |
| Competición · replanificaciones | 74 | 83 |
| Competición · tiempo medio simulado de evacuación | 17,4750 | 18,0250 |
| Maestro · media Step | 121,0991 ms | 122,7182 ms |
| Maestro · p95 Step | 310,0704 ms | 314,1187 ms |
| Maestro · replanificaciones | 133 | 140 |
| Maestro · tiempo medio simulado de evacuación | 37,4875 | 36,3500 |
| Evacuados, en los cuatro casos | 80/80 | 80/80 |

No se deduce mejor seguridad ni superioridad de una estrategia a partir de esos cambios. El peak de cierres fue igual dentro de cada par: 49 en competición y 282 en maestro; cambió su evolución temporal. Los dos casos con referencia se repitieron con su hash esperado y pasaron: `2af4785e508053737dfb5f58faaa54d7ad49deb7f4038d4a162f20dc842fc630` y `766115d4f22a38a5243a9b262c4401c4e80588c68c41ba361bedbbac42156624`.

El benchmark zombie original de 10.000 solicitudes conservó 100% disponibilidad y cero inválidas/timeouts: p50 **1,6304→1,4053 ms**, p95 **3,7671→3,1674 ms**. Es observación local, no aceleración atribuida a esta fase ni medición HTTPS de AWS. Los benchmarks completos se conservan en el directorio privado con hashes públicos consolidados.

Reproducción del par con referencia, desde la raíz:

```sh
npm run bench:flood -- -scenario scenarios/flood/reference-corridor.json -output private/corridor-synthetic.json
npm run bench:flood -- -scenario scenarios/flood/reference-corridor.json -reference data/reference/manta-official.json -output private/corridor-reference.json
# Añadir -graph data/manta-master.json para medir el maestro.
```

## Navegador, modo offline y pruebas

El checker final Go/React/Chromium pasó diez comprobaciones reales. Sirvió 59 polígonos / 3.463 vértices y los eventos históricos desde la copia, inició la opción combinada desde UI, verificó semilla/orígenes/lluvia/versiones, ejecutó ambos grafos, reutilizó la geometría durante pasos posteriores, conservó zombie/grafo base y arrancó otra instancia **sin copia** que avanzó en modo sintético.

Mediciones de esa ejecución: GeoJSON oficial **92.297 bytes**, grafo maestro **4.543.303 bytes**; carga y render de la capa base **457,87 ms**; inicio del maestro hasta pausa y polígonos **1.742,86 ms**, incluyendo preparación/HTTP/confirmación. La página tuvo **913 elementos DOM**, heap JS CDP **54.682.016 bytes** y una sola descarga de polígonos. No se presentan esos tiempos como FPS, pintura aislada o garantía de memoria sostenida. El contador de solicitudes al proveedor fue **cero** durante el checker offline.

| Validación ejecutada | Resultado |
| --- | --- |
| Go completo, `-count=1 -json` | **167 pruebas principales / 261 con subcasos**, 16 paquetes con pruebas, cero fallos |
| Go `-race ./...`, vet/build | Correctos; se repitieron reference/floodlab con race tras afinar el mensaje de persistencia |
| Nuevas pruebas Go | Nueve: cinco adaptador/caché/geometría, una modelo de pesos y tres laboratorio/HTTP/no bloqueo |
| OpenAPI, generación, tokens, npm check | Correctos, sin dependencias nuevas y con lockfiles conservados |
| React / servicio histórico | **53 / 40** aprobadas; cuatro React nuevas, más regresión de nueve capas |
| Build React | Correcto; chunk flood 66,04 kB / 19,36 kB gzip |
| Flutter analyze/test/APK | Sin incidencias, **23** aprobadas y dos integraciones condicionadas omitidas en suite normal; APK construido |
| Integraciones Flutter habilitadas | Observación zombie y envío/replay de incidente contra Go real, ambas aprobadas |
| Playwright zombie desktop/móvil | Ocho regresiones aprobadas |
| Datos geográficos Python | Diez pruebas aprobadas |
| Contratos HTTP zombie e inundación 4A | Aprobados, incluyendo `/paso` autenticado |
| Laboratorio 4B | Trece comprobaciones aprobadas, incluidos evolución, refugios/A/B y maestro |
| Incidentes 4C | Once comprobaciones aprobadas: Flutter real, reinicio persistente, pendiente y desvío 3→4 / 0→1 |
| Referencias 4D | Diez comprobaciones reales y seis capturas; cero tráfico externo/raster, errores JS/HTTP o credenciales filtradas |

Se prueban metadatos incompatibles, paginación no supuesta, cuotas, error ArcGIS con HTTP 200, reintentos/cancelación, coordenadas UTM o anillos inválidos, agujeros/intersección, checksum/corrupción, versión ausente y proveedor lento. La prueba de proveedor lento verifica pasos avanzando mientras su petición permanece pendiente. La geometría simplificada inválida se recupera de la fuente con mayor detalle; no se inventa.

El nuevo panel expuso un desborde móvil por un identificador largo; se corrigió el wrapping y se verificó ausencia de desborde a 390 px. El checker 4C necesitó esperar a que el polling mostrara el nuevo estado idle y su lista después del reinicio; se conservan sus aserciones. Las cancelaciones normales de GET durante cambio de ejecución se registran aparte.

Capturas locales, con hashes en la evidencia consolidada:

- [Referencia base offline](../deploy/evidence-private/phase4d-20261026/reference-base-offline.png).
- [Combinación e historia](../deploy/evidence-private/phase4d-20261026/reference-hybrid-and-history.png).
- [Maestro con referencia](../deploy/evidence-private/phase4d-20261026/reference-master-offline.png).
- [Polígonos sobre la red real](../deploy/evidence-private/phase4d-20261026/reference-map-polygons.png).
- [Página móvil](../deploy/evidence-private/phase4d-20261026/reference-mobile-390.png).
- [Panel móvil](../deploy/evidence-private/phase4d-20261026/reference-panel-mobile-viewport.png).

## AWS, compatibilidad y límites

La auditoría revisó IaC, configuración de logs y entregas 4A–4C. Se aprovecha el patrón de JSON stdout y el driver `awslogs` previsto, con un evento `lab_metrics` cada 30 segundos y [consultas Logs Insights preparadas](../deploy/log-insights-phase4d.txt). No se ejecutaron en CloudWatch ni se afirma que producción ya reciba estos eventos. No hay recursos, alarmas, métricas personalizadas, SDKs AWS ni costo fijo nuevo aprovisionado. Disco, ingestión, consultas o tráfico pueden generar cargos si se despliega posteriormente.

El laboratorio sigue siendo loopback con sesión local/Origin/CSRF, separado del backend publicado. Su activación remota, autenticación y montaje persistente requieren una decisión de despliegue posterior. No se modificó CloudFormation: esta entrega no requiere recursos nuevos. El directorio raíz EBS anterior no equivale a respaldo y tiene `DeleteOnTermination:true`; el contenedor anterior es de sólo lectura.

Track A conserva prioridad 300/383, geografía original, reglas zombie, contrato `/paso`, motor congelado FASE 1 y datos previos. La fase no fuerza al maestro a satisfacer los mismos tiempos ni modifica reglas para favorecerlo. Las fuentes externas no son dependencia del ciclo de simulación. Se conservan reportes y cambios previos del usuario.

Permanecen los límites académicos: pesos arbitrarios adimensionales, falta de calibración/DEM/drenaje real, generalización y vacíos de cobertura, fechas históricas, licencia no explícita, caché de un proceso sin archivo histórico completo, ausencia de alerta oficial o navegación segura. Un círculo que no interseca la copia no acredita seguridad. No se probó GPS físico nuevo ni se añadió offline completo en Flutter.

La [guía A–E](datos-oficiales-y-demo.md) distingue datos ficticios, oficiales, ciudadanos y estados de revisión; incluye recomendaciones para adaptadores separados IG-EPN e INOCAR. Esas recomendaciones son propuestas de evolución: terremoto y tsunami no se implementaron ni se presentaron como variantes del modelo pluvial.

## Archivos y commits locales

- Contratos: `packages/contracts/openapi.yaml` y `generated/{api.d.ts,schemas.json}`.
- Adquisición/datos: `services/evacuation/internal/reference/{models,client,cache,geometry,influence,reference_test}.go`, `cmd/reference-fetch/main.go`, `data/reference/{manta-official.json,README.md}`.
- Motor: `internal/flood/{config,model,reference_test}.go`, `internal/world/scenario.go`, `internal/simulation/{scenario,planner,operational}.go`, `cmd/flood-bench/main.go`.
- Laboratorio: `internal/floodlab/{models,manager,http,reference,reference_test}.go`, `cmd/flood-lab/main.go`.
- React: `features/flood/{ReferencePanel,FloodMap,FloodLab,flood.css}`, `services/{api,queries}.ts`, `tests/{reference,flood}.test.tsx`.
- QA/operación: nuevo checker, espera de reinicio 4C, `dev_lab.mjs`, `package.json`, escenario `reference-corridor.json`, consultas Logs Insights y esta documentación/evidencia.

Commits: `ec7b188` contratos; `66f32c6` adaptador/datos/modelo/medición; `0677ea6` API local/actualización/telemetría; `c95205e` React; `837ccc4` QA/demos/operación. La documentación y evidencia se conservan en un sexto commit identificable con `git log -6 --oneline`. Se usaron identidad y fechas reales, sin push.

Los cinco cambios previos FASE 3B.2 quedan fuera de estos commits: `deploy/validation-phase3b2.json`, `docs/informe-fase3b2.md`, `docs/operacion-multigrafo.md`, `docs/revision-rollout-fase3b2.md` y `deploy/validation-phase3b2-rollout.json`.
