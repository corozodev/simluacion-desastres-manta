# CoroDev — instrucciones de mantenimiento

## Alcance y fuentes

MantaSim / Escape de Manta Zombie: Track A BASE + PRO experimental y laboratorio hidráulico FASE 8. La consolidación final autoriza documentación, automatización local y correcciones acotadas; no rediseñar el motor ni iniciar nuevas fases. Conservar informes históricos, grafos originales y `internal/evaluation/phase1` congelado. Nunca inicializar Git, falsificar historial, crear commits, hacer push o desplegar sin autorización expresa. No destruir datos/volúmenes ni interrumpir la instancia publicada.

Leer el AGENTS del ámbito antes de editar. Fuentes actuales: [índice](docs/INDEX.md), [arquitectura](docs/arquitectura.md), [contratos](docs/contratos.md), [pruebas](docs/pruebas.md), [PRO](docs/nivel-pro.md), [AWS](docs/despliegue.md). Los informes FASE 1–8 registran historia y no sustituyen el comportamiento vigente.

- `packages/contracts/openapi.yaml` posee HTTP. Cambiar primero y regenerar TypeScript, Dart y JSON Schema; nunca editar derivados.
- `packages/design-tokens/tokens.json` y `brand.json` poseen diseño/identidad. Regenerar CSS, TS y Dart.
- React: `apps/web/src/app`, `features`, adaptador `services/api.ts`; TanStack Query. Flutter Android: `apps/mobile`, Material 3/Riverpod/Dio; repositorios traducen HTTP. Fixtures sólo en pruebas.
- Go: `services/evacuation/cmd/server`, `cmd/flood-lab`; monolito modular estándar, sin servicios externos de decisión. Mock Fastify aislado para compatibilidad; no restaurar pantallas/adaptadores demo.
- OSM se importa offline de fuentes versionadas; no inventar geografía. BASE 300/383 tiene prioridad; FULL_MANTA 9.179/13.452 requiere habilitación explícita, sin exigirle rendimiento de BASE.

## Motor y API

Sólo el simulador escribe estado autoritativo; decisiones/clientes reciben snapshots observables inmutables. No publicar PRNG, sleepers dormidos, claves ni diagnósticos privados. `/paso` conserva contrato español exacto, lectura sin reservas y espera o un vecino transitable. Integración por HTTP real autenticado: fallos/timeout producen espera. Solicitudes concurrentes no alteran el orden lógico.

`cmd/server` arranca sin turnos; `SIM_AUTOSTART=true` inválido. `internal/sessions` aísla motor/RNG/overlays/cachés, token opaco, capacidad y TTL por ejecución. Crear/reiniciar exige `Idempotency-Key`. Cupos incluyen pausadas, FULL, memoria estimada y sesiones retenidas. Finales compactos en RAM. Legacy `/estado` queda aislado e inactivo; no mezclarlo con una sesión. No repetir topología en polling.

React `/escape` explora grafo/capacidades antes del inicio explícito. Recuperar `sessionStorage` sólo observa la ejecución existente. El token opaco de simulación es la única excepción a credenciales de navegador: jamás claves administrativas o de `/paso`, URLs/logs/localStorage/VITE. Montar una página no inicia simulaciones.

Flutter Android y React `/mobile` son espectadores: `GET /v1/simulations/published/{scenario}` y `GET /lab/published`; no crean/controlan motores ni renuevan leases. Cachear JSON por versión y geografía por separado. Inicio/acciones/validación/comparación del laboratorio son públicos, con Origin/Host, cupos, exclusión y `expected_run_id`. Moderación y referencias conservan autenticación. Reportes nuevos quedan pendientes y no alteran motores automáticamente; no mostrar cierres sintéticos como hechos reales.

## BASE, PRO e inundación

`official`: BASE, `classic_random`, población 20/80/200 por ronda, refugios originales, 150 turnos/2.000 ms, sin flota. `legacy_current` predeterminado; `baseline_shortest_path`, `dynamic_risk_astar`, `predictive_temporal_astar` son alternativas comparables. Políticas `classic_random`, `correlated_random_walk`, `adaptive_exploration` inmutables por ejecución; preservar consumo RNG classic y regresiones medidas.

PRO experimental: cinco vehículos de cuatro plazas, hasta dos aristas reales/turno (no afirmar doble m/s). Pasajeros observables como presas, fuera del movimiento peatonal; `/paso` devuelve espera. Evacuados sólo tras entrega. Reservas validadas atómicamente; no inventar destinos. Pronóstico sólo de observaciones, sin futuro privado; probabilidades no calibradas y `runner_forecast` sin topología. No recuperar comparador A/B zombie ni paneles retirados. Ver [informe FASE 7](docs/informe-fase7.md).

Inundación: `rainfall_runoff_2d` predeterminado, `compound_flood_2d` añade mar/cauce. No conservar runtime radial. Malla conservativa separada del grafo; relieve/costa/lluvia sintéticos identificados, susceptibilidad oficial sólo contexto. Mantener `storm|constant|pulse`, `preventive|late|adaptive`. `internal/runlimits`: 30–3.000 turnos, default150; official estricto150/2.000ms. No terminar por agentes terminales. Separar tiempo hidrológico, evacuación y reproducción; métricas acotadas sin mapas completos por turno. Ver [informe FASE 8](docs/informe-fase8.md).

## Desarrollo y verificación

Raíz: `make help`, `make setup`, `make dev`, `make stop`, `make smoke`, `make test`, `make verify`. Node≥22.12/npm≥10, Go≥1.23, Python3; Flutter opcional para web. `GO_BIN`/`FLUTTER_BIN` seleccionan herramientas. Sin rutas personales absolutas en procedimientos. Reutilizar scripts, sin infraestructura local paralela.

Validación integrada: `npm install`, `contracts:validate`, `contracts:generate`, `tokens:generate`, `check`, `test`, `build:web`; `test:backend`, `test:race`, `build:backend`, `graph:test`, `test:contracts:http`, `test:contracts:simulations`, `test:contracts:flood`, `test:spectators:http`, `test:spectators:browser`, laboratorio/visores y `docs:check`. Go: `go vet ./...`, gofmt. Flutter en PATH: `mobile:check`, `mobile:test`, `mobile:build` e integración publicados `npm run test:spectators:http -- --flutter`. No construir Flutter Web ni inventar enlaces APK.

Medir rondas completas, `bench:backend` y `bench:hydrology` antes de atribuir latencia/capacidad. `compare:agents` usa HTTP real acelerado; `--realtime` añade ritmo nominal. Igual semilla/config/grafo reproduce resultados lógicos, excluyendo tiempos HTTP. `GOMAXPROCS=2` no acredita EC2 2vCPU/8GiB. No afirmar Safari/dispositivo físico sin pruebas. No inferir cantidades oficiales zombie/refugios de fixtures editables.

## Convenciones y seguridad

TypeScript estricto, español conciso, navegación accesible y estados carga/vacío/error. Mantener dependencias/lockfiles. Validar entradas externas y sobre común/requestId. Nunca secretos en frontend, ejemplos, logs o artefactos públicos; `.env`, `.local`, `private`, `reports` y evidencia privada ignorados. Revisar captura Budget auténtica antes de publicación manual.

Inspeccionar `git status`, conservar trabajo ajeno. Delegar sólo con autorización y propiedad exclusiva; raíz integra tooling. Una fuente documental por tema, enlaces relativos comprobados, conservar ADR/informes. Reportar comandos ejecutados, fallos y omisiones; ausencia de evidencia no significa cumplimiento. AWS necesita cuenta/región/acceso autorizados; sin ellos terminar artefactos locales y declarar límite. No cargar producción para medir sin permiso.
