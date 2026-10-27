# MantaSim — rediseño React y corrección del laboratorio

Validación local: 27 de octubre de 2026. Trabajo sobre el checkout recibido, con Git inicialmente limpio. Sin credenciales incorporadas ni cambios a informes históricos. Tras la validación local, el propietario autorizó push a GitHub y publicación de backend y React en AWS; su resultado se registra en el apartado de entrega. No se implementaron sprites ni animaciones nuevas de Fase 6A; la capa visual que ya estaba en este checkout se conserva como observadora. Su catálogo, assets y reglas de movimiento no se modificaron.

## Causa y corrección de inundaciones

`/flood-lab` ya consultaba `GET /lab/session`. En local, esa operación establece la sesión loopback; en producción consulta la autorización compartida del operador. El botón dependía correctamente del permiso y CSRF, pero la pantalla remitía al login legacy de `/escape`. Ese formulario había desaparecido con el ejecutor Fase 5: seguir el enlace no podía autenticar al usuario.

`OperatorAccess.tsx` ofrece el acceso desde inundaciones mediante el `POST /admin/session` existente. El código se lee del input y se borra al enviar; no se conserva en React ni Web Storage. Tras el login se vuelve a consultar `/lab/session`: recibir un ACK del login no concede permiso por sí solo. Cookie HttpOnly, Origin y CSRF siguen siendo obligatorios. Una instancia sin administración habilitada informa que sólo permite observación.

La regresión Go conecta control y laboratorio reales por HTTP: anónimo rechazado, login legítimo, sesión del laboratorio, CSRF falsificado rechazado, inicio real y cookie revocada rechazada. También pasa con race detector. El navegador verifica por separado el modo local autorizado. Después se verificaron ambas rutas públicas por HTTPS, la entrada de operador y una sesión privada real con refugio personalizado. No se ejerció un login de producción con el código del propietario; su autorización se cubrió mediante el puente HTTP real de la prueba local.

## Interfaz y mapas

- Marca web MantaSim y crédito CoroDev desde `brand.json`, sin cambiar la identidad visible de Flutter. Su archivo de marca sólo recibe constantes generadas adicionales.
- Dos accesos directos, barra de escritorio colapsable y drawer móvil con foco, Escape y fondo inerte. Un indicador de API observa las cachés existentes y permite reintentar; distingue conexión, carga, degradación y desconexión.
- `/escape` mantiene brote zombi fijo, BASE predeterminado y FULL experimental sujeto a habilitación. Agentes, ronda y cobertura son primarios; semilla y horizonte quedan en opciones avanzadas. Cada creación envía realmente **2000 ms** al scheduler Go; el polling también conserva sus 2 s y backoff. No hay inicio al visitar o recuperar una ruta.
- Inundaciones resume parámetros y separa semilla, duración, susceptibilidad y reproducción. Presets y controles siguen utilizando las operaciones existentes; desconexión conserva el snapshot y formulario, bloqueando controles sin autorización válida.
- `features/maps/useMapCamera.ts`, `MapTools.tsx` y `map.css` comparten arrastre, Ctrl+rueda centrado en cursor, pellizco, doble clic, teclado y Restablecer vista. ResizeObserver conserva centro y escala al colapsar la barra. La rueda normal conserva el scroll del documento.
- Ambos mapas reutilizan Mercator y las teselas OSM existentes. El encuadre inicial usa nodos y geometrías viales operativos; envolvente y zonas de origen siguen como capas geográficas. Calles agrupadas en paths, topología cacheada, entidades compactas y sólo ruta seleccionada.
- Capas plegables, leyendas acordes a visibilidad, atribución legible sobre el mapa y popup de reportes con fecha, descripción, transitabilidad, severidad y verificación. Detalles oficiales, reportes autorizados, ocupación, timeline y A/B conservan sus funciones en paneles secundarios.

Las teselas son opcionales y su fallo conserva los vectores. La atribución y uso sin descargas masivas siguen la [política oficial de OSM](https://operations.osmfoundation.org/policies/tiles/). El documento fija `strict-origin-when-cross-origin`. Las pruebas automatizadas deshabilitan raster: verifican numéricamente alineación/proyección y no atribuyen a sus capturas disponibilidad del proveedor público.

## Refugios y alcance del backend

**Inundaciones:** panel junto al mapa con cuatro candidatos, capacidad, restauración y coordenadas opcionales. Elegir activa un modo exclusivo, valida la propuesta con Go y exige confirmar; cancelar o Escape no cambia el borrador. Se conserva el ajuste máximo existente de 500 m, duplicados y accesibilidad dirigida. Un acceso vial válido no certifica seguridad ni elevación.

**Zombis:** el contrato previo sólo admitía subconjuntos de los refugios originales. Para cumplir la reubicación se agregó `config.custom_shelters`, opcional y compatible con clientes anteriores. Exige exactamente cuatro IDs originales con nodo existente, capacidad 1–200 y ubicaciones diferentes y accesibles. La UI ajusta una selección a un nodo a un máximo experimental de 500 m, muestra propuesta y exige confirmar. El backend valida el conjunto real antes de construir el motor. Se conserva también la elección anterior de subconjuntos.

La topología mantiene su versión; el snapshot y la configuración publican los refugios efectivos como overlay de sesión. Las copias defensivas y reinicios preservan el conjunto. Cambiar de versión geográfica invalida propuestas y borradores; ocupación, reservas y disponibilidad se mantienen coherentes.

No se reescribieron rutas, coordinación, amenaza ni reglas de `/paso`. El único ajuste del simulador hace que el conjunto explícito de exclusiones originales de spawn sustituya al de refugios editados: unir ambos cambiaría población y consumo RNG. Las pruebas comprueban igualdad de población/amenaza inicial y resultados lógicos al pausar/reanudar con refugios personalizados. Los escenarios y motores históricos permanecen intactos.

## Verificación ejecutada

| Comandos | Resultado |
| --- | --- |
| `npm install` | Resolución existente conservada; auditoría sin vulnerabilidades |
| `contracts:validate`, `contracts:generate`, `tokens:generate`, `generated:check` | Correctos; derivados generados desde sus fuentes |
| `npm run check` | Contrato, generación, typecheck y lint correctos |
| `npm test` | 129 tests React y 40 de mock-api correctos |
| `build:web`, `build:backend` | Correctos |
| `test:backend`, `test:race`, Go `vet ./...` | Correctos; race incluye sesiones y autorización del laboratorio |
| `graph:test` | 10 pruebas correctas |
| `test:contracts:http`, `test:contracts:flood`, `test:contracts:simulations` | HTTP Go real correcto; sesiones: 493 aserciones |
| `test:e2e` | 12 pruebas Playwright correctas en escritorio y móvil |
| `test:simulations:browser` | Dos navegadores contra Go real: aislamiento, cadencia, cupos, recuperación y controles correctos |
| `test:lab:flood` | 13 verificaciones reales correctas, incluidos refugios, A/B y FULL |
| `test:incidents:e2e` | 11 verificaciones correctas, con repositorio Flutter real y persistencia Go |
| `test:references:e2e` | 10 verificaciones correctas, capas oficiales y aislamiento |
| `node tools/qa/check_mantasim_browser.mjs` | Navegación, controles reales, refugio zombi confirmado, BASE/FULL y tamaños 1366×768, 1920×1080 y 390×844 |
| `mobile:check`, `mobile:test`, `mobile:build` | Correctos usando `FLUTTER_BIN=/home/naielik/Android/flutter/bin/flutter`; 24 pruebas y 2 integraciones opt-in omitidas en la suite normal; APK debug generado |
| `npm run bench:backend` y tres `simulate` urbanos completos | Ejecutados; mediciones separadas de las aserciones deterministas |

Las dos integraciones móviles opt-in de la suite normal conservan su condición original; la integración ciudadana se ejecutó explícitamente mediante `test:incidents:e2e`.

## Evidencias y mediciones

- [Capturas y aceptación de interfaz](../deploy/evidence-private/mantasim-ui-20261027/report.json), con imágenes de ambas rutas y los tres tamaños.
- [Inundaciones, refugios, A/B y FULL](../deploy/evidence-private/mantasim-flood-1793111656320/browser-lab.json).
- [Flutter → Go → React e incidentes](../deploy/evidence-private/mantasim-incidents-1793111547009/result.json).
- [Referencia oficial y caché](../deploy/evidence-private/mantasim-reference-1793111606573/references-e2e.json).
- [Medición HTTP local](../deploy/evidence-private/mantasim-metrics-20261027/http-benchmark.json) y tres reportes completos en esa misma carpeta nueva.

En FULL se midieron 9.179 nodos / 13.452 aristas, 4.543.303 bytes de grafo y 835 elementos DOM; con 59 polígonos oficiales, 975 elementos DOM. Las referencias se descargaron una vez. No se vuelve a cargar la topología por polling, zoom o pan.

Benchmark local: 10.000 solicitudes HTTP reales, 16 concurrentes, 0 inválidas y 0 timeouts; p95 4,26 ms y p99 7,77 ms. Host con `GOMAXPROCS=12`, **no EC2 de 2 vCPU**. No se infiere mejora frente a un baseline ni se promete un objetivo AWS.

Tres escenarios urbanos de 150 turnos: 20/20 evacuados; 60/80 evacuados y 20 activos; 132/200 evacuados, 41 mordidos y 27 activos. Los tres registraron cero solicitudes inválidas/fuera de plazo. Son resultados de escenarios sintéticos, no conteos oficiales; sus tiempos HTTP no forman parte del determinismo.

## Entrega y límites

Archivos centrales: `AppShell.tsx`, `ScenarioScreen.tsx`, `Escape.tsx`, `ShelterEditor.tsx`, `OperatorAccess.tsx`, `FloodLab.tsx`, `WorldMap.tsx`, `FloodMap.tsx`, `features/maps/*`, `api.ts`, contrato generado y `internal/sessions/*`. No se añadieron dependencias.

El propietario autorizó la entrega externa después de completar el trabajo local. El contrato sólo se amplió donde faltaba la capacidad de reubicar refugios zombi; aplicar esa capacidad en un servidor anterior requiere publicar el backend actualizado junto con React. Esta iteración no habilita FULL en producción ni cambia cuotas o acceso. La publicación autorizada se completó en la misma EC2 de Ohio (`us-east-2`). La imagen nueva es `sha256:b2e928a730cc9646b570229efe2e83b2ae54c6ed1439ae4beae1a863ad94214e`, etiqueta `corodev-backend:mantasim-1d8b6f6`. Tras comprobar HTTPS se retiraron los dos contenedores sustituidos, la imagen anterior `sha256:b3f8651035f81ac590fa8d98707476a111a821b52a0f0491abb2f5304eb617aa` y sus archivos de imagen en EC2 y S3, incluidas versiones del objeto exacto. No se eliminaron archivos de otras entregas históricas.

React está publicado en [MantaSim](https://sistemamanta.lexinnovate.com/escape), con el laboratorio en [/flood-lab](https://sistemamanta.lexinnovate.com/flood-lab). Se comprobaron credenciales privadas y configuración Docker sin imprimir valores: entorno, límites, seguridad, logging y montajes coinciden; los dos archivos ciudadanos conservan sus hashes. Presupuesto, instancia, cuotas y temporizadores de retirada permanecen iguales.

Una ejecución pública acotada verificó capacidad personalizada de 37 plazas, intervalo efectivo de 2000 ms, pausa, recarga sin recreación, reanudación y finalización de tres turnos. Ambas rutas cargan directamente en escritorio y móvil, con un solo indicador, sin desborde ni errores JavaScript/API. El runtime legacy conserva turno cero y no quedan ejecuciones activas de la prueba. La comprobación final del fallo de teselas también evita que los iconos de imagen rota oculten las calles.

Implementación en GitHub: commit `1d8b6f6`, conservando la historia anterior; un segundo commit registra el ajuste de teselas y la evidencia de entrega. [Resumen verificable de AWS](../deploy/validation-mantasim.json) y [prueba HTTPS privada](../deploy/evidence-private/mantasim-release-20261027/public-smoke.json). La imagen se probó localmente con reemplazo saludable, recuperación ante fallo y eliminación de la anterior antes de operar en EC2.
