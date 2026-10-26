# Grafo geográfico de FASE 1

`services/evacuation/data/manta.json` contiene datos reales de OpenStreetMap: **300 nodos, 325 aristas y cuatro refugios simulados** de 60 plazas. Los refugios son puntos de juego próximos a los lugares OSM Barbasquillo, Tarqui Centro, Jocay y Los Esteros; no representan instalaciones oficiales de emergencia.

Se conserva una subred conexa de corredores entre estos barrios. Se colapsan únicamente nodos geométricos de grado dos y se suman distancias Haversine de todos los segmentos originales; las coordenadas de cada nodo publicado son las del nodo OSM identificado por `OSM-<id>`. Cada arista mantiene el recorrido OSM y sus vías en `manta.provenance.json`. Las calles laterales omitidas no se reconectan artificialmente. El tipo de una arista contraída es el tipo que aporta mayor distancia. Entre corredores paralelos con los mismos extremos se conserva el de menor distancia.

Cobertura de nodos seleccionados: latitud −0.9680529 a −0.9449275; longitud −80.7529158 a −80.6854348. La arista más larga mide 1058.612 m. La selección prioriza vías principales y conexiones entre barrios; no pretende representar todas las calles de Manta. Una arista sigue siendo un único movimiento por turno según el contrato, incluso si es larga.

La evacuación se modela a pie: las aristas importadas son bidireccionales aunque la vía tenga `oneway` vehicular; el importador excluye `foot=no`, `access=private/no`, vías en construcción y autopistas. Las velocidades son supuestos configurables en `tools/geo/speeds.json`, no velocidades observadas. El índice Go también admite aristas dirigidas y valida su alcance.

El puente reproducible de la ronda 2 puede bloquear `E-4420ceab96c993b4`: incluye la vía OSM [32491400, Avenida 24 de Mayo](https://www.openstreetmap.org/way/32491400), etiquetada `bridge=yes`, con longitud de arista 63.724 m. La procedencia conserva `bridge_way_ids`; el bloqueo pertenece al escenario ficticio, no anuncia un cierre real.

## Reproducción sin red

Desde la raíz:

```sh
python3 tools/geo/import_manta.py
python3 -m unittest discover -s tools/geo -p 'test_*.py' -v
cd services/evacuation
go test ./internal/graph
```

La conversión usa solo la biblioteca estándar de Python. `manta.osm.json.gz` conserva la entrada filtrada y `manta.provenance.json` registra fecha real de adquisición UTC, URLs de las cuatro teselas, checksum SHA-256 del JSON canónico, lugares OSM y recorridos originales. No es necesario instalar OSMnx ni consultar OSM al arrancar Go. La versión del grafo depende del contenido, y la regeneración offline produce los mismos archivos.

Para descargar una nueva instantánea explícitamente:

```sh
python3 tools/geo/import_manta.py --download
```

La adquisición realiza cuatro GET acotados a la [API Map de OSM](https://wiki.openstreetmap.org/wiki/API_v0.6#Retrieving_map_data_by_bounding_box:_GET_/api/0.6/map), con timeout de 45 s por tesela. Overpass se intentó primero pero devolvió errores o timeout; la API Map sí respondió. La descarga no está dentro del runtime ni de las pruebas normales. Si una adquisición nueva falla, el comando informa el error y la instantánea versionada sigue disponible; no se fabrica un mapa de Manta. Las fixtures pequeñas en tests Go son explícitamente sintéticas y no se sirven como mapa real.

## Validación ejecutada

El índice comprueba IDs únicos, coordenadas finitas dentro de rango, extremos existentes, distancia y velocidad positivas, duplicados equivalentes, capacidad/ocupación y alcance dirigido desde todos los nodos a cada refugio. Se prueban vecinos ordenados, espera, dirección, bloqueos estáticos/dinámicos y JSON estricto. Las pruebas Python verifican reproducción exacta, SHA-256, coordenadas originales, cada segmento real de cada recorrido, suma de distancias, etiquetas de puentes y filtrado de acceso/metadatos.

Datos derivados © OpenStreetMap contributors, distribuidos bajo [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/); [atribución y condiciones de OpenStreetMap](https://www.openstreetmap.org/copyright). Mostrar esta atribución al visualizar el grafo. Los archivos de grafo, entrada filtrada y procedencia comparten esa licencia de datos.
