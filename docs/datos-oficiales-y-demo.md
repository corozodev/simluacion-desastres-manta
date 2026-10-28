# Fuentes, datos sintéticos y atribución

[Geografía vial](grafo-fase2.md) · [Hidrología](informe-fase8.md) · [Reportes](incidentes-ciudadanos.md)

MantaSim separa procedencia y significado de cada dato. Una referencia oficial
fechada no es una alerta actual; una simulación o un reporte tampoco confirma
una condición real de la calle.

| Fuente | Contenido conservado | Límite de interpretación |
| --- | --- | --- |
| OpenStreetMap y sus colaboradores | Nodos, aristas, geometrías, etiquetas y procedencia versionada | Muestra vial; no certifica refugios ni transitabilidad actual |
| GeoManta | Polígonos de referencia urbana usados en la adquisición geográfica | No convierte el preset de 300 nodos en cobertura completa |
| Escenarios sintéticos | Agentes, amenazas, refugios, lluvia, relieve, costa y cauce | Experimentos reproducibles; no observaciones meteorológicas o topográficas |
| SNGR: susceptibilidad | Polígonos ALTA/MEDIA/BAJA, atribución CONAGE 2024 | Contexto territorial categórico; no profundidad, DEM o probabilidad calibrada |
| SNGR: eventos por lluvias | Registros históricos con fechas originales | No se interpretan como eventos activos ni cierres automáticos |
| Reportes ciudadanos | Declaraciones recibidas y revisión independiente | `verified` no cambia la procedencia ni acredita certificación oficial |

## Copia oficial versionada

La [copia incorporada y su metadata](../services/evacuation/data/reference/README.md)
contienen 59 polígonos y 16 eventos fechados en 2025 para la envolvente del maestro.
Esa envolvente también incluye territorio próximo; no es un límite municipal.
Se conservan CRS, fechas disponibles, versión de contenido y consultas reproducibles.
La licencia explícita no estaba declarada por el portal en la consulta registrada.

Fuentes originales: [susceptibilidad SNGR](https://sgrportal.gestionderiesgos.gob.ec/server/rest/services/Susceptibilidad_de_Inundaciones/MapServer/0)
y [eventos por lluvias SNGR](https://sgrportal.gestionderiesgos.gob.ec/server/rest/services/Hosted/EVENTOS_X_LLUVIAS/FeatureServer/0).
La fecha de consulta, la modificación del portal y la fecha del evento son datos
distintos. Ausencia de registros no demuestra ausencia de amenaza.

En el modelo hidráulico actual, la susceptibilidad sólo aporta contexto y
procedencia. La antigua ponderación ordinal de focos fue sustituida: no modifica
el agua calculada ni representa elevaciones. Se mantienen visibles y separadas
la referencia histórica, la profundidad sintética y las novedades ciudadanas.

## Actualización y fallos

El [arranque local](despliegue.md#desarrollo-local) utiliza la copia versionada y
no necesita Internet. `LAB_REFERENCE_CACHE` selecciona el archivo privado;
`LAB_REFERENCE_ONLINE=true make dev` permite actualización asíncrona al arrancar.
La actualización explícita de `/lab/reference/refresh` conserva sesión autorizada,
Origin y CSRF; las lecturas públicas no disparan descargas externas.

`internal/reference` consulta únicamente endpoints SNGR fijos, valida capacidades,
IDs, categorías, geometrías y CRS, y reemplaza la caché de forma atómica. Limita
cada respuesta a 4 MiB, colecciones a 500 features y geometrías a 120.000 vértices;
cada solicitud tiene timeout de ocho segundos, hasta dos intentos y un presupuesto
total de actualización de 60 segundos. Se retienen tres versiones en RAM y la
última en disco; no es un archivo histórico permanente.

Un fallo externo conserva la copia anterior con fecha/error. Una caché corrupta
se descarta con aviso; si no queda copia válida, la referencia se muestra
indisponible y el experimento sintético sigue funcionando. `stale` después de
seis horas describe antigüedad de consulta, no una alerta ni la vigencia física.

| Lectura | Resultado |
| --- | --- |
| `/v1/reference/status` | Disponibilidad, procedencia, versión y errores |
| `/v1/reference/susceptibility?version=…&bbox=…` | GeoJSON local, ETag/304, geometrías completas |
| `/v1/reference/rain-events` | Colección histórica independiente |
| `/lab/telemetry` | Contadores y tiempos operativos, fuera del determinismo |

OSM también puede aportar raster opcional con atribución visible. Se solicitan
sólo teselas del viewport, sin descarga masiva/offline; el vector local permanece
si falla el proveedor. [Política de teselas](https://operations.osmfoundation.org/policies/tiles/).
Los atlas de personajes tienen fuentes, transformaciones, hashes y atribuciones
en [el catálogo visual](../packages/visualization/README.md).

Las verificaciones de referencias, conservación hidráulica y separación de
capas están en [pruebas](pruebas.md). No se incorporaron catálogos de terremotos,
mapas de tsunami ni un DEM verificado de Manta; no se presentan como capacidades.
