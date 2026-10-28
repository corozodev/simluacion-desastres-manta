# Arquitectura actual

[Índice](INDEX.md) · [Despliegue](despliegue.md) · [Nivel PRO](nivel-pro.md) · [Contratos](contratos.md)

CoroDev / MantaSim utiliza un **monolito modular Go**, con un proceso adicional
para el laboratorio de inundaciones. React controla las simulaciones; React
`/mobile` y Flutter Android observan ejecuciones publicadas. No hay servicios
generativos en el routing, colas distribuidas ni base de datos de simulaciones.

![Arquitectura de CoroDev: clientes, AWS y motores](arquitectura.svg)

[Fuente Mermaid editable](arquitectura.mmd). El SVG es vectorial autónomo, sin
scripts, fuentes externas ni recursos remotos, apto para incrustarse en GitHub.

## Componentes y límites

| Componente | Responsabilidad y fuente |
| --- | --- |
| React, TypeScript, Vite | Consola `/escape`, laboratorio `/flood-lab`, visor `/mobile`; [rutas](../apps/web/src/app), [transporte y caché](../apps/web/src/services) |
| Flutter, Material 3 | Visor Android y reportes ciudadanos; [repositorios](../apps/mobile/lib/core/api), [guía](../apps/mobile/README.md) |
| API Go `cmd/server`, puerto 8080 | [Composición](../services/evacuation/cmd/server/main.go), sesiones, compatibilidad `/estado` y proxy opcional `/lab/*`, incidentes y referencias |
| `internal/sessions` | [Ejecuciones independientes](../services/evacuation/internal/sessions): creación explícita, idempotencia, Bearer por sesión, cupos, pausa, caducidad, resultados y publicación |
| `internal/simulation` | [Único escritor del mundo](../services/evacuation/internal/simulation): zombies, movimientos, eventos, mordidas, flota, refugios y RNG propio |
| `internal/decision`, `coordination` | [Routing observable](../services/evacuation/internal/decision) y [reservas globales](../services/evacuation/internal/coordination); `/paso` consulta un plan coherente sin mutar el mundo |
| `internal/catalog`, `graph`, `world` | [Catálogo](../services/evacuation/internal/catalog), [índices](../services/evacuation/internal/graph) y [snapshots](../services/evacuation/internal/world); topología separada de las actualizaciones |
| `cmd/flood-lab`, puerto 8082 loopback | [Laboratorio independiente](../services/evacuation/internal/floodlab), [hidrología 2D](../services/evacuation/internal/flood/hydrology.go), reportes y referencias; conserva almacenamiento propio |
| OpenAPI y tokens | [Contrato HTTP](../packages/contracts/openapi.yaml), [tokens](../packages/design-tokens/tokens.json) e [identidad](../packages/design-tokens/brand.json) generan TypeScript, Dart y CSS |

Los puertos anteriores corresponden al perfil AWS. El arranque local permite
otros puertos; véase [desarrollo local](despliegue.md#desarrollo-local). El desarrollo utiliza los mismos servicios Go; no hay un servidor alternativo de API.

## Un turno, del inicio al mapa

1. React consulta capacidades y geografía. Abrir, explorar o recargar la web no
   crea motores. **Iniciar simulación** envía `POST /v1/simulations` con
   `Idempotency-Key`; Go valida y reserva recursos antes de crear la instancia.
2. Cada sesión conserva su simulador, RNG, planificador, overlays y credencial.
   El manager controla el reloj y serializa turnos; el navegador no los impulsa.
3. El simulador aplica eventos y mueve zombies antes de los peatones; prepara observaciones y
   asignaciones. Su cliente consulta **`POST /paso` mediante HTTP loopback real,
   con `x-api-key`**. El motor de decisión devuelve un vecino transitable o espera.
   El simulador revalida y aplica cada movimiento; un error o timeout deja espera.
4. Routing y coordinación consideran amenazas observables, bloqueos, capacidad
   y, según configuración, riesgo anticipado. Las consultas concurrentes leen el
   mismo plan: no compiten para reservar plazas. Los detalles y límites de
   predicción, refugios y flota están en [Nivel PRO](nivel-pro.md).
5. Se publica un snapshot inmutable y compacto con posiciones, rutas, refugios,
   bloqueos y métricas. No contiene PRNG, sleepers aún dormidos ni topología
   repetida. La geografía se descarga por separado y se cachea por versión.
6. React consulta el estado con Bearer aproximadamente cada dos segundos.
   Los espectadores usan `GET /v1/simulations/published/{scenario}` o
   `GET /lab/published`, con ETag y sin credenciales de control. Observar no
   renueva leases, altera RNG ni crea ejecuciones. No hay WebSocket implementado.

La recuperación desde `sessionStorage` sólo observa la sesión existente. Es la
única credencial permitida en el navegador; nunca se guardan claves de `/paso` ni
de administración. La pausa/reanudación conserva el resultado lógico para igual
grafo, configuración y semilla; los tiempos HTTP quedan fuera del determinismo.

## Geografía, hidráulica y persistencia

**BASE** es la muestra vial operativa de 300 nodos y 383 aristas reales;
**FULL_MANTA**, de 9.179 nodos y 13.452 aristas, es experimental y requiere
habilitación explícita. El importador trabaja offline con OSM versionado,
geometrías y procedencia. Las cuatro zonas de aparición no son fronteras de
navegación; los refugios son puntos simulados, no instalaciones oficiales.
Véase [geografía y procedencia](grafo-fase2.md).

La inundación usa `rainfall_runoff_2d` o `compound_flood_2d` sobre una malla
conservativa separada del grafo vial. Relieve, costa y lluvia son escenarios
sintéticos; la susceptibilidad SNGR aporta contexto y no modifica el agua
calculada. No existe un runtime radial alternativo. Los turnos hidrológicos,
el reloj de evacuación y la reproducción son distintos; [modelo y evidencia](informe-fase8.md).

Sesiones, estados, planes y cachés viven en **RAM de una instancia** y se pierden
al reiniciar el proceso. Los resultados terminales se retienen según TTL/cupos;
no se guardan mapas completos por turno. El laboratorio conserva reportes
ciudadanos y su referencia local en disco privado (`/var/lib/corodev/flood` en
EC2; `private/` en desarrollo). Estos datos requieren backup y se mantienen fuera
de las imágenes y de Git. Los reportes nuevos quedan pendientes, y no alteran
automáticamente motores. Véase [persistencia de incidentes](incidentes-ciudadanos.md).

`/estado` y el control legacy zombie permanecen aislados e inactivos en
`cmd/server`; `SIM_AUTOSTART=true` se rechaza. No representan las sesiones que
observan los clientes actuales. El evaluador FASE 1 permanece congelado.

## AWS y servicios externos

La evidencia registrada del 27 de octubre describe **EC2 `m7i-flex.large`,
2 vCPU / 8 GiB, Ohio (`us-east-2`)**: Docker ejecuta API Go, laboratorio y Caddy.
Sólo Caddy recibe tráfico público 80/443; los puertos Go permanecen internos.
React se sirve desde S3 privado mediante CloudFront/OAC, con ACM en `us-east-1`.
CloudWatch recibe logs, CPU/RAM cada 60 segundos y una alarma CPU; S3 almacena artefactos de releases.
CloudFormation describe estos recursos, y SSM permite operar sin SSH público.

**Cloudflare DNS y Let's Encrypt son externos a AWS.** OSM/GeoManta y SNGR
aportan fuentes versionadas; no se consultan por turno. La actualización online
de referencias es opcional. El auxiliar de caducidad usa Scheduler/Lambda/SQS;
no participa en simulación ni routing. El estado documentado, límites, retirada
programada y comprobaciones están en [despliegue](despliegue.md). Un GET de salud
no certifica rendimiento, ejecución activa ni equivalencia con el código local.

Las decisiones fundacionales se conservan en [ADR](decisions), y sus resultados
históricos están separados de las [pruebas actuales](pruebas.md).
