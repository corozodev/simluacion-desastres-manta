# Backend Track A

Lee el AGENTS raíz. Estado vigente: sesiones FASE 5, políticas/PRO FASE 7 y malla hidráulica FASE 8. Las secciones por fase conservan restricciones históricas; el alcance posterior explícito prevalece. Biblioteca estándar Go, sin servicios externos de decisión. Despliegue sólo con autorización expresa, cuenta, región y acceso verificados.

`internal/world` define modelos y snapshots observables. OpenAPI sigue siendo la fuente de verdad del JSON; cualquier cambio de transporte comienza allí y regenera TypeScript, Dart y JSON Schema. `graph` valida/carga datos; `simulation` es el único escritor; `decision` solo observa; `httpapi` autentica y valida consultas; `application` y `cmd` componen el proceso y HTTP real.

Nunca publicar sleepers dormidos, estado de PRNG ni credenciales. No modificar el mundo desde `/paso`. Toda arista debe existir, ser vecina y transitable, o se conserva el nodo actual. Las goroutines de solicitudes no alteran el orden determinista de resultados. Los fallos y solicitudes de más de 500 ms producen espera.

`data/manta.json` y `manta-v1.*` son históricos y deben permanecer intactos. `tools/geo/urban_manta.py` genera maestro urbano, operativo `manta-v2` (~300 nodos) y experimental ampliado; conservar caché, geometría, checksum y procedencia. No contraer intersecciones reales como un movimiento. Las cuatro zonas son orígenes, no fronteras de navegación. Las fixtures sintéticas pertenecen a pruebas; los refugios son ficticios sobre nodos reales.

El planificador global prepara destinos/reservas antes de publicar. Las consultas HTTP leen el plan coherente y no reservan plazas. `internal/evaluation/phase1` está congelado para comparación, no es una estrategia de producción alternativa. Los diagnósticos privados pueden incluir posiciones de sleepers iniciales y jamás deben servirse desde endpoints, S3 público o clientes. Aislar cambios de mapa/refugios/aparición frente a cambios algorítmicos y publicar también regresiones.

Ejecutar desde aquí `go test ./...`, `go test -race ./...`, `go vet ./...` y `go build ./...`; desde la raíz existen scripts npm equivalentes. Formatear Go. Las pruebas de integración deben usar HTTP con `x-api-key`; no sustituirlas por llamadas directas. No comparar percentiles para verificar determinismo. Documentar reglas ambiguas en `docs/reglas-simulacion.md` y limitaciones de rutas en `docs/algoritmo.md`.

## FASE 3B.2 autorizada
El catálogo aprobado distingue competition (300/383), full (9179/13452) y expanded (1000/1599). Competición conserva los escenarios originales. No cambiar `/paso`, geografía fuente, reglas zombie ni algoritmos al modificar el control. `internal/control` serializa rondas, autentica operador con una credencial independiente y conserva diez finales observables en RAM. Los experimentales están deshabilitados por defecto; no habilitarlos en producción si fallan las mediciones. Despliegues que interrumpan la instancia requieren autorización expresa del propietario.

## FASE 5 autorizada
`internal/sessions` controla las ejecuciones públicas independientes de zombies e inundación sintética en `/v1/simulations`. El proceso nunca inicia turnos automáticamente; `SIM_AUTOSTART=true` se rechaza. El runtime legacy de `internal/control` permanece aislado y en reposo; `cmd/server` deshabilita su inicio administrativo con 409 para que no eluda los cupos globales del ejecutor público. El paquete de control conserva el inicio explícito para herramientas aisladas. Cada sesión usa su propio simulador, RNG, planificador, overlays y servidor HTTP loopback autenticado; el único escritor avanza turnos serializados con pausa/reanudación/cancelación. Los tokens opacos son independientes del ID y de las credenciales administrativas; nunca registrarlos ni incluirlos en URLs. Crear y reiniciar requieren `Idempotency-Key`.

Aplicar cupos de ejecuciones (incluidas pausadas), FULL, sesiones retenidas y memoria estimada antes de construir motores. Conservar solo snapshots compactos al finalizar y expirar sesiones con reloj inyectable. La topología del Store se copia una vez por grafo y se comparte únicamente con observadores internos de solo lectura; `Load` sigue devolviendo una copia defensiva y `LoadCompact` excluye geografía. Los refugios seleccionados no alteran las exclusiones de spawn iniciales del grafo original, para comparar poblaciones con la misma semilla. FULL solo se anuncia disponible cuando el catálogo y sus cupos lo permiten. Las métricas agregadas de `/metrics` no usan IDs como etiquetas. Medir BASE/FULL localmente sin atribuir los resultados a EC2.

## FASE 7 autorizada

Las políticas `classic_random`, `correlated_random_walk` y `adaptive_exploration` son entradas inmutables por ejecución. Classic preserva su consumo RNG histórico. `legacy_current` sigue predeterminado; `baseline_shortest_path`, `dynamic_risk_astar` y `predictive_temporal_astar` son alternativas comparables. No promover una alternativa por sofisticación: conservar regresiones medidas. Las cachés y memoria pertenecen a una sesión. No modificar el evaluador FASE 1.

Modo `official`: BASE, classic, población de ronda, refugios originales, 150 turnos/2000 ms, sin flota. Las políticas persistentes y flota son experimentales. Cinco vehículos/capacidad cuatro, hasta dos aristas reales por turno; pasajeros sólo evacuados tras entrega. Pasajeros permanecen observables como presas, fuera del movimiento peatonal; `/paso` devuelve espera para ellos. Reservas se validan atómicamente y no se inventan destinos.

Pronóstico usa sólo observaciones; probabilidades no calibradas, sin sleepers ni futuro privado. `runner_forecast` no repite topología. El laboratorio React sólo inicia al pulsar comparar/repetir; sesiones independientes secuenciales, exports sin tokens. `npm run compare:agents` ejecuta rondas completas aceleradas por HTTP real; `--realtime` añade ritmo nominal. No confundir tiempos medidos con determinismo ni `GOMAXPROCS=2` con EC2 2 vCPU/8 GiB. Ver `docs/informe-fase7.md`. No hacer push ni desplegar sin autorización expresa.

## Visores móviles compartidos autorizados

`GET /v1/simulations/published/{scenario}` observa la última ejecución creada
correctamente de cada escenario, sin credencial ni renovación del lease. La
referencia se cambia al confirmar creación; un replay idempotente no vuelve a
publicar ejecuciones antiguas. El snapshot compacto no repite geografía y se
serializa una vez por versión observable; ETag permite 304. Una sesión caducada
se anuncia `unavailable`, nunca se revive por espectadores. Los controles de
sesiones siguen usando su token privado.

El laboratorio conserva su motor independiente. `GET /lab/published` comparte
su ejecución actual sin timeline histórico ni comparación A/B; la geografía se
consulta por `run_id` con `/lab/graph`. `/lab/runs`, `/lab/actions`,
`/lab/candidates/validate` y `/lab/comparisons` ya no exigen operador ni CSRF.
Conservan validación estricta, comprobación de origen/host, `expected_run_id`,
serialización y límites de solicitudes. La moderación de incidentes, aplicación
experimental de novedades y actualización de referencias conservan autorización.
No introducir credenciales automáticas para sustituir el login retirado.
