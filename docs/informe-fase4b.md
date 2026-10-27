# Entrega FASE 4B — visualización y laboratorio de refugios

Validación local del **26 de octubre de 2026**, America/Guayaquil. El registro UTC de la última prueba de navegador es `2026-10-27T03:31:44.062Z`, correspondiente a esa fecha local. Evidencia consolidada: [`deploy/validation-phase4b.json`](../deploy/validation-phase4b.json). No se realizó push, despliegue AWS ni reinicio de producción.

Los escenarios de inundación emplean parámetros sintéticos y no constituyen pronósticos hidrológicos ni recomendaciones oficiales de evacuación.

## Resultado

Una persona puede abrir React, cambiar de zombie a inundación, configurar e iniciar una tormenta, pausarla/continuarla en Go, observar exposición y cierres, seleccionar agentes/rutas, reemplazar cuatro refugios y ejecutar A/B sin editar código. El comando **`npm run dev:lab`** inicia los tres procesos locales y configura sus URLs/CORS.

La UI incluye los tres presets experimentales, modos base/maestro, ocho capas independientes, inspección de aristas por clic o teclado, estados y plazas de refugios, candidatos editables, métricas, timeline y procedencia. El identificador **SIMULACIÓN — DATOS SINTÉTICOS** permanece visible. La capa de incidentes queda vacía para FASE 4C.

## Decisiones de UI y arquitectura

- **Zombie conservado:** `Escape.tsx`, `WorldMap.tsx`, `SimulationControl.tsx`, controlador Go, reglas, escenarios y datos originales no se modificaron. `ScenarioScreen` selecciona la vista mediante el parámetro de URL `scenario`; zombie sigue siendo predeterminado. La estética Halloween usa los mismos tokens; inundación utiliza los acentos cyan y violeta existentes.
- **Control real separado:** la API 4A era de lectura y su servidor se conserva en 8081. `cmd/flood-lab` añade el laboratorio controlable en 8082, sólo loopback, con sesión HttpOnly/CSRF y Origin explícito. Cada ejecución utiliza el simulador y `/paso` autenticado privado; React no implementa amenaza ni routing.
- **Contratos aditivos:** se conservaron semánticamente los **14 paths y 37 schemas** existentes. Se añadieron operaciones `/lab/*` y tipos `Lab*`; OpenAPI sigue siendo la fuente de verdad y los tipos TS/JSON Schema se generaron. Dart no cambia.
- **Estado coherente:** `LabState` une configuración, estado del controlador, snapshot 4A, plazas, orígenes y timeline. `run_id` y `graph_version` identifican cada grafo efectivo; previews no muestran agentes de otra red. AppShell observa caché, mientras sólo el workspace mantiene polling de 500 ms.
- **Mapa nativo:** el proyecto no tenía Leaflet/MapLibre; se conserva SVG y se agrupan calles en tres paths con índices memoizados e inspección espacial. El módulo flood carga mediante un chunk separado. La cartografía OSM vectorial permanece disponible aun sin raster.
- **Comparación controlada:** Go congela agentes sobre competición con refugios originales antes de sustituir candidatos, y conserva coordenadas al pasar al maestro. Los focos también se congelan. A/B verifica hashes de orígenes/parámetros y usa el mismo denominador; se mide la latencia real del paso completo.

La [guía operativa](laboratorio-inundaciones.md) detalla endpoints, límites, configuración, semántica de controles y reproducción.

## Prueba real desde React

El checker `tools/qa/check_flood_lab.mjs` compiló y arrancó Go, Vite y Chromium reales, validando respuestas contra JSON Schema. La última ejecución aprobó **13 comprobaciones**:

1. Catálogo con 300/383 y 9.179/13.452; sin confundir el preset intermedio con el maestro.
2. Mutaciones protegidas con sesión local, Origin y CSRF.
3. Rechazo de candidatos incompletos, duplicados o lejos de un nodo transitable.
4. Selector de escenarios e identificación sintética visible.
5. Ocho controles de capas independientes.
6. Elegir en mapa, eliminar/restaurar, rechazar y validar candidatos desde UI.
7. Pausa confirmada que conserva el paso del backend durante una espera posterior.
8. Inspección de calle por clic y ruta SVG no vacía de un agente en movimiento.
9. Evolución de lluvia que produce calles rojas bloqueadas en el mapa.
10. Continuación, reinicio en paso cero y repetición con orígenes exactos conservados.
11. A/B completo desde React con cuatro alternativas realmente enviadas a Go.
12. Maestro usado por el motor real, versiones consistentes y DOM acotado.
13. Regreso al escenario zombie con su mundo original.

Se registraron **cero errores JavaScript, HTTP inesperados o conexión**, cero peticiones del navegador con la clave de `/paso` y cero solicitudes raster. Siete consultas GET canceladas normalmente por TanStack al cambiar ejecución se registran aparte como `net::ERR_ABORTED`; no se ocultaron otros fallos.

La prueba adicional del launcher integrado también pasó: en Chromium, `npm run dev:lab` llevó el laboratorio hasta paso 19 y lo pausó con 80 agentes, 50 evacuados, 81 calles bloqueadas, 53 en precaución y 65 replanificaciones; cero errores de navegador/red. Sus procesos se cerraron al finalizar la comprobación.

## Comparación A/B medida

Caso concreto del checker: grafo base, semilla **42**, **20 agentes**, duración **80 unidades**, perfil `storm`, intensidad 0,8, evacuación preventiva. Cada estrategia tenía cuatro refugios con capacidad 60 por refugio. B usa cuatro nodos reales alternativos validados; nombres/capacidades no son certificaciones de instalaciones.

| Métrica | A · Originales | B · Personalizados |
| --- | --- | --- |
| Evacuados / total | 17 / 20 | 20 / 20 |
| Porcentaje evacuado | 85% | 100% |
| Aislados al final | 0 | 0 |
| Tiempo medio simulado entre evacuados | 19,4118 | 19,9500 |
| Refugios a capacidad | 0 | 0 |
| Replanificaciones | 16 | 0 |
| Calles bloqueadas / precaución al final | 0 / 54 | 0 / 54 |
| Latencia media de `Step` completo | 4,9549 ms | 3,8367 ms |

Los tres agentes de A aún no evacuados seguían en tránsito; no se etiquetaron como muertos ni aislados. El promedio temporal se calcula sólo entre quienes evacuaron. Este único caso no prueba superioridad general ni una mejora causal de rendimiento de B.

Ambos resultados tienen:

- `origins_hash`: `15e97d0f868946c6c06443f70a43c12bb4e13945504ee5804b94a3365b150adf`.
- `config_hash`: `ec084ecc4a291ed557cb04827d4559d5e729e3fc387c325e9fdaa2fd7f2f89eb`.

La versión efectiva del grafo difiere por los candidatos, como corresponde. Dentro del mismo grafo, los puntos iniciales son exactos; al cambiar a maestro se comprobaron ID/coordenadas de origen iguales y ajuste máximo **0 m**.

## Payload y rendimiento visual del maestro

Medición local final en Chromium, viewport 1440×1100, con las otras suites ya terminadas:

| Indicador | Observación |
| --- | --- |
| Grafo efectivo | 9.179 nodos / 13.452 aristas |
| JSON del grafo | **4.543.303 bytes**, sin afirmar compresión de red |
| DOM de toda la página tras el cambio | **673 elementos** |
| Heap JS usado medido por CDP | **66.554.992 bytes** (66,55 MB decimales) |
| Desde iniciar maestro hasta pausa/confirmación visual | **811,73 ms** |
| Objetos React de calles | Tres paths SVG agregados |

Ese tiempo incluye preparación del motor, solicitudes, comprobación de versión/render y ACK de pausa después de una previsualización. No es un benchmark aislado de pintura, carga inicial en frío, FPS sostenidos ni SLA. El heap tampoco demuestra por sí solo ausencia de fugas a largo plazo. No se atribuye mejora al motor zombie ni se extrapola a AWS o móviles físicos.

La geometría se solicita por ejecución y queda en caché; pausar o cambiar velocidad no vuelve a descargar el maestro. Los costos de copias de grafo del núcleo 4A permanecen documentados en su [informe](informe-fase4a.md). No se cambia automáticamente al dataset de 1.000 nodos para aparentar mejor rendimiento.

## Capturas revisadas

Archivos locales conservados bajo `deploy/evidence-private/phase4b-20261026/`, excluidos de Git:

- [Escritorio pausado con ruta](../deploy/evidence-private/phase4b-20261026/flood-desktop-paused.png).
- [Exposición y calles bloqueadas](../deploy/evidence-private/phase4b-20261026/flood-desktop-exposure.png).
- [Comparación A/B](../deploy/evidence-private/phase4b-20261026/flood-comparison-desktop.png).
- [Móvil 390×844](../deploy/evidence-private/phase4b-20261026/flood-mobile-viewport.png).
- [Mapa móvil](../deploy/evidence-private/phase4b-20261026/flood-mobile-map.png).
- [Página móvil completa](../deploy/evidence-private/phase4b-20261026/flood-mobile.png).
- [Grafo maestro](../deploy/evidence-private/phase4b-20261026/flood-master-desktop.png).

Las capturas usan la cartografía vectorial OSM real del repositorio y estados de Go real. Las teselas públicas se deshabilitaron durante automatización, conforme a su política; no se presentan como evidencia de disponibilidad del proveedor raster. El checker espera que finalice la transición del menú móvil antes de capturar y verifica que no haya desborde horizontal.

## Builds y pruebas

| Comprobación | Resultado real |
| --- | --- |
| Go normal y `-race`, ejecución completa con `-count=1` | **145 pruebas principales / 239 con subcasos**, 14 paquetes, cero fallos/carreras detectadas |
| `go vet ./...`, `go build ./...` | Correctos |
| OpenAPI, generación, tokens y `npm run check` | Correctos, generados sincronizados, TypeScript/ESLint aprobados |
| `npm test` | React **35** (13 nuevas) y servicio histórico **40** aprobadas |
| `npm run build:web` | Correcto; chunk flood diferido de 42,87 kB / 13,19 kB gzip |
| `npm run test:e2e` | Ocho regresiones zombie desktop/móvil aprobadas |
| `npm run graph:test` | Diez pruebas Python aprobadas |
| Contratos HTTP 4A | Checker de inundación aprobado; zombie aprobado con navegador y Flutter real |
| Checker React/Go 4B | Trece comprobaciones reales aprobadas y siete capturas |
| Flutter analyze / unitarias / integración HTTP habilitada | Sin incidencias; 13 unitarias aprobadas, una condicionada omitida en suite normal y una integración real aprobada al habilitarla |
| APK debug Flutter | Construido; no se afirma prueba física nueva |
| `npm run dev:lab` | Arranque, CORS, cambios de escenario y pausa reales aprobados |

Una prueba antigua de interacción React agotó su timeout inalterado de 5 s al ejecutarse simultáneamente con Go `-race` y builds Flutter. La suite completa pasó al repetirse aislada; no se aumentó el timeout ni se quitó ninguna aserción. Los ajustes posteriores de fixtures QA se comprobaron con las 13 pruebas nuevas y TypeScript/ESLint.

## Archivos modificados

- Contrato y generados: `packages/contracts/openapi.yaml`, `packages/contracts/generated/{api.d.ts,schemas.json}`.
- Backend local: `services/evacuation/internal/floodlab/{models,validation,manager,comparison,http,manager_test}.go`, `services/evacuation/cmd/flood-lab/main.go`.
- UI: `apps/web/src/features/ScenarioScreen.tsx`, `apps/web/src/features/flood/{FloodLab.tsx,FloodMap.tsx,flood.css}`, `apps/web/src/app/App.tsx`, `apps/web/src/components/AppShell.tsx`.
- Transporte/configuración: `apps/web/src/{services/api.ts,services/queries.ts,lib/config.ts,styles/global.css}`, `apps/web/.env.example`.
- Pruebas/arranque: `apps/web/src/tests/{flood-api.test.ts,flood.test.tsx}`, `tools/qa/check_flood_lab.mjs`, `tools/scripts/dev_lab.mjs`, `package.json`.
- Guías/evidencia: `README.md`, `apps/web/README.md`, `docs/{laboratorio-inundaciones,informe-fase4b}.md`, `deploy/validation-phase4b.json`.

Los cambios previos en `deploy/validation-phase3b2.json`, `docs/informe-fase3b2.md`, `docs/operacion-multigrafo.md`, `docs/revision-rollout-fase3b2.md` y `deploy/validation-phase3b2-rollout.json` se conservan fuera de estos commits.

## Uso y límites pendientes

```sh
npm run dev:lab
# Abrir http://127.0.0.1:5173/escape
# Escenarios → Inundaciones urbanas → Iniciar tormenta
# Editar cuatro candidatos → Validar cuatro candidatos → Comparar A/B
```

El laboratorio es local y pierde su RAM al reiniciar el proceso. No hay directorio verificado de universidades/instalaciones ni certificación de seguridad por proximidad vial; los nombres y coordenadas de candidatos los aporta el usuario. La selección exige acceso dirigido, cuatro nodos diferentes y ajuste ≤500 m, pero no valida estabilidad, elevación, operación real del edificio ni otras amenazas. La capa de incidentes no implementa todavía FASE 4C. El servicio no se expone remotamente ni se habilita en la web publicada sin un despliegue posterior explícito.

## Commits locales

- `776fc52`: contratos aditivos del laboratorio.
- `73a12b9`: control Go, validación y A/B con entradas congeladas.
- `a0c42d0`: visualización React, candidatos y métricas.
- `3d2d60f`: launcher y pruebas reales/unitarias.
- La documentación y evidencia se conservan en un quinto commit separado, identificable mediante `git log -5 --oneline`.

Se utilizaron identidad y fechas reales de Git, sin fabricar historial ni realizar push.
