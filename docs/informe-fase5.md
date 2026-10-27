# FASE 5 — Ejecuciones bajo demanda y sesiones independientes

Implementación local del 27 de octubre de 2026. No se realizaron acciones AWS, despliegues, publicación ni cambios de credenciales. El comportamiento descrito corresponde al código local; la instancia pública requiere su despliegue autorizado posterior.

## Resultado y diagnóstico

`cmd/server` preparaba un runtime global y lanzaba su bucle de simulación al arrancar. React `/escape` observaba `/estado`; abrir la página no originaba el trabajo, pero todos los visitantes veían el mismo mundo global. El motor real `urban_flood` ya estaba implementado en Go y disponía de API experimental y laboratorio; esta fase integra ese motor, sin inventar otro.

Ahora el proceso prepara el catálogo y arranca el manager sin iniciar motores. `/escape` carga el mapa, las capacidades y el formulario; sólo `Iniciar simulación` crea una sesión. Recuperar la credencial de una pestaña rehidrata una ejecución existente. El polling, recargar y navegar no crean ni reinician trabajo. El runtime legacy conserva `/healthz`, `/grafo`, `/estado` y `/paso` con sus DTO anteriores; permanece inactivo por defecto. `SIM_AUTOSTART=true` se rechaza en el arranque: iniciar siempre exige una solicitud explícita. Las comprobaciones de compatibilidad preparan su ronda de forma explícita.

En `cmd/server` el inicio administrativo legacy se deshabilita para que no pueda saltarse los cupos del manager. `POST /admin/runs` conserva autenticación/validación y rechaza el arranque con `409`; los consumidores internos, tests y CLI históricos mantienen su composición explícita. Toda ejecución pública de esta versión debe pasar por las sesiones privadas. `/estado` y `/paso` conservan la observación/decisión del mundo legacy preparado, sin impulsar una ronda global.

## Implementación

`internal/sessions` encapsula gestión, temporización, autorización, idempotencia, límites y limpieza. Cada ejecución contiene su aplicación de motor, PRNG, agentes, amenazas, ocupación/reservas, overlays, planificador y métricas. El catálogo entrega una copia defensiva de la topología al preparar cada instancia; el almacén la reutiliza para lectura entre turnos. Los refugios y el estado mutable son propios de cada ejecución. `Store.LoadCompact` evita copiar la topología en cada snapshot. Los sleepers dormidos y el PRNG permanecen privados.

El manager reserva capacidad antes de preparar el motor y serializa cada turno con los controles de esa instancia. Publica snapshots completos y versionados, con bloqueos de alcance reducido. El reloj inyectable permite probar transiciones y TTL sin esperar minutos. El motor conserva el camino de decisiones mediante `/paso` HTTP autenticado en un listener privado; el navegador no posee esa credencial.

La máquina de estados usa `RUNNING → PAUSED → RUNNING → COMPLETED`, además de `CANCELLED` y `FAILED`. `CREATED` es transitorio. La pausa conserva turno y estado; la reanudación continúa el mismo mundo. Cancelar libera el motor y conserva su último resultado. Los controles repetidos compatibles no crean nuevos bucles. Una sesión terminal no se reanuda. Reiniciar una sesión terminal crea otro ID y otro token con la misma configuración/semilla, sujeta a los cupos; la anterior se conserva hasta caducar.

La semilla y el orden determinista de actualización no dependen del polling. La selección alternativa de refugios excluye los mismos nodos de aparición del grafo original para conservar la población inicial en comparaciones. Los parámetros de amenaza y las reglas históricas se reutilizan; los resultados anteriores y el motor congelado FASE 1 permanecen conservados.

`BASE` es el operativo de 300 nodos / 383 aristas y conserva prioridad. `FULL_MANTA` es el maestro experimental de 9.179 / 13.452; requiere habilitación y tiene su propio cupo. Se mantienen los perfiles intermedios del catálogo histórico sin añadirlos al selector de sesiones.

## Contrato y seguridad

La [guía de contratos](contratos.md) documenta rutas, DTO, autenticación, errores y comandos reproducibles. OpenAPI pasa de 34 a 44 paths y de 78 a 91 schemas: nueve rutas de sesiones, una de métricas y trece esquemas. Se conservan semánticamente los paths/esquemas existentes y se amplía el enum común de errores con `EXPIRED` y `RATE_LIMITED`. TypeScript y JSON Schema se generan desde YAML; Dart no incorpora nuevas rutas ni cambia sus modelos.

Cada sesión recibe un token opaco criptográfico de 256 bits, independiente del ID. El backend comprueba su hash con comparación de tiempo constante. La credencial sólo se devuelve en creación, reinicio o replay autorizado por su clave idempotente. Todos los GET privados y controles requieren Bearer; el ID por sí solo no autoriza. No se aceptan tokens en query strings. Las claves administrativas permanecen fuera de React.

La creación exige `Idempotency-Key`; una reserva pendiente serializa los reintentos concurrentes. Repetir la misma solicitud devuelve el mismo ID/token y cambiarla con la misma clave devuelve `409`. Las solicitudes tienen tamaño acotado, JSON cerrado, tipos/rangos/refugios validados, límites de frecuencia, CORS explícito y cupos de memoria/ejecución. La identidad para el límite no confía en cabeceras reenviadas arbitrarias. Los logs de ciclo de vida incluyen ID/escenario/grafo/estado/turno, sin tokens; `/metrics` agrega conteos y tiempos sin etiquetar cada simulación.

## Recursos y operación

| Variable | Valor inicial |
| --- | --- |
| `SIM_AUTOSTART` | `false` |
| `SIM_MAX_ACTIVE` / `SIM_MAX_FULL_ACTIVE` | `2` / `1` |
| `SIM_MAX_RETAINED` | `8` |
| `SIM_MAX_MEMORY_MB` | `128` |
| `SIM_DEFAULT_TICK_INTERVAL` / `SIM_DEFAULT_MAX_TICKS` | `2s` / `150` |
| `SIM_IDLE_TTL` / `SIM_PAUSED_TTL` | `2m` / `5m` |
| `SIM_COMPLETED_TTL` / `SIM_MAX_WALL_TIME` | `15m` / `15m` |
| `SIM_RATE_LIMIT_PER_MINUTE` / `SIM_CREATE_LIMIT_PER_MINUTE` | `120` / `10` |
| `ENABLE_FULL_MODE` | `false` |

Son valores iniciales del servicio, no una certificación de capacidad de EC2. Las sesiones pausadas retienen cupo; un visitante que deja de consultar acaba cancelado por abandono. La pausa tiene TTL absoluto y consultar no lo extiende. El tiempo máximo de pared limita tanto la ejecución como las pausas. Los resultados terminales caducan aunque se consulten. El barrido se ejecuta cada segundo y la autorización reconoce la caducidad inmediatamente. Un tombstone acotado permite `410` autenticado antes de retirar por completo el ID y devolver `404`.

La memoria se controla con reservas conservadoras por perfil y un máximo de sesiones totales, incluyendo resultados. La reserva es una estimación, no una medición RSS ni un límite del kernel. Al terminar se cierran listeners/cachés/motores y se conserva sólo el snapshot observable. El shutdown cancela y espera goroutines. No se añadieron Redis, bases de datos, colas, WebSockets ni infraestructura distribuida. El estado vive en un único proceso y se pierde al reiniciarlo.

Para reproducir localmente, establecer `API_KEY` privada fuera del repositorio, exportar las variables de [backend.env.example](../deploy/backend.env.example) y ejecutar `npm run dev:backend` y `npm run dev:web`. Los comandos HTTP privados están en la guía. La configuración Docker/AWS mantiene la misma arquitectura y deshabilita autostart; no se afirma que producción ya ejecute esta versión.

## React y separación de datos

El formulario ofrece escenario, perfil, semilla, población, ronda/refugios y lluvia sintética cuando corresponde. La página representa estado, turno, progreso, métricas y controles a partir de Go. `sessionStorage` separa las credenciales por pestaña; la recuperación consulta el ID existente y no vuelve a crear. `404/410` limpian la referencia obsoleta. Los fallos de red conservan el último snapshot, muestran el aviso y reintentan sin crear otra ejecución. El grafo estático se solicita aparte; el backend permite `ETag/304`, aunque el adaptador React actual consulta JSON completo y todavía no envía `If-None-Match`.

Los resultados reutilizan población inicial, evacuados, mordidos, activos, tasa de supervivencia y refugios ocupados; inundaciones añade sus indicadores de exposición, vías y evacuación existentes. La tasa de supervivencia incluye agentes todavía activos, por lo que no equivale a la tasa de evacuación. Reiniciar permite comparar resultados retenidos; esta fase prioriza el ejecutor y no añade un dashboard analítico complejo.

Los reportes ciudadanos Flutter y la copia de fuentes oficiales conservan sus servicios, procedencia y almacenamiento independientes del estado sintético de una sesión. No se incorporan automáticamente a las nuevas sesiones ni se sobrescriben al reiniciar/cancelar. El laboratorio anterior conserva sus combinaciones explícitas y snapshots congelados. No se modifican los flujos Flutter de reportes y observación.

Una integración futura de sesiones en Flutter puede consumir las mismas rutas y DTO con un repositorio propio, conservar su credencial privada y observar snapshots sin mover agentes. Esta fase no incorpora ese flujo a Flutter ni mezcla su identidad de reportes con los tokens de simulación.

## Verificación y mediciones

La suite nueva `npm run test:contracts:simulations` construye el servidor Go y pasó **493 aserciones** mediante HTTP real con JSON Schema generado. Comprueba arranque y GET sin simulación, credenciales privadas, creación/replay concurrentes, conflictos, configuración inválida, dos sesiones independientes, pausa sin avance, reanudación, cancelación, resultados, reinicio reproducible, ETag autorizado, motor real de inundación y TTL. También valida CORS, el maestro habilitado y su cupo, coexistencia BASE/FULL, rechazo por memoria/retención, métricas sin IDs y rate limiting pese a variar `X-Forwarded-For`. El número de aserciones depende de los polls necesarios para completar; las condiciones verificadas son las mismas. Los tokens aleatorios permanecen fuera de los reportes y se comprueba que no aparezcan en logs.

`npm run test:simulations:browser` verificó React → Go real en dos contextos independientes: carga sin ejecución, doble clic único, credenciales cruzadas rechazadas, capacidad agotada, pausa/recarga/reanudación, poblaciones independientes de 20 y cinco agentes, finalización con el navegador cerrado y limpieza de credenciales después de reiniciar el servidor.

| Validación ejecutada | Resultado |
| --- | --- |
| `npm run check` | OpenAPI, generación, TypeScript y lint correctos |
| `npm test` | **80** pruebas React y **40** del servicio histórico aprobadas |
| Go completo, race, vet y build | **282** pruebas incluyendo subcasos; **18** paquetes, todos correctos |
| Playwright desktop/móvil | **12/12** aprobadas |
| Contratos HTTP históricos `--flutter --browser` | Go real, integración Dart y mapa React/móvil correctos |
| Flutter analyze, unitarias y APK debug | Analyze correcto, **23** aprobadas, dos integraciones condicionadas omitidas en suite normal; APK construido |
| Datos geográficos Python | **10** aprobadas |
| Laboratorio FASE 4B | **13** comprobaciones reales aprobadas desde `/flood-lab` |
| Integración incidentes FASE 4C | Flutter → Go → persistencia/reinicio → React correcta |
| Referencias offline FASE 4D | **10** comprobaciones reales aprobadas |
| Imagen Docker final | Build correcto: `corodev-evacuation:phase5-local` |
| Ejecución Docker limitada localmente | 2 CPU / 1 GiB, BASE zombie + FULL inundación simultáneas, 200 agentes por sesión, dos turnos completos y cero timeouts; tercera creación rechazada con `503`; healthcheck correcto |

Las pruebas Go del manager usan reloj controlado y verifican aislamiento, estados, límites y limpieza concurrentes. Sus **11** pruebas principales / **18** con subcasos incluyen pausa a mitad de intervalo, determinismo en ambos motores, veinte carreras entre TTL y liberación, errores del motor y cierre sin goroutines residuales. El paquete pasó además cinco repeticiones consecutivas con `-race` tras los últimos cambios; la suite completa pasó el detector de carreras y se repitieron los paquetes de control, mundo y servidor afectados.

Los benchmarks nuevos se ejecutaron en Linux amd64, Intel i7-1255U, GOMAXPROCS=12, con **200 agentes**, 16 workers y predicción habilitada, ambos motores y el mismo adaptador de turnos que realiza decisiones HTTP autenticadas en loopback. Creación y obtención del snapshot miden métodos Go del manager; no incluyen transporte público ni serialización JSON. Cada caso se midió con `-benchtime=3x -count=1`: son tres operaciones de exploración, sin percentiles ni garantía de capacidad sostenida.

| Operación | BASE | FULL_MANTA |
| --- | ---: | ---: |
| Crear sesión zombie | 19,773 ms | 529,599 ms |
| Snapshot zombie | 12,376 µs | 33,171 µs |
| Snapshot inundación | 49,534 µs | 81,908 µs |
| Turno zombie | 28,035 ms | 552,196 ms |
| Turno inundación | 56,861 ms | 564,149 ms |
| Heap del proceso tras tres turnos zombie | 14.020.856 B | 55.014.152 B |
| Heap del proceso tras tres turnos inundación | 26.683.336 B | 85.705.832 B |

Crear una sesión asignó 6.464.416 B/op en BASE y 145.060.050 B/op en FULL; son asignaciones acumuladas, no memoria retenida. Los snapshots asignaron 49.096/176.776 B/op en zombie y 187.136/549.928 B/op en inundación. El heap incluye catálogo y proceso, no equivale a RSS ni a memoria incremental por sesión. Durante el motor activo se observaron entre 48 y 57 goroutines adicionales asociadas a conexiones HTTP persistentes; la prueba de cierre comprueba el regreso al nivel previo. Son recursos transitorios del motor activo, no una medición de fugas. Las sesiones terminales liberan el motor y sus conexiones antes de reservar un reinicio.

Los tiempos de turnos miden duración de la operación; no son un perfil de CPU ni latencia HTTPS de AWS. La duración mayor del maestro y el costo inicial de sus copias justifican mantenerlo deshabilitado por defecto, experimental y limitado a una ejecución. No se atribuye a la EC2 objetivo el rendimiento del portátil.

El benchmark histórico de `/paso` se repitió con 10.000 solicitudes HTTP reales, concurrencia 16 y 200 sobrevivientes en BASE, GOMAXPROCS=12: disponibilidad 100%, cero inválidas/timeouts, p50 **0,775 ms**, p95 **2,109 ms**, p99 **3,224 ms** y máximo **8,427 ms**. El lote duró 610,095 ms en ese equipo local; no representa una prueba HTTPS de la EC2.

Se repitió el binario de benchmarks con **GOMAXPROCS=2**, 16 workers, predicción y 200 agentes, excluyendo la compilación. `os.wait4` midió 19,420 s de pared, 15,885 s de CPU de usuario, 0,401 s de sistema, CPU media 83,9% y RSS máximo **141.704 KiB**. Ese consumo corresponde a todo el proceso de pruebas, incluidos catálogo, preparación y orquestación; no mide CPU estable de una sesión ni memoria aislada de un turno. La creación obtuvo 21,340/535,906 ms BASE/FULL; los turnos zombie 30,311/694,462 ms y los de inundación 52,421/698,142 ms. La variación de las muestras pequeñas y el host compartido impiden convertir estos datos en un SLA o atribuirlos a una EC2. La reserva de memoria del manager no pretende ser un límite RSS del sistema operativo.

La imagen final se ejecutó además con filesystem de sólo lectura, sin capabilities, límite de 256 tareas, 2 CPU y 1 GiB. Completó simultáneamente una sesión zombie BASE y una inundación FULL_MANTA, ambas de 200 agentes y dos turnos, sin timeouts. Rechazó una tercera con `503`, dejó `/estado` en turno 0 y pasó el healthcheck compilado. Una muestra posterior a la finalización indicó **129,5 MiB** y ocho tareas; no es el pico de memoria ni una validación de carga sostenida. El contenedor de prueba se detuvo y eliminó al terminar. No se modificaron contenedores de AWS.

Las capturas locales de exploración, pausa y resultados móviles están en `deploy/evidence-private/phase5-20261027`, excluido de Git. Los reportes de benchmarks están en `services/evacuation/reports/phase5`, también excluido. La revisión visual y la comprobación automática de ancho móvil conservaron el mapa, la estética y los controles accesibles.

Reproducción desde la raíz:

```sh
node tools/scripts/go.mjs test ./internal/sessions -run '^$' \
  -bench BenchmarkSession -benchtime=3x -count=1
```

Desde la raíz se reproducen los controles centrales con:

```sh
npm run check
npm test
npm run build:web
npm run test:backend
npm run test:race
npm run test:contracts:simulations
npm run test:simulations:browser
npm run test:e2e
```

## Archivos principales

- Backend: `services/evacuation/internal/sessions/{models,options,manager,lifecycle,http}.go`, sus pruebas y benchmarks; composición en `cmd/server` y cambios acotados de snapshots/configuración en `world`, `simulation`, `application` y `httpapi`.
- React: `apps/web/src/features/Escape.tsx`, adaptadores `services/{api,simulation}.ts`, navegación, estilos y pruebas de sesiones.
- Contratos: `packages/contracts/openapi.yaml`, modelos TypeScript/JSON Schema generados y ejemplos de creación zombie/inundación.
- Operación y QA: variables de ejemplo, scripts de desarrollo, checkers de contratos/navegador, documentación de arquitectura y esta entrega.

## Commits de implementación

- `9bf3930`: contrato versionado, modelos generados y ejemplos de sesiones.
- `8db2a68`: formulario, recuperación, controles, mapas y pruebas React.
- `af05337`: manager Go, aislamiento, lifecycle, seguridad, cuotas y benchmarks.
- `0d2b0ac`: integración HTTP/navegador y compatibilidad con clientes anteriores.

La documentación y los valores operativos se guardan en un commit posterior de esta misma entrega. No se hizo push ni se reescribió el historial.

## Límites

Los índices de inundación son sintéticos y no describen profundidades, pronósticos ni rutas certificadas. Los datos oficiales del laboratorio mantienen sus limitaciones geográficas y temporales previas. FULL_MANTA sigue siendo experimental y sus tiempos no se equiparan al operativo. El gestor de una sola instancia no ofrece recuperación persistente, coordinación multinodo ni credenciales duraderas. `sessionStorage` permite recuperar una pestaña, con la exposición habitual a XSS de su JavaScript. Los resultados y tombstones están acotados y no constituyen un archivo histórico permanente.

No se realizaron pruebas de carga sobre AWS público. La aceptación de la infraestructura objetivo debe basarse en mediciones de esa instancia y un despliegue autorizado; no se deduce de los tiempos locales.
