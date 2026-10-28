> **Referencia técnica histórica FASE 4D.** Para ejecutar el producto actual usar [desarrollo local](development/local-setup.md), [contratos](contratos.md) y [arquitectura](arquitectura.md). Hidrología, controles públicos y visores posteriores sustituyen las reglas/pantallas previas descritas aquí; los motores y reportes históricos se preservan.

# Datos oficiales y demostración A–E — FASE 4D

El laboratorio combina geografía revisada, parámetros sintéticos y declaraciones con procedencia explícita. No es un predictor hidrológico ni ofrece navegación real de emergencia. Los eventos históricos y los reportes recibidos nunca cierran una carretera real automáticamente.

## Arranque y fuentes

```sh
npm install
npm run dev:lab
# http://127.0.0.1:5173/escape
```

El modo predeterminado no consulta fuentes externas. Carga la [copia oficial versionada](../services/evacuation/data/reference/README.md), si está disponible, y muestra su fecha/origen. `LAB_REFERENCE_CACHE=/ruta/absoluta/reference.json` elige otra caché privada. El launcher conserva las URLs de ambos motores y del servicio de incidentes.

Para optar por una actualización real en segundo plano:

```sh
LAB_REFERENCE_ONLINE=true npm run dev:lab
```

El laboratorio intenta una descarga al arrancar y habilita **Actualizar copia oficial** para su sesión local autorizada. Las lecturas y pasos del motor siguen usando la copia local; no esperan a ArcGIS. La actualización es explícita, sin cron automático. El indicador `stale` aparece después de seis horas desde la consulta de la copia; no equivale a una alerta ni invalida por sí solo una referencia estructural.

Las [capas SNGR](https://sgrportal.gestionderiesgos.gob.ec/server/rest/services/Susceptibilidad_de_Inundaciones/MapServer/0) se consultaron sobre la envolvente del maestro de Manta. Se conservaron 59 polígonos ALTA/MEDIA/BAJA y 16 [eventos de lluvias](https://sgrportal.gestionderiesgos.gob.ec/server/rest/services/Hosted/EVENTOS_X_LLUVIAS/FeatureServer/0) fechados en 2025. La envolvente incluye territorio próximo y no representa límites administrativos oficiales. La copia contiene fecha de consulta, CRS, versión de contenido, atribución, campos temporales disponibles y consultas reproducibles.

## Procedencias y significado

| Categoría | Contenido | Qué acredita |
| --- | --- | --- |
| `synthetic` | Lluvia, focos, agentes y refugios del laboratorio | Un experimento reproducible con su semilla |
| `official_reference` | Polígonos SNGR de susceptibilidad territorial | Referencia categórica estructural, con atribución CONAGE 2024 |
| `official_observation` | Registros SNGR de eventos por lluvias | Lo consignado por la fuente en sus fechas originales; sin afirmar actividad actual |
| `citizen_report` | Incidentes de FASE 4C | Declaración recibida, con revisión independiente de su procedencia |

Por compatibilidad, el DTO 4C conserva `source_type:citizen|synthetic|official`. `citizen` se interpreta como `citizen_report`; el endpoint sintético sigue identificado como prueba. La revisión `verified` de un reporte no cambia su fuente a oficial. Los eventos externos se mantienen en su colección independiente y no ingresan al almacén ciudadano ni al overlay vial.

OSM sigue siendo la geometría de navegación, con su atribución original. No certifica edificios como refugios. La referencia de susceptibilidad no aporta elevación, profundidad de agua, caudal ni probabilidades de ocurrencia.

## DEMO A · Apocalipsis zombi

Abrir `/escape` y dejar **Apocalipsis zombi**. El proceso Go de competición usa sus reglas originales y grafo 300/383. Mover/seleccionar el mapa, buscar un sobreviviente y consultar su ruta. El proceso de inundaciones es independiente; las referencias y reportes no alteran este mundo ni `/paso`. Las regresiones y hashes anteriores se conservan.

## DEMO B · Tormenta sintética

Elegir **Inundaciones urbanas**, un preset y **Iniciar tormenta**, dejando desmarcada la opción de referencia geográfica. Observar exposición cyan, calles en precaución/bloqueadas y métricas. Pausar/continuar. Cambiar velocidad modifica el ritmo de reproducción, no la física. Todos esos valores siguen siendo índices sintéticos. Ver [modelo 4A](urban-flood.md).

## DEMO C · Cuatro refugios

Pausar. Mantener la referencia desmarcada para reproducir la comparación histórica 4B. Editar cuatro candidatos sobre nodos reales, validar y **Comparar A/B**. Las dos estrategias conservan lluvia, semilla, agentes y orígenes; cambian los refugios. El mismo peso y versión de referencia se conservan en ambas estrategias si se opta por usarlos. Las instalaciones propuestas no tienen certificación de seguridad. Ver [laboratorio 4B](laboratorio-inundaciones.md).

## DEMO D · Novedad Flutter

Seguir la [guía 4C](incidentes-ciudadanos.md). Para Android conectado:

```sh
adb reverse tcp:8080 tcp:8080
adb reverse tcp:8082 tcp:8082
cd apps/mobile
flutter run --dart-define=WORLD_API_BASE_URL=http://127.0.0.1:8080 --dart-define=INCIDENTS_API_BASE_URL=http://127.0.0.1:8082
```

**Nueva novedad → marcador manual → Calle cerrada → revisar → confirmar**. React muestra **Reporte ciudadano pendiente de verificación**. Sólo una aplicación experimental explícita y autorizada modifica temporalmente ese laboratorio. Reiniciar conserva el reporte, no el mundo en RAM. La integración automática usa Dio/Flutter real, con coordenadas de prueba y sin GPS. El borrador se conserva durante la sesión, sin prometer offline completo.

## DEMO E · Susceptibilidad oficial

1. Activar **Susceptibilidad oficial a inundaciones** en las capas del mapa. La capa tiene colores de clases, bordes discontinuos y leyenda ALTA/MEDIA/BAJA; la exposición sintética cyan permanece separada. Activar/desactivar la visualización no cambia el motor.
2. Leer **Fuente, fechas y atribución**. Se muestran CONAGE 2024 y entidades responsables, atributos anuales 2025, consulta de la copia, modificación del ítem y CRS original/salida. Las fechas desconocidas aparecen como no declaradas. La modificación del portal no se presenta como vigencia de cada polígono. La licencia explícita no fue declarada por el portal.
3. Abrir **Eventos históricos por lluvias**. Leer fecha de evento, cierre y última actualización declarados. `N/A` no se traduce en evento activo. Esta visualización no modifica calles.
4. Para el experimento combinado, marcar **Usar susceptibilidad geográfica como referencia**, elegir peso entre 0 y 1 e iniciar otra tormenta con la misma semilla/lluvia. El servidor fija la versión y calcula intersección entre cada círculo sintético máximo y los polígonos, respetando agujeros y segmentos.
5. El factor es `1 + peso × rango`, con BAJA=0, MEDIA=1 y ALTA=2. El valor inicial 0,25 es una elección de laboratorio, sin calibración física. `NONE` indica ausencia de intersección con la copia seleccionada; no significa riesgo bajo. Se registra clase, factor e IDs por zona. No se interpreta susceptibilidad como profundidad.
6. Desmarcar la opción e iniciar con las mismas entradas permite comparar con exposición totalmente sintética. La opción se aplica sólo al crear/repetir una ejecución; cambiar la capa o refrescar la fuente no altera una ejecución activa. Las versiones se fijan en su procedencia.

Prueba reproducible de esta demo:

```sh
npm run test:references:e2e
FLUTTER_BIN=/ruta/flutter/bin/flutter npm run test:incidents:e2e
```

El primer checker usa Go/React/Chromium reales, los modos 300 y 9.179 nodos y la copia oficial. Comprueba modo offline, fuente ausente, versión, orígenes, carga/render, reutilización incremental, eventos históricos y regreso a zombie. Las teselas públicas se deshabilitan en automatización. Los resultados privados de esta fase se encuentran en `deploy/evidence-private/phase4d-20261026`; los checkers previos permiten elegir un directorio distinto para conservar sus entregas.

## Endpoints nuevos y arquitectura

| Método y endpoint | Uso |
| --- | --- |
| `GET /v1/reference/status` | Disponibilidad de caché, modo, procedencia/versiones, errores y contadores; sin I/O externo |
| `GET /v1/reference/susceptibility?version=…&bbox=…` | GeoJSON desde una versión local, bbox opcional dentro de Manta, ETag/304 |
| `GET /v1/reference/rain-events` | Colección histórica separada, con fechas originales |
| `POST /lab/reference/refresh` | Actualización asíncrona 202; sesión local, Origin y CSRF; 409 en offline |
| `GET /lab/telemetry` | Cantidades y tiempos operativos fuera del snapshot determinista |

Contrato fuente: [`openapi.yaml`](../packages/contracts/openapi.yaml). Se añaden `LabRunConfig.geographic_reference` y `DataProvenance.geographic_reference`, ambos opcionales. El primero contiene `enabled`, versión esperada y peso; el servidor calcula las intersecciones. Si la versión solicitada no existe, rechaza el inicio y permite desactivar la referencia. No la sustituye silenciosamente por otra versión. Se conservan hasta tres versiones en RAM y la última en disco; no es un archivo histórico permanente.

`internal/reference` valida capacidades, obtiene IDs acotados, consulta lotes, normaliza Polygon/MultiPolygon a GeoJSON, comprueba anillos/categorías/CRS y mantiene caché con reemplazo atómico y `fsync`. Sólo acepta los endpoints fijos SNGR en el cliente de producción. Cada solicitud tiene timeout de ocho segundos y hasta dos intentos; cada actualización tiene presupuesto total de 60 segundos. Impone 500 features por colección, 120.000 vértices y 4 MiB por respuesta; rechaza truncamiento, IDs repetidos/faltantes o geometrías inválidas. La consulta bbox selecciona features que intersectan el área; el filtrado posterior en caché usa sus envolventes, conservando las geometrías enteras.

La caché usa directorio privado/archivo 0600 y una copia versionada de aproximadamente 100 KiB. Un fallo externo o de guardado conserva la copia previa y muestra su fecha/error. Un archivo corrupto se descarta con aviso; si no hay copia válida, la capa queda indisponible y el motor sintético sigue operativo. Las lecturas HTTP nunca disparan descargas. El simulador sólo recibe factores ya calculados y metadatos inmutables. La lluvia, la semilla y el grafo base se conservan.

## Observabilidad y AWS

La IaC existente define CloudWatch Logs y un EBS gp3 cifrado de 20 GiB; el launcher de contenedores admite `awslogs`. El informe anterior registró entrega de logs. En esta fase se revisaron esos archivos, sin consultar ni cambiar el estado de la cuenta AWS.

`cmd/flood-lab` emite un JSON `lab_metrics` cada 30 segundos a stdout. Incluye duración/errores/bytes de consultas, hits/misses, tiempo de adquisición, actualización del overlay, fase de planificación, último paso y agentes/aristas procesadas. `replanning_ms` mide la fase completa de planificación, que puede incluir recálculo y reservas; no es una latencia aislada por agente. Los contadores de proveedor son acumulativos por proceso. Las mediciones no entran en los hashes deterministas. El checker registra además bytes reales de payloads y tiempos hasta render/pausa.

Las [consultas Logs Insights preparadas](../deploy/log-insights-phase4d.txt) aprovechan el formato JSON existente. Son plantillas sin ejecutar en AWS. Las muestras cada 30 segundos no dan percentiles de todos los pasos; para eso se usan los benchmarks completos. No se crean métricas personalizadas, alarmas, OTel, agentes ni recursos nuevos. No se atribuye costo cero a ingestión, consultas, disco o tráfico.

El servicio publicado sigue usando su comando y configuración anteriores. Un despliegue futuro de este laboratorio requiere empaquetado/activación explícitos, autenticación remota y un directorio persistente escribible; el contenedor anterior es de sólo lectura y el EBS raíz tiene `DeleteOnTermination:true`. La copia oficial puede montarse de sólo lectura. No se cambió CloudFormation porque esta entrega local no necesita recursos nuevos. No se habilitan endpoints experimentales en producción automáticamente.

## Límites y evolución

Las geometrías generalizadas, el máximo de clase por círculo y los pesos ordinales son aproximaciones de un experimento. No hay modelo de escorrentía calibrado, drenaje urbano real, DEM, batimetría, tiempo de llegada, profundidad ni validación de seguridad vial/refugios. Ausencia de polígonos o eventos no demuestra ausencia de amenaza. La fuente puede cambiar de esquema, condiciones de acceso o datos. La copia fechada mantiene reproducibilidad local, no actualidad garantizada ni autenticidad mediante firma digital.

Para terremoto, la recomendación de arquitectura es un adaptador separado del escenario, con [catálogos IG-EPN](https://www.igepn.edu.ec/portal/eventos/www/browser.html), revisión de estados preliminar/revisado y evidencia específica antes de modelar daños viales. Magnitud y epicentro no bastan para inferir el estado de un edificio o una carretera.

Para tsunami, se propone evaluar [mapas de inundación INOCAR](https://inocar.mil.ec/web/index.php/tsunamis/1379-mapas-de-inundacion) y [boletines fechados](https://www.inocar.mil.ec/tsunamis/eventos.php) en adaptadores distintos, conservando localidad, escenario, referencia vertical y vigencia. La cobertura de Manta debe verificarse antes de integrarla. Esta recomendación es una evolución propuesta; no se incorporaron esos datasets ni se reutiliza la susceptibilidad pluvial como modelo de tsunami.
