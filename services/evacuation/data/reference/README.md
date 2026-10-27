# Copia territorial oficial para Manta

`manta-official.json` fue adquirido con `cmd/reference-fetch`, mediante HTTPS a la SNGR. No es una fixture inventada ni un mapa de inundación actual. El envelope incluye checksum SHA-256, colección GeoJSON normalizada a MultiPolygon/WGS84, procedencia y URLs exactas de adquisición. El checksum verifica integridad local; no es una firma de la institución.

Área consultada: `[-80.8188739,-1.017171,-80.6581593,-0.9297437]`, envolvente del maestro urbano revisado, sin atribuirle límites cantonales. La consulta geográfica identificó 61 IDs. Dos corresponden a `SIN` y `NO APLICABLE`; el adaptador definitivo filtra `sui IN ('ALTA','MEDIA','BAJA')` antes de solicitar geometrías. Se conservan **59 polígonos: 13 ALTA, 11 MEDIA y 35 BAJA; 3.463 vértices**. Las geometrías que intersectan el área se conservan enteras; no se afirma recorte topológico al bbox.

Origen: [Susceptibilidad de Inundaciones, capa 0](https://sgrportal.gestionderiesgos.gob.ec/server/rest/services/Susceptibilidad_de_Inundaciones/MapServer/0). El servicio declara EPSG:32717, Query, GeoJSON, máximo 2.000 registros y `supportsPagination:false`. Se consultan IDs por bbox y lotes de hasta 50 IDs, sin suponer offsets. Se solicita `outSR=4326`, longitud/latitud, precisión de salida de seis decimales y tolerancia de generalización `0.0001` grados. El polígono 9465 se volvió a consultar sin simplificación y con ocho decimales al detectarse un anillo degenerado. Esto no acredita exactitud topográfica.

La atribución **CONAGE 2024**, resoluciones 006/007/008 y entidades responsables permanece íntegra en `provenance.attribution`. Los atributos `anno` observados son **2025**. El ítem del portal se modificó el **6 de octubre de 2026**; esa fecha no prueba una actualización de los polígonos. No se declaró fecha de publicación, actualización de cada polígono o licencia explícita de reutilización. No se asignó una licencia supuesta.

La segunda colección procede de [EVENTOS_X_LLUVIAS, capa 0](https://sgrportal.gestionderiesgos.gob.ec/server/rest/services/Hosted/EVENTOS_X_LLUVIAS/FeatureServer/0). Se conservan 16 puntos dentro del mismo bbox, incluidos dos de Montecristi. Los eventos están fechados entre **2025-02-16 y 2025-04-14**; la máxima actualización declarada entre esos registros es **2025-04-15**. Las fechas originales de evento/cierre/actualización se conservan como fechas, sin inventar hora ni zona horaria. `N/A` en cierre no indica una emergencia activa. No se descargan campos de responsables, identidad o impactos personales. Esta colección no modifica rutas.

Para obtener una nueva copia privada desde la raíz:

```sh
npm run reference:fetch -- -output private/reference.json
```

El path es relativo a `services/evacuation`, como los demás comandos Go. El comando valida capacidades, registros completos, geometría, límites y procedencia antes del reemplazo atómico. No modifica esta copia versionada salvo que se elija explícitamente `-output data/reference/manta-official.json`. Cambiarla requiere revisar adquisición, términos, geometrías, versión y pruebas; nunca editar sus registros manualmente. El laboratorio carga archivos al arrancar; una descarga CLI nueva requiere reinicio local o actualización desde el proveedor mediante la opción online.

Referencia técnica: [Esri, Query Map Service/Layer](https://developers.arcgis.com/rest/services-reference/enterprise/query-map-service-layer/). La lista de IDs permite consultar subconjuntos cuando no se dispone de paginación. El adaptador impone además cuotas propias y rechaza colecciones truncadas.
