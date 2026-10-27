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
