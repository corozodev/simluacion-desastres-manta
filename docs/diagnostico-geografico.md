# Diagnóstico geográfico inicial — FASE 2.0

Mediciones previas a modificar el motor o reemplazar el mapa. El grafo histórico `manta-v1.json` conserva exactamente la FASE 1, versión `manta-osm-1861b6730dcb`. El instrumento reproducible es `tools/geo/audit_graph.py`; los resultados completos están en `services/evacuation/data/manta-v1.audit.json`.

## Qué representaba FASE 1

El importador anterior conectaba cuatro puntos OSM de barrio mediante caminos y añadía intersecciones de frontera, priorizando vías principales y cercanía a esos cuatro puntos. Se conservaron 300 de las 3.891 intersecciones del componente descargado; no eran todas las intersecciones urbanas de Manta. La selección mantuvo las conexiones entre nodos seleccionados, pero omitió calles laterales y gran parte de las alternativas existentes en la fuente. No se descargó toda Manabí.

Coordenadas extremas de nodos: longitud -80.7529158 a -80.6854348, latitud -0.9680529 a -0.9449275. Su rectángulo envolvente tiene aproximadamente **19.29 km²**. Es una cota espacial, no una medición de calles cubiertas: el espacio entre corredores no implica que exista navegación allí.

El [PDOT municipal 2024–2035](https://manta.gob.ec/wp-content/uploads/2024/11/01-PDOT-Diagnostico-2024-2035.pdf) publicado/indexado describe 6.011,40 ha de límite urbano de ese período. La capa pública actual del [GeoManta municipal](https://geo.manta.gob.ec/buildVisorVentaTerrenos) contiene seis parroquias marcadas `Urbano`, cuyas áreas de atributo suman **68.480 km²**. Incluye Urbimanta y refleja una delimitación distinta de la cifra histórica; no se mezclan las dos como si fueran el mismo límite. El rectángulo de los nodos antiguos equivale al 28.2% de esa superficie actual, **solo una cota de extensión, nunca porcentaje real de cobertura vial**. La fracción de calles se calcula después contra el maestro urbano.

El cantón OSM [relación 112895](https://www.openstreetmap.org/relation/112895) llega hasta −1,13425 de latitud y −80,91277 de longitud, incluyendo extensas zonas rurales. No se usa ese cantón completo como dominio de la simulación.

## Fragilidad medida del grafo 300/325

| Medición | Resultado |
| --- | --- |
| Componentes conexas | 1 |
| Aristas dirigidas | 0; tránsito peatonal bidireccional |
| Grado medio | 2.1667 |
| Puntos de articulación | 225 de 300 |
| Puentes de teoría de grafos | 226 de 325 (69.54%) |
| Ciclos independientes | 26 |
| Longitud de arista p50 / p95 / máxima | 51.897 / 248.779 / 1058.612 m |
| Saltos al refugio más cercano p50 / p95 / máximo | 23 / 47 / 62 |
| Nodos sin acceso a ningún refugio, sin amenazas | 0 |

Un puente de grafo es una conexión cuya eliminación separa componentes. Un puente físico es una infraestructura con etiqueta OSM `bridge`; son conceptos distintos. La vía OSM 32491400 corresponde al puente físico usado en la ronda 2 y su existencia no se deduce del algoritmo de articulaciones.

Los segmentos largos no son conexiones inventadas: la procedencia registra los nodos OSM recorridos y la suma de sus longitudes. El importador anterior comprimía nodos geométricos de grado dos; las pruebas de FASE 2 verifican que ninguna arista atraviese una intersección pública real oculta en la fuente maestra. Una arista de más de un kilómetro sigue siendo un movimiento por el contrato y puede distorsionar distancias recorridas por turno aun siendo una calle válida; se registra su distribución en lugar de ignorarla.

## Vulnerabilidad a cierres

- Cerrar las dos aristas de mayor aislamiento de refugios separa el grafo en 3 componentes (263/36/1 nodos) y deja **37/300 (12,33%)** sin refugio.
- La peor exclusión de una horda (su nodo y sus vecinos) excluye 4 nodos y deja una componente adicional de 40 sin refugio: **44/300 (14,67%)** afectados contando la exclusión.
- Las tres hordas de la semilla original de ronda 3 excluyen 9 nodos, dividen el grafo en cuatro componentes de **204/85/1/1** y dejan **95/300 (31,67%)** sin refugio, contando los nodos excluidos.
- Añadir las posiciones ocupadas por runners visibles a esa exclusión produce diez componentes y **117/300 (39%)** sin refugio. Es una fotografía de accesibilidad, no una predicción de sus movimientos futuros.

Las posiciones iniciales se tomaron del simulador real en `reports/phase2/baseline-initial-round3.json`; no se regeneraron con otro generador aleatorio. El análisis no consulta sleepers ocultos y no cambia reglas ni posiciones.

## Qué explica y qué no explica 38/200

La reproducción HTTP original confirma **38 evacuados, 150 mordidos y 12 vivos activos**: sobreviven 50, de los cuales solo 38 evacuaron. La capacidad total era 240 y quedaron 202 plazas sin ocupar. Por tanto, una escasez global de plazas no explica el resultado.

La fragilidad topológica es verificable: cerrar pocas conexiones elimina alternativas para una fracción significativa de los nodos. No demuestra por sí sola que todos los 150 fallecimientos se deban al mapa. La instrumentación separada del simulador identifica el mecanismo de cada mordida, su zombie y los turnos sin ruta; las comparaciones controladas de FASE 2 mantienen el motor original al cambiar la geografía, y mantienen después la misma geografía al cambiar el motor.

La inicialización anterior distribuía sobrevivientes por todos los nodos no refugio, aunque el escenario debía originarse en cuatro zonas; no contenía polígonos de aparición. Las posiciones podían coincidir con zombies desde el turno inicial. Ambas condiciones se registran en la línea base; no se cambian silenciosamente al atribuir mejoras al algoritmo.

## Reconstrucción fundada en fuentes públicas

Se descargaron las capas municipales WFS `geo_parroquia` y `geo_barrio` en EPSG:4326, con URLs/IDs y geometrías conservados en `data/manta-boundaries.json`. Se distinguen:

- Dominio urbano de referencia: seis parroquias publicadas como `Urbano`, con conectores viales reales entre recintos administrativos cuando sea necesario.
- Zonas de aparición: Tarqui Centro (barrio 31), Jocay (84), Barbasquillo (168) y Los Esteros (parroquia 01). Los tres barrios son recortes verificables de sus sectores; Los Esteros tiene extensión parroquial mayor, explícita y configurable.
- Red maestra: intersecciones y geometrías OSM de toda esa referencia urbana, con procedencia offline.
- Red operativa: aproximadamente 300 nodos, necesariamente una muestra conectada y trazable. No se atribuye cobertura vial completa a una selección de 300 intersecciones de una ciudad con miles.

La selección nueva debe reservar nodos para conexiones reales y ciclos, sin ocultar intersecciones para hacer caber una red completa en 300 nodos. La variante ampliada permite medir el compromiso. La influencia final sobre evacuación está en `docs/informe-fase2.md`, separada de estas mediciones de estructura.

## Reproducir

```sh
python3 tools/geo/audit_graph.py services/evacuation/data/manta-v1.json --initial services/evacuation/reports/phase2/baseline-initial-round3.json --output services/evacuation/data/manta-v1.audit.json
python3 tools/geo/urban_manta.py
python3 -m unittest discover -s tools/geo -p 'test_*.py'
```
