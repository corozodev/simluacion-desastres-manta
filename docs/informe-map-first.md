# MantaSim — acabado map-first y panel compacto

27 de octubre de 2026. Refactor del cliente React sobre el checkout actual. Se conservaron motores, grafos, contratos HTTP, autorización, cadencia zombi de 2000 ms, dependencias y cliente Flutter. No se modificaron informes históricos ni el catálogo o los archivos de sprites existentes.

## Reorganización visual

Ambos escenarios presentan un encabezado mínimo y un único mapa principal. La preparación usa instrumentos compactos; los campos avanzados se abren sin desplazar el mapa. La tarjeta grande «Tu simulación» se sustituyó por `SimulationHUD`: estado real, progreso publicado, tiempo y acciones pertinentes. Las acciones terminales y la repetición siguen requiriendo una acción explícita; inundaciones conserva la confirmación de reemplazo.

El HUD no tiene polling, relojes ni interpolación de progreso propios. Las métricas proceden del snapshot existente y se pueden minimizar; una latencia todavía no medida aparece como tal. Los identificadores completos, semilla y versión siguen disponibles en información técnica secundaria, sin ocupar el HUD.

`WorldMap` y `FloodMap` comparten los slots de HUD, panel y métricas, controles de cámara y fuentes. El renderer y la cámara se conservan al pasar de exploración a ejecución sobre la misma geografía. Los cambios reales de grafo se siguen comprobando por versión antes de mostrar entidades. Inundaciones retiene el último grafo sólo si coincide con la versión autoritativa durante el cambio de ejecución.

La barra lateral colapsada ocupa 52 px y mantiene áreas de interacción de 44 px. Las herramientas, paneles y popups tienen zonas definidas; el drawer móvil no comprime literalmente el escritorio. Se conservaron arrastre, Ctrl+rueda, pellizco, teclado y restablecimiento; Enter permite proponer el centro visible al elegir un refugio y Escape cancela. La atribución OSM permanece sobre el mapa; debajo sólo quedan leyendas y una banda gris con acceso a fuentes y límites.

## Refugios y supervivientes

`AgentShelterPanel` integra dos pestañas sin desplegar las listas completas simultáneamente:

- **Refugios:** ocupación, capacidad, disponibilidad, reservas, estado y localización en mapa; conserva el editor existente y sus validaciones. El panel se cierra durante la selección geográfica y no se reabre por una selección anterior al confirmar o cancelar.
- **Supervivientes:** búsqueda por ID y tabla de exactamente cuatro columnas: Superviviente, Estado, Refugio y Acción. Usa identificadores amigables y «Sin asignar», filas seleccionadas y paginación de 25 registros con scroll interno.

«Ver ruta» reutiliza la selección y las geometrías publicadas. Permite cambiar de agente y «Ocultar ruta» sin borrar la búsqueda; el foco vuelve al buscador y Escape cierra el panel. La indicación contextual es breve. Si no hay recorrido publicado, se informa de ello en vez de afirmar que existe una ruta resaltada.

Se retiraron de la presentación la columna de nodos, coordenadas, siguiente movimiento, zona de origen y cadenas de nodos. Esos datos permanecen en contratos, snapshots y estado. La prueba de integración verifica selección, cambio de ruta y deselección sobre el renderer real, manteniendo los atributos técnicos originales.

## Marcadores y defectos corregidos

Se conservaron sprites, agrupaciones y el reloj visual existente. El zombi incorpora un contorno irregular y acentos de brazos; su símbolo de respaldo usa una postura encorvada y asimétrica. El superviviente conserva la figura erguida. La diferencia no depende sólo del color y no añade un motor de animación.

La revisión detectó que la publicación anterior sólo subía `dist/assets` e `index.html`: faltaban los atlas de `dist/visualization`, aunque existían en el repositorio. Ambos PNG públicos devolvían 403 y los respaldos resultaban demasiado parecidos. `deploy/publish-web.sh` valida sus hashes contra el catálogo y publica todo el contenido estático antes de actualizar el índice. No elimina chunks antiguos que puedan necesitar clientes abiertos.

También se corrigieron estilos que aplicaban el tamaño del mapa a iconos SVG internos, un ancho heredado de 430 px para el progreso móvil, notificaciones de caché durante el render y pérdida de foco al ocultar una ruta.

## Validación

Se ejecutaron `npm install`, validación y generación de contratos/tokens, consistencia generada, `npm run check`, `npm test` y build de producción. También se ejecutaron las suites Go, race detector, build backend, diez pruebas geográficas y contratos HTTP/sesiones (493 aserciones), aunque esos módulos no cambiaron.

Flutter se analizó, probó y compiló sin rediseñarlo: 24 tests correctos, dos integraciones opt-in omitidas en la suite normal y APK debug generado. La integración ciudadana opt-in se ejecutó realmente mediante el checker de incidentes.

Playwright verificó navegación, aislamiento y recuperación en escritorio/móvil. Los checkers reales cubrieron inundaciones (13 comprobaciones), incidentes con Flutter → Go → React (11), referencias oficiales (10) y visualización BASE/FULL con sprites, pausa, desconexión, movimiento reducido y finalización.

Evidencias privadas de esta pasada:

- Inundaciones: `deploy/evidence-private/mantasim-polish-flood-1793116280695/`.
- Incidentes: `deploy/evidence-private/mantasim-mapfirst-incidents-1793116144888/`.
- Referencias: `deploy/evidence-private/mantasim-mapfirst-reference-1793116212661/`.
- Visualización: `deploy/evidence-private/mantasim-mapfirst-visuals-1793116298668/`.

Las capturas muestran el producto implementado. Los verificadores de navegador bloquean las teselas públicas y no certifican disponibilidad del proveedor OSM. La alineación Mercator y la interacción conservan sus pruebas numéricas y funcionales.

## Rendimiento y alcance

No hay consultas nuevas por widget, zoom, pan o cambio de pestaña. La geografía estática y sus paths se reutilizan; sólo se representa la ruta seleccionada y la tabla monta como máximo 25 filas. Mediciones locales del checker visual: 340 elementos DOM en BASE y 553 en FULL móvil; con la referencia oficial FULL se midieron 711 elementos DOM. Los intervalos RAF observados no se presentan como FPS de pintura ni como rendimiento certificado en EC2.

Archivos centrales: `Escape.tsx`, `FloodLab.tsx`, `SimulationHUD.tsx`, `AgentShelterPanel.tsx`, `WorldMap.tsx`, `FloodMap.tsx`, `MapTools.tsx`, `useMapCamera.ts`, estilos del workspace, `AppShell.tsx`, `AnimatedEntities.tsx`, `deploy/publish-web.sh` y sus pruebas. No se reescribieron rutas, refugios, movimiento, amenazas ni reglas del motor.

## Resultados finales y capturas

- **146 pruebas React y 40 de mock-api:** correctas.
- **12 E2E Playwright:** correctas, más el checker real de dos navegadores con aislamiento, recarga, pausa, cupos y caducidad.
- **Typecheck, lint, generación y builds web/backend:** correctos.
- **Go y race detector, diez pruebas geográficas y contratos HTTP/sesiones:** correctos.
- **Flutter analyze, 24 tests y APK debug:** correctos; no se rediseñó el cliente móvil.
- **Publicador web:** prueba con CLI simulado verifica publicación estática completa, índice al final, ausencia de borrado masivo y rechazo de un atlas ausente antes de escribir en AWS.

La aceptación visual final está en [report.json](../deploy/evidence-private/mantasim-mapfirst-1793117344116/report.json). Se verificaron diez composiciones a 1366×768, 1920×1080 y 390×844, incluidas barra colapsada y cobertura ampliada. Las capturas incluyen zombis e inundaciones sin ejecución y en ejecución, panel de agentes seleccionado, popups y móvil. La red vial aparece en el primer viewport; no hubo scroll horizontal ni errores JavaScript, consola, API o sprites. El panel limita su tabla a cuatro columnas y conserva foco y ruta al operar.

Ejemplos: [superviviente y ruta en escritorio](../deploy/evidence-private/mantasim-mapfirst-1793117344116/zombie-agents-1366.png), [panel móvil](../deploy/evidence-private/mantasim-mapfirst-1793117344116/zombie-agents-390.png), [inundaciones](../deploy/evidence-private/mantasim-mapfirst-1793117344116/flood-running-1366.png).

En FULL, el checker final midió tres paths viales en inundaciones y dos en zombis, con 134 y 92 nodos DOM dentro de sus mapas de previsualización, respectivamente. Zombis descargó una sola vez la geografía FULL durante la exploración. Son mediciones locales y no equivalen a una certificación de rendimiento de la EC2.

## Entrega publicada

La implementación se subió a GitHub en `fa51604` y se publicó React en [Escape](https://sistemamanta.lexinnovate.com/escape) y [Inundaciones](https://sistemamanta.lexinnovate.com/flood-lab). CloudFront completó la invalidación `I647AFOQF0NRV12CYJYSRBEEYY`. El backend no se reconstruyó ni se reinició. No se alteraron presupuesto, cuotas o temporizadores.

La prueba HTTPS pública comprobó los tres tamaños, mapas en el primer viewport, un solo indicador, ausencia de inicios automáticos y una ejecución BASE de tres turnos a 2000 ms. Verificó la misma cámara/renderer, pausa, selección de ruta real, las cuatro columnas, ausencia de detalles OSM, ocultación con foco correcto, continuación y finalización. Los tres atlas ahora responden `200 image/png` y sus SHA-256 coinciden con el catálogo. No hubo errores JavaScript ni API. [Evidencia de publicación](../deploy/validation-map-first.json) y [prueba pública privada](../deploy/evidence-private/mantasim-mapfirst-release-20261027/public-smoke.json).

La entrada de operador se verificó públicamente sin usar ni solicitar su código real; el inicio autorizado de tormenta se probó con Go y navegador reales en local. Las teselas públicas se bloquean en automatización para respetar su política de uso. Estas dos delimitaciones no se presentan como pruebas remotas ejecutadas.
