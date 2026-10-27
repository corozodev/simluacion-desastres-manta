# Entrega FASE 4C — reportes ciudadanos georreferenciados

Validación local del **26 de octubre de 2026**, America/Guayaquil. El último checker comenzó a `2026-10-27T04:11:04.109Z`, aún esa fecha local. Evidencia consolidada: [`deploy/validation-phase4c.json`](../deploy/validation-phase4c.json). No se realizó push, despliegue AWS ni intervención en producción.

## Resultado de aceptación

Se ejecutó el recorrido real **Flutter → API Go → archivo persistente → reinicio Go → mapa React → aplicación autorizada en urban_flood → ruta recalculada**. La geometría pertenece al OSM revisado del repositorio; los agentes y la observación son de prueba. El endpoint ciudadano se ejercita como `citizen/pending`, sin atribuirlo a un ciudadano real ni usar GPS.

Caso final: semilla 42, competición 300/383, 20 agentes preventivos, lluvia constante de intensidad cero, pausa en paso 1. Flutter registró `e844bb5905a7b6b2c4a31c004f58cfd0`; Go devolvió 201, el reintento exacto 200 y la consulta posterior al reinicio recuperó el mismo registro.

| Observación | Antes | Después de aplicar desde React |
| --- | --- | --- |
| Ejecución | `be0aa7bab62a064526d45448fe5f0627` | Misma ejecución |
| Paso de simulación | 1 | **1**, sin mover agentes |
| Versión del mundo | 3 | **4** |
| Replanificaciones | 0 | **1** |
| Calle de la ruta de S-0004 | `E-352a14c06d34b4e3` transitable | **Bloqueada**, actualización en paso 1 |
| Primer tramo de ruta | `OSM-347399451 → OSM-8270336144` | `OSM-347399451 → OSM-12038298017 → OSM-8270336378 → OSM-8270336377` |
| Procedencia/estado del reporte | `citizen / pending` | **`citizen / pending`** |

El recibo `089087acd4a7e6ae1603f9efcc9d25de` registra reporte, ejecución, arista, paso 1, versión 4, fuente, estado al aplicar y caducidad simulada al comenzar paso 22: veinte pasos posteriores afectados. Repetir recuperó el recibo sin efectos extra. El grafo base y el proceso zombie se comprobaron iguales. Una ejecución nueva comenzó sin overlay y rechazó la aplicación con ID anterior.

El texto **Reporte ciudadano pendiente de verificación** se conserva en Flutter y React. Aplicar un reporte no lo promueve ni certifica una condición vial. El caso demuestra un desvío controlado; no mide exactitud de reportes, seguridad real, calidad hidrológica ni mejoras de latencia.

## Arquitectura y cambios

La auditoría encontró Dio/Riverpod/CustomPainter en Flutter, API estándar Go sin almacenamiento de dominio, contrato compartido generado, React con SVG/TanStack Query, y sesión local/Origin/CSRF en `floodlab`. Se reutilizan esas piezas sin añadir dependencias. El trabajo especializado de backend, Flutter y React comenzó después de definir el contrato, con archivos independientes.

- **Contrato:** siete paths y trece esquemas nuevos; preservación semántica de los 22 paths y 52 schemas previos, salvo `incident_applications` opcional en `LabState`. Generados TS/JSON Schema/Dart sincronizados. No cambia `/paso`.
- **Persistencia:** la [ADR-004](decisions/ADR-004-incidentes-persistencia.md), redactada antes de implementar, justifica snapshot JSON privado con un escritor, `flock`, reemplazo atómico y `fsync`. El acuse llega después del guardado. Corrupción/fallo de escritura cierran el servicio de incidentes, sin sustituir datos por un almacén vacío. No se crean servicios, discos, roles o buckets AWS.
- **Recepción:** DTO versionado, enums estrictos, coordenadas/área, tamaño/texto/fecha, frecuencia, claves de replay privadas, deduplicación básica y asociación a polilíneas reales. Una ambigüedad requiere elección de calle y se valida otra vez en Go. No hay fotografías ni identidad de reporteros en el DTO público.
- **Flutter:** Nueva novedad, marcador manual o coordenadas, GPS Android tras botón/permiso explícitos, calle candidata, revisión, confirmación, estado y reintento con el mismo cuerpo/clave. El borrador vive durante la sesión; los fallos de red no lo borran silenciosamente. No hay una nueva librería de mapas.
- **React:** capa independiente y marcadores accesibles; procedencia separada de revisión; filtros servidor por bbox, tipo, estado y antigüedad de recepción; detalle aproximado; polling de cinco segundos con claves estables; revisión protegida y dos pasos para aplicar. Respuestas tardías de otra ejecución no reinstalan su mundo.
- **Motor:** simulador único escritor, overlay por ejecución y recibo durable antes de mutar, sin avanzar turno ni PRNG. Combina cierre/precaución con base, lluvia y otros reportes; caducidad por pasos e idempotencia por reporte/ejecución. Se bloquea durante A/B y se rechazan caducados, rechazados, aristas incompatibles y escenarios zombie.

La [guía operativa](incidentes-ciudadanos.md) detalla todos los endpoints, parámetros, límites, permisos, costo/impacto y demostración manual/automática. El laboratorio tiene una ejecución compartida por Manager; las cookies locales no crean mundos independientes. La prueba de dos Managers verifica que aplicar a uno no modifica al otro aunque compartan reportes.

## Pruebas ejecutadas

| Comprobación | Resultado |
| --- | --- |
| `npm install` | Lockfiles conservados, cero vulnerabilidades informadas |
| OpenAPI, generación de contratos/tokens, `npm run check` | Correctos; generados sincronizados, TypeScript y ESLint limpios |
| Go completo `go test -count=1 -json ./...` | **158 pruebas principales / 252 con subcasos**, 15 paquetes con pruebas, cero fallos |
| Go `-race ./...`, `go vet ./...`, `go build ./...` | Correctos; tras el último ajuste de validación se repitió race de incidents/floodlab/simulation y vet/build completos |
| Nuevas pruebas Go | **13** principales: seis Store, cuatro floodlab HTTP/integración y tres simulator |
| `npm test` | React **49** (14 nuevas) y servicio histórico **40** aprobadas |
| `npm run build:web` | Correcto; chunk diferido flood 57,70 kB / 17,10 kB gzip |
| Flutter análisis y suite | Sin incidencias; **23** aprobadas (diez nuevas), dos integraciones condicionadas omitidas en la suite normal |
| Flutter APK debug | Construido: `apps/mobile/build/app/outputs/flutter-apk/app-debug.apk` |
| Integraciones Flutter habilitadas | Una observación zombie real y un registro/replay de incidente real, ambos aprobados |
| `npm run test:e2e` | Ocho regresiones zombie desktop/móvil aprobadas |
| `npm run graph:test` | Diez pruebas Python aprobadas |
| HTTP zombie e inundación 4A | Contratos contra Go real, incluyendo `/paso` autenticado, aprobados |
| `npm run test:lab:flood` | Trece comprobaciones reales 4B aprobadas: controles, refugios, evolución, A/B, maestro y retorno zombie |
| `npm run test:incidents:e2e` | Once comprobaciones reales 4C aprobadas; persiste/reinicia, muestra pendiente, filtra, aplica, desvía y aísla |
| `npm run dev:lab` | Tres servicios listos e incidentes habilitados, con directorio temporal aislado y cierre de procesos comprobados |

Se prueban coordenadas inválidas/lejos/ambiguas, enums/campos/tamaños, metadatos incompletos, rate limit, replay con conflicto, deduplicación, expiración/retención, filtros, revisión optimista, disco fallido, archivo corrupto y bloqueo de segundo escritor. Flutter cubre formulario, marcador, permiso denegado, red, doble toque y borrador conservado. React cubre estados, datos sintéticos, filtros, confirmación, autorización y ejecución obsoleta. Los escenarios existentes permanecen en las suites completas.

El checker 4B inicialmente buscó la etiqueta provisional `Incidentes (Fase 4C)`; se actualizó a `Novedades georreferenciadas` y su ejecución completa pasó. Se mantiene su prueba de las ocho capas y usa almacenamiento temporal propio. No se relajaron aserciones del producto.

El E2E final registró cero errores JS/consola/HTTP inesperados, cero fallos de conexión, cero filtraciones de credenciales de movimiento y cero solicitudes raster. Seis GET cancelados normalmente al cambiar de pantalla se conservan aparte como `net::ERR_ABORTED`. El viewport 390 px no tuvo desborde horizontal. No se ejecutó una prueba física nueva del diálogo GPS Android ni se afirma una.

## Evidencia visual y archivos

Capturas auténticas de React/Go, conservadas localmente fuera de Git y con hashes en la evidencia consolidada:

- [Reporte pendiente antes de aplicar](../deploy/evidence-private/phase4c-20261026/citizen-pending-before-application.png).
- [Ruta, métricas y auditoría tras aplicar](../deploy/evidence-private/phase4c-20261026/citizen-applied-route-and-audit.png).
- [Overlay y ruta sobre el mapa](../deploy/evidence-private/phase4c-20261026/incident-overlay-map.png).
- [Página móvil de 390 px](../deploy/evidence-private/phase4c-20261026/citizen-report-mobile-390.png).
- [Viewport del detalle móvil](../deploy/evidence-private/phase4c-20261026/citizen-detail-mobile-viewport-390.png).
- [Tarjeta del reporte móvil](../deploy/evidence-private/phase4c-20261026/citizen-detail-mobile-card-390.png).

Las capturas muestran vectores OSM reales; se deshabilitan teselas públicas en automatización. La prueba usa Dio/Flutter real con selección manual, no una interacción física en Android. El JSON público consolidado excluye claves de idempotencia, cookies y CSRF.

| Área | Archivos principales |
| --- | --- |
| Contratos | `packages/contracts/openapi.yaml`, `generated/{api.d.ts,schemas.json}`, `tools/codegen/contracts.mjs`, `apps/mobile/lib/core/api/generated/models.dart` |
| Backend | `internal/incidents/{models,store,snap,store_test}.go`, `internal/floodlab/incident_{http,manager,test}.go`, integración en `http.go`, `manager.go`, `models.go`, `cmd/flood-lab/main.go` |
| Motor | `services/evacuation/internal/simulation/{scenario,incidents,incidents_test}.go` |
| Flutter | `core/api/incident_repository.dart`, `core/location/device_location.dart`, `core/config/api_config.dart`, `features/incidents/*`, integración `features/escape/*`, manifest y `MainActivity.kt`, dos tests nuevos |
| React | `features/flood/{IncidentPanel,incidentPresentation,FloodLab,FloodMap,flood.css}`, `services/{api,queries}.ts`, `lib/config.ts`, `.env.example`, `tests/incidents.test.tsx` |
| QA y arranque | `tools/qa/check_incidents_lab.mjs`, `check_flood_lab.mjs`, `tools/scripts/dev_lab.mjs`, `package.json` |
| Documentación | README raíz/clientes, ADR-004, esta entrega, guía y `deploy/validation-phase4c.json` |

## Riesgos y pendientes

El directorio persistente resiste reinicio de proceso, no pérdida del disco. No hay HA ni respaldo automático; la EC2 actual necesita un montaje escribible y su volumen raíz tiene `DeleteOnTermination:true`. No se modificó ni desplegó la infraestructura. El uso del volumen existente consume espacio/I/O; no se promete alojamiento gratuito.

La sesión autoriza un laboratorio local compartido, sin identidad remota. La IP de conexión sólo se usa como hash efímero para frecuencia. Las coordenadas públicas están cuantizadas, pero la calle y el texto no son anónimos por garantía; no existe detector semántico de datos personales. Duplicar no corrobora; `verified` no cambia la fuente a `official`. El GPS y la declaración no se consideran verdaderos por proceder del teléfono.

Borradores sólo durante la sesión, sin cola offline. Reportes caducan en 24 h y se purgan a siete días; overlays duran pasos simulados y una revisión posterior no los revoca automáticamente. Reiniciar conserva auditoría pero pierde la simulación. Quedan para otra fase administración remota, corroboración real, respaldos/migración multiinstancia, revocación explícita y GPS físico. No hay fotografías ni navegación real de emergencia.

## Commits locales

- `316a6e3`: contrato versionado y generados compartidos.
- `d41f275`: persistencia, validación, autorización, overlay/auditoría y pruebas Go; ADR previa.
- `eed3b3a`: flujo Flutter, GPS opcional y pruebas.
- `e2260d0`: capa/panel React, transporte, filtros y pruebas.
- `5b4b46a`: launcher persistente y QA real Flutter/Go/React.
- La documentación/evidencia se conserva en un sexto commit separado, identificable con `git log -6 --oneline`.

Se usaron identidad/fechas reales de Git. Los cinco cambios previos de FASE 3B.2 se conservaron fuera de estos commits: `deploy/validation-phase3b2.json`, `docs/informe-fase3b2.md`, `docs/operacion-multigrafo.md`, `docs/revision-rollout-fase3b2.md` y `deploy/validation-phase3b2-rollout.json`.
