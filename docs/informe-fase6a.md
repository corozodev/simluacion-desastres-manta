# FASE 6A — visualización animada sobre observaciones reales

Implementación y validación local del **27 de octubre de 2026**, America/Guayaquil.
Resumen verificable: [`deploy/validation-phase6a.json`](../deploy/validation-phase6a.json).
Se conservaron los motores Go, contratos, credenciales, determinismo, perfiles y
controles FASE 5. No se hizo push, despliegue ni operación de infraestructura.

## Implementación

Los mapas existentes son **SVG nativo**, no MapLibre ni Leaflet. Se extendieron
`WorldMap` y `FloodMap` con una misma capa `AnimatedEntities`, sin motor de juegos,
dependencias nuevas ni solicitudes HTTP desde la animación. El mapa zombi ahora
usa Mercator y el fondo OSM opcional existente; su red se agrupa en dos paths,
incluido FULL_MANTA. Inundaciones conserva sus tres paths viales, selección de
aristas, candidatos, reportes y referencia oficial.

El orden es fondo OSM, cobertura/referencia y focos, vías, entidades/ondas, ruta
seleccionada, refugios y reportes. Las rutas y refugios quedan por encima de los
personajes. Los controles conservan teclado, arrastre y zoom; **Centrar agente** y
**Centrar exposición** facilitan revisar datos publicados. La conversión de clics
usa la matriz SVG inversa, también con márgenes internos en móvil.

La capa comparte símbolos SVG por atlas/dirección. La animación cambia el frame
del recurso compartido, sin reconstruir geometría vial o colecciones de datos a
cada frame. Los PNG se reutilizan mediante la caché del navegador. Los personajes
conservan un tamaño legible al cambiar el ancho del mapa mediante ResizeObserver.

### Recursos

[Catálogo portable y licencias](../packages/visualization/README.md): zombis de
SpriteAttack, sobreviviente Sora de Danilo Mattos y ondas de AmberFallStudio.
Las páginas originales declaran CC0; se verificaron los archivos descargados y
se documentó que los ZIP no contienen un LICENSE independiente. El catálogo
incluye fuente, autor, hashes, celdas, frames, anclaje, direcciones, FPS y fallback.

Los tres PNG transparentes suman **25.198 bytes**. Personajes: cuatro frames de
64² en cuatro filas cardinales; ondas: cuatro frames de 32². Las direcciones del
zombi se derivan por rotación y están declaradas como adaptación. Se excluyeron
ataques y GIF de ejecución. También se consultaron las dos fuentes alternativas
solicitadas; la textura de agua completa se descartó para evitar sugerir una
superficie observada de inundación. Si falla una imagen, queda un personaje SVG
estático; si falla el fondo raster, permanece la red vectorial OSM.

### Fidelidad de posiciones y estados

No se necesitó extender OpenAPI ni modificar Go: `current_node`, IDs estables,
`Graph.nodes`, polilíneas de aristas y `Zombie.path` son suficientes.

Una transición requiere la misma ID, versión de grafo y escenario, exactamente
un turno de diferencia, conexión y ejecución RUNNING en ambas observaciones.
El sobreviviente sólo puede recorrer una arista comprobada; el zombi usa el
recorrido publicado del último turno, validando origen, destino y todos los
segmentos. La interpolación sigue la longitud de la polilínea y determina una
dirección cardinal. Una ruta planificada nunca prueba movimiento ya realizado.

No se interpola ante turnos saltados, nodos desconocidos, recorrido incompleto o
aristas paralelas con geometrías diferentes: se muestra el último nodo conocido.
Esto importa en la geografía real, donde existen pares de nodos con más de una
calle. Nunca se extrapola ni se generan ubicaciones para separar personajes.

Los estados active/bitten/evacuated y moving/waiting/isolated/evacuated conservan
su significado, con símbolos alternativos al color. La mordida sólo tiene un
pulso breve si existe un evento `bitten` del turno y un estado previo compatible;
no convierte al sobreviviente en zombi. Los sleepers ocultos se excluyen. **H**
representa una entidad horda: no se conoce su número de integrantes.

Pausa, cancelación, finalización, error, pérdida de conexión, movimiento reducido,
pestaña oculta o desactivación de animaciones cancelan el reloj y presentan el
último punto observado. Reanudar el mismo turno no reproduce un movimiento viejo.
Cambiar zoom o recursos durante una transición también resuelve al punto real.
El desmontaje limpia RAF, listeners y ResizeObserver. La recarga observa la
sesión autorizada existente y el reinicio obtiene otra ID mediante el flujo FASE 5.

### Inundación y procedencia

Los tonos `#56C5E5`, `#1685CF` y `#174EA6` corresponden a bandas visuales del índice
sintético 0–0,33, >0,33–0,66 y >0,66–1. No son clases hidrológicas ni profundidades.
Los colores son tokens compartidos configurables. Se mantienen exactamente los
estados viales passable/caution/blocked y la histéresis del motor; no se recalculan
cierres desde los colores. Restricción `#D79E35`, cierre `#E04C49`, refugio disponible
`#27A67C`; los restantes estados del refugio conservan sus indicadores existentes.

Los círculos representan **focos de exposición del modelo**, con su centro,
radio e intensidad reales, no extensión observada de agua. No se generan nuevos
polígonos. Las ondas pequeñas se anclan en la geometría por ID de aristas con riesgo
publicado, sólo a zoom cercano y dentro del viewport. Son decorativas; su frame
no altera la intensidad o severidad ni representa velocidad física. No se añadió
lluvia ambiental.

Reportes: punto circular ciudadano, rombo sintético, hexágono oficial; glifo del
tipo existente y símbolo de validación. El título conserva descripción, fuente,
fecha y vigencia, e indica que no modifica esta sesión. Pendiente sigue siendo
una declaración sin verificar. La susceptibilidad oficial conserva polígonos,
fechas y atribución propios, separada de exposición sintética y eventos históricos.
Las capas sin datos o disponibilidad quedan deshabilitadas. Se mantiene visible
la advertencia de rutas simuladas no certificadas para evacuación real.

`VITE_INCIDENTS_API_BASE_URL` y `VITE_FLOOD_API_BASE_URL` conservan los servicios
independientes del laboratorio; el servidor de sesiones no sustituye sus APIs.
Si ese servicio no está disponible se informa su error, conservando la simulación.
Ningún reporte o actualización oficial se incorpora automáticamente al mundo.

### Rendimiento y límites configurables

`visualization/model.ts` publica `visualLimits`; la capa también admite presupuestos
`maxAnimated` y `maxIndividual` como props:

| Presupuesto inicial | Valor |
| --- | ---: |
| FPS de sprites y ondas | 4 |
| Actualización máxima de posiciones | 30 Hz |
| Entidades interpoladas simultáneas | 120 |
| Umbral de reducción obligatoria a agrupaciones | 240 entidades visibles |
| Duración máxima de una interpolación | 1.200 ms o 80% del intervalo, lo menor |
| Horizonte máximo sin un nuevo turno | 5.000 ms |
| Ondas visibles | 24 |
| Teselas de fondo por mapa | 32 |

Hay un solo reloj por mapa. Sin recorridos o agua visibles no se programa trabajo.
Los atlas sólo cambian al alcanzar otro frame; el agua sin movimiento actualiza
a 4 Hz. En zoom lejano/intermedio se agrupa por cuadrícula, clase y estado; en
cercano se muestran sprites y agrupaciones de entidades en el mismo nodo. Un
contador suma entidades publicadas, no población estimada. Cada agrupación se
sitúa en un nodo real de un miembro. La selección permanece individual y visible.
Fuera del viewport se omiten entidades y efectos; superar el presupuesto obliga
la reducción aunque el usuario haya deshabilitado la agrupación automática.

No se promete un número máximo absoluto de símbolos: la cantidad de celdas
ocupadas depende de la distribución espacial y de los estados. El límite 120 sí
acota las trayectorias animadas; los demás símbolos permanecen estáticos. BASE
sigue operativo y FULL_MANTA experimental, con sus límites FASE 5 intactos.

## Verificación ejecutada

| Comando / integración | Resultado |
| --- | --- |
| `npm install` | Resolución existente conservada; sin dependencias nuevas |
| `npm run check` | OpenAPI, generados, TypeScript y ESLint correctos |
| `npm test` | 100 React y 40 del servicio histórico aprobadas |
| `npm run build:web` | Correcto |
| `npm run test:contracts:http -- --flutter --browser` | Go legacy, repositorio Dart y mapa React/móvil aprobados |
| `npm run test:contracts:flood` | Seis pasos HTTP reales y JSON Schema aprobados |
| `npm run test:contracts:simulations` | 493 aserciones HTTP contra Go real aprobadas |
| `npm run test:simulations:browser` | Dos contextos privados, controles y recuperación aprobados |
| `npm run test:e2e` | 12/12 desktop/móvil aprobadas |
| `npm run test:visualization:browser` | Ambos motores reales, BASE/FULL_MANTA, capturas y mediciones aprobados |
| `npm run test:lab:flood` | Laboratorio, capas disponibles, candidatos, rutas y comparación aprobados |
| `npm run test:incidents:e2e` | Flutter → Go → persistencia/reinicio → React aprobado |
| `npm run test:references:e2e` | 10 comprobaciones; 59 polígonos, ambos grafos y modo offline aprobados |
| `npm run test:backend`, `test:race`, `build:backend` | Correctos; Go reutilizó paquetes en caché cuando correspondía |
| `npm run graph:test` | 10 aprobadas |
| Flutter analyze / test / APK debug | Sin incidencias; 24 aprobadas, dos integraciones condicionadas omitidas en la suite normal; APK construido |

Se usó Flutter instalado en `/home/naielik/Android/flutter/bin` mediante
`FLUTTER_BIN` o PATH. La integración de incidentes habilitó su prueba HTTP aparte.
Flutter conserva sus repositorios, formularios, GPS opcional y runtime legacy;
se añadieron sólo símbolos Canvas estáticos para personas, hordas, finales y refugios.

Las 20 pruebas nuevas React verifican metadatos/hashes/frames/alpha, fallback,
estados/eventos reales, polilíneas, datos ausentes, paralelas ambiguas, IDs y grafos,
pausa/reanudación/final del reloj, dos mapas, reinicio/desconexión, límite 120,
ondas visibles, movimiento reducido, agrupaciones, culling y separación ciudadana.
El navegador complementa la cobertura con responsive real, pérdida de conexión,
recarga, estados finales y controles; Flutter añade una prueba de pintura estrecha.

### Mediciones y evidencia visual

El checker ejecutó Chromium local con snapshots reales de Go y teselas raster
deshabilitadas para que la red externa no afectara las capturas. Probó 80 agentes,
zombi BASE a 1.440×1.100 e inundación FULL_MANTA a 390×844, además del viewport
alternativo para cada escenario. Las muestras duran aproximadamente 2,5 segundos.
Los intervalos de RAF son programación del navegador, **no FPS de pintura garantizados**,
ni una medición de producción, CPU estable o ausencia de fugas.

Los valores exactos y hashes están en el JSON de validación; la muestra local
registró p95 RAF de 16,7/16,8 ms, 891/940 elementos DOM y aproximadamente
26,3/62,6 MB de heap JS para zombie/inundación. Heap, RSS, tamaño de descarga y
memoria incremental son medidas diferentes. No se reconstruye el grafo por frame.

Evidencia local (excluida de Git):

- [Zombis, detalle pausado](../deploy/evidence-private/phase6a-20261027/zombie-desktop-close-paused.png).
- [Zombis, móvil final](../deploy/evidence-private/phase6a-20261027/zombie-desktop-alternate-viewport-final.png).
- [Inundación, foco y vías restringidas](../deploy/evidence-private/phase6a-20261027/flood-mobile-exposure.png).
- [Inundación, agrupaciones](../deploy/evidence-private/phase6a-20261027/flood-mobile-overview.png).
- [Inundación, escritorio final](../deploy/evidence-private/phase6a-20261027/flood-mobile-alternate-viewport-final.png).
- [Mediciones completas](../deploy/evidence-private/phase6a-20261027/browser-measurements.json).

La inspección visual confirmó sprites, contadores sin desplazamientos inventados,
foco azul translúcido, restricciones ámbar, rutas y refugios por encima, legibilidad
y ausencia de desborde móvil. Se corrigió un desbordamiento por IDs largos antes
de la ejecución final. Las teselas OSM siguen disponibles en uso normal mediante
la configuración anterior; estas capturas muestran la base vectorial real.

## Archivos y reproducción

- Recursos: `apps/web/public/visualization/{zombie,survivor,ripples}.png`,
  `packages/visualization/{catalog.json,README.md}`.
- Paleta: `packages/design-tokens/tokens.json`, CSS y Dart generados.
- Capa compartida: `apps/web/src/features/visualization/{AnimatedEntities.tsx,model.ts,observation.ts,pointer.ts,projection.ts,useVisualization.tsx,visualization.css}`.
- Integración: `Escape.tsx`, `WorldMap.tsx`, `flood/{FloodMap.tsx,FloodLab.tsx,flood.css,incidentPresentation.ts}`.
- Flutter: `apps/mobile/lib/features/escape/route_map.dart`, `test/world_test.dart`.
- QA: `apps/web/src/tests/{visualization,flood,multigraph}.test.tsx`,
  `tests/e2e/app.spec.ts`, `tools/qa/check_{visualization_browser,flood_lab}.mjs`, `package.json`.
- Documentación: este informe, README, AGENTS web y `deploy/validation-phase6a.json`.

```sh
npm run check
npm test
npm run build:web
npm run test:contracts:simulations
npm run test:simulations:browser
npm run test:e2e
npm run test:visualization:browser
```

`VISUALIZATION_EVIDENCE_DIR` cambia el destino de las capturas;
`VISUALIZATION_SCENARIO=zombie_outbreak|urban_flood` permite revisar un motor.
El inventario exacto y los commits locales se conservan en el JSON de validación.
Los snapshots saltados se presentan directamente, la paridad Flutter es estática
y los datos ciudadanos/oficiales requieren su servicio existente disponible.
No se certifican rutas, pronósticos, profundidad, extensión real del agua ni FPS.
