# CoroDev — Escape de Manta Zombie

## Objective and boundaries
Implement the authorized Track A FASE 2: audit the original graph and survival, acquire urban Manta as geographic master, separate four origin zones from navigation, improve deterministic routing/prediction/capacity, compare reproducibly and prepare AWS artifacts. Preserve FASE 1 reports, graph and frozen evaluation engine; distinguish geographic effects from algorithmic changes. Preserve clients, demo API and Mock/HTTP flows. Never initialize Git, fabricate history or add credentials. Deployment requires an authorized region/account and actual access; otherwise complete local artifacts and state the limitation. Do not start FASE 3 automatically.

## Architecture and sources of truth
`packages/contracts/openapi.yaml` owns HTTP schemas and operations. `packages/design-tokens/tokens.json` owns visual tokens; `packages/design-tokens/brand.json` owns shared identity and global copy. Generate derived TypeScript, Dart and CSS; never hand-edit generated files. Repositories translate HTTP into presentation state. Widgets and components must not contain fixture repositories.

`services/evacuation` owns authoritative state in one process. Only the simulator mutates that state. Decision engines and public clients receive observable immutable snapshots; sleeping zombies and PRNG state stay private. `/paso` must retain the exact Spanish contract and permit only one transitable neighbor or waiting. Simulator integration must exercise real authenticated HTTP. OSM import runs offline from checked-in source; never invent geography. Read `services/evacuation/AGENTS.md` before backend changes.

## Conventions
Use strict TypeScript, Flutter Material 3, accessible labels, explicit loading/empty/error states, and concise Spanish documentation. Keep dependencies stable and compatible with the installed runtimes. Pin reproducible dependency resolutions in lockfiles. No secrets in frontend environment variables or logging. Validate all external input and preserve the common error envelope and request ID.

## Workflow
Read the relevant scoped AGENTS.md. Change the contract or tokens first when applicable, regenerate, then update repositories and UI. Coordinate exclusive file ownership when delegating. Root orchestrator owns integration and root tooling; scoped agents own their assigned directories. No simultaneous edits to another agent's files. Describe real check results and limitations. Keep documentation consistent with implemented behavior.

## Validation and completion
From the root run `npm install`, `npm run contracts:validate`, `npm run contracts:generate`, `npm run tokens:generate`, `npm run check`, `npm test`, and `npm run build:web`. Run `npm run mobile:check`, `npm run mobile:test`, and `npm run mobile:build` with Flutter on PATH. Generated consistency checks must pass. Completion requires both clients using the same HTTP contract, usable navigation and forms, documented AWS integration, executed available tests, and explicit reporting of any remaining limitation. Do not claim a build or test passed without executing it.

For Track A also run `npm run test:backend`, `npm run test:race`, `npm run build:backend`, `npm run graph:test`, and `npm run test:contracts:http`. Measure full scenarios and `npm run bench:backend` before reporting latency targets. Keep measured reports separate from deterministic assertions: timing varies; identical seeds must reproduce world outcomes. Do not infer official zombie counts or shelter locations from our editable scenarios.

## Estado autorizado posterior
FASE 3B.1 retiró la dependencia del servidor de demostración en React y Flutter; no restaurar sus pantallas, modos o adaptadores. FASE 3B.2 autoriza catálogo multigrafo, selección React y administración autenticada entre rondas. El preset de 300 nodos conserva prioridad; no exigir al maestro experimental el mismo rendimiento ni alterar reglas para favorecerlo. No desplegar intervenciones que interrumpan la instancia sin aprobación expresa. Conservar reportes FASE 2 y los motores originales.

## FASE 5 autorizada

`cmd/server` prepara la API sin ejecutar turnos; `SIM_AUTOSTART=true` es inválido. `internal/sessions` coordina ejecuciones bajo demanda con estado, capacidad, caducidad y credenciales independientes. Cada instancia conserva un único escritor del motor, RNG y overlays propios; nunca publicar secretos, sleepers dormidos ni topología repetida en polling. La misma configuración, grafo y semilla deben producir el mismo resultado lógico, también al pausar/reanudar. Los tiempos HTTP no forman parte de la comparación determinista.

React `/escape` explora el grafo y consulta capacidades antes del inicio explícito. Recuperar una credencial de sesión desde `sessionStorage` sólo observa su ejecución existente. El token opaco de una simulación es la única excepción al almacenamiento de credenciales en el navegador; jamás almacenar claves administrativas o de `/paso`. Flutter y `/estado` conservan su runtime legacy aislado e inactivo. El laboratorio de inundaciones mantiene su API y su almacenamiento ciudadano independientes.

Los grafos públicos son BASE y FULL_MANTA; FULL_MANTA sigue experimental y depende de habilitación explícita. Los límites abarcan ejecuciones y sesiones retenidas. Ejecutar también `npm run test:contracts:simulations` y los tests de sesiones con race detector. No hacer push ni desplegar esta fase sin autorización explícita.

## FASE 7 autorizada

Las políticas `classic_random`, `correlated_random_walk` y `adaptive_exploration` son entradas inmutables por ejecución. Classic preserva su consumo RNG histórico. `legacy_current` sigue predeterminado; `baseline_shortest_path`, `dynamic_risk_astar` y `predictive_temporal_astar` son alternativas comparables. No promover una alternativa por sofisticación: conservar regresiones medidas. Las cachés y memoria pertenecen a una sesión. No modificar el evaluador FASE 1.

Modo `official`: BASE, classic, población de ronda, refugios originales, 150 turnos/2000 ms, sin flota. Las políticas persistentes y flota son experimentales. Cinco vehículos/capacidad cuatro, hasta dos aristas reales por turno; pasajeros sólo evacuados tras entrega. Pasajeros permanecen observables como presas, fuera del movimiento peatonal; `/paso` devuelve espera para ellos. Reservas se validan atómicamente y no se inventan destinos.

Pronóstico usa sólo observaciones; probabilidades no calibradas, sin sleepers ni futuro privado. `runner_forecast` no repite topología. El laboratorio React sólo inicia al pulsar comparar/repetir; sesiones independientes secuenciales, exports sin tokens. `npm run compare:agents` ejecuta rondas completas aceleradas por HTTP real; `--realtime` añade ritmo nominal. No confundir tiempos medidos con determinismo ni `GOMAXPROCS=2` con EC2 2 vCPU/8 GiB. Ver `docs/informe-fase7.md`. No hacer push ni desplegar sin autorización expresa.
