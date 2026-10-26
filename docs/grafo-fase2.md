# Geografía urbana de Manta — FASE 2

El diagnóstico previo está en [diagnostico-geografico.md](diagnostico-geografico.md). FASE 2 separa la referencia urbana, las zonas de origen y la red realmente navegable. No representa la provincia de Manabí ni restringe las rutas a los cuatro barrios de origen.

## Fuentes y extensión

Se consultó el servicio público oficial [GeoManta](https://geo.manta.gob.ec/buildVisorVentaTerrenos). Su JavaScript público referencia el proxy WFS; las capas `workspace_geomanta:geo_parroquia` y `workspace_geomanta:geo_barrio` se descargaron en EPSG:4326. `manta-boundaries.json` conserva URLs, IDs, atributos y geometrías originales usadas. No se trazaron límites de barrio a mano.

La referencia urbana incluye las seis parroquias que el propio servicio marca `Urbano`: Manta, Tarqui, Los Esteros, Eloy Alfaro, San Mateo y Urbimanta. Excluye San Lorenzo y Santa Marianita marcadas rurales y las porciones periféricas sin esa clasificación. La suma de las áreas publicadas es 68,480 km²; difiere del límite urbano de 60,114 km² descrito en el PDOT de 2024, por lo que no se presenta como la misma versión territorial. Los atributos municipales son la fuente de esa cifra, sin convertirla en una declaración de cobertura vial.

El cantón Manta, [OSM relación 112895](https://www.openstreetmap.org/relation/112895), tiene una extensión mucho mayor e incluye territorio rural. El recorte vial toma el envolvente de las parroquias urbanas y conserva calles públicas reales que conectan sus piezas, aunque atraviesen pequeños espacios sin clasificación urbana. No se crean conexiones rectas entre polígonos. Los 127 nodos geométricos de conectores fuera de la unión urbana inicial están identificados en la procedencia del maestro; sus segmentos son vecinos reales OSM.

La descarga OSM se divide en teselas pequeñas de la API Map oficial. Dos teselas centrales excedieron el límite de nodos y se subdividieron automáticamente: la instantánea final contiene 25 teselas exitosas. No se aceptaron silenciosamente huecos de descarga. La entrada filtrada `manta-urban.osm.json.gz` ocupa unos 548 KB y permite regenerar los grafos sin red. Se conserva fecha de adquisición, coordenadas, nombres de vía, tipo, dirección vehicular, acceso peatonal explícito, puentes y checksum. Se eliminan nombres de editores, usuarios y otros metadatos ajenos al mapa.

La selección es una red peatonal pública: se excluyen `foot=no`, accesos privados/no permitidos salvo permiso peatonal explícito y autopistas. Se incluyen arterias `trunk`/`trunk_link` cuando no prohíben peatones: el filtro antiguo las omitía y desconectaba San Mateo. La inclusión sin `foot=no` es una convención de modelado OSM, no verificación en terreno de aceras ni una recomendación para viajar a pie. El sentido vehicular permanece en la fuente; la red peatonal respeta `oneway:foot` cuando existe. Esta instantánea operativa no contiene restricciones peatonales dirigidas.

## Variantes conservadas

| Variante | Nodos | Aristas | Longitud vial km | Articulaciones | Puentes de grafo | Ciclos independientes |
| --- | --- | --- | --- | --- | --- | --- |
| `v1` | 300 | 325 | 24.952 | 225 | 226 | 26 |
| `v2` | 300 | 383 | 43.196 | 158 | 136 | 84 |
| `expanded` | 1000 | 1599 | 137.338 | 118 | 100 | 600 |
| `master` | 9179 | 13452 | 972.521 | 1578 | 1794 | 4274 |

- `manta-v1.json` conserva byte por byte el grafo histórico, también disponible como `manta.json`. No se sobrescribieron su fuente, procedencia ni los informes de FASE 1.
- `manta-master.json` (`manta-master-57caa90f3aa7`) conserva las intersecciones relevantes del componente público urbano conectado. Incluye calles de las seis parroquias, desde San Mateo al oeste hasta Los Esteros al este y la extensión sur de Urbimanta. No incluye callejones o redes aisladas sin conexión pública comprobable; los componentes descartados permanecen contados en la procedencia.
- `manta-v2.json` (`manta-v2-0ab03290b16a`) es el grafo operativo de **300 nodos**, con corredores reales entre los cuatro orígenes y centros de las seis parroquias. Se añaden ciclos mediante desvíos existentes antes de expandirse a ramales.
- `manta-expanded.json` (`manta-expanded-70a6ea98fc50`) es un experimento de 1.000 nodos. No reemplaza automáticamente al grafo de competición.

La muestra operativa contiene 43,196 km de calles frente a 972.521 km del maestro, aproximadamente **4.44% de su longitud vial**. La variante ampliada contiene aproximadamente **14.12%**. Son cocientes sobre la misma referencia de calles, no porcentajes de superficie urbana cubierta. La fuente maestra es amplia; la muestra de 300 nodos **no contiene todas las calles de la ciudad**.

`Graph.coverage` es únicamente una envolvente convexa para encuadrar el mapa, calculada a partir de las geometrías municipales. No es el límite oficial de Manta ni implica que todo su interior sea navegable. Los polígonos municipales completos permanecen en `manta-boundaries.json`.

## Conectividad y compromiso de 300 nodos

Los cuatro orígenes requieren 90 nodos de unión de caminos reales antes de añadir alternativas. La selección reserva caminos hacia los centros de las seis parroquias y usa el presupuesto restante para cerrar ciclos. La selección no depende de las semillas de zombies ni de tasas de evacuación: no se movieron calles para mejorar un resultado.

Toda arista operativa procede de una arista maestra. Se contraen solo nodos geométricos de grado dos; ningún recorrido atraviesa una intersección pública real de la fuente como si fuera invisible. El camino original, los IDs de vías y la geometría quedan en la procedencia. La geometría se usa para dibujar las curvas reales, no una línea arbitraria entre extremos cercanos. Las calles paralelas se conservan como aristas separadas cuando tienen recorridos distintos.

El número de ciclos pasa de 26 a 84 y las articulaciones bajan de 225 a 158, pero no desaparece la fragilidad. En el nuevo operativo, las dos aristas con mayor aislamiento individual dejan 65/300 nodos sin refugio; la peor exclusión de una horda afecta 93/300 incluyendo su huella. En el histórico eran 37/300 y 44/300 respectivamente. Estos casos adversariales pueden empeorar aunque aumenten cobertura y ciclos; no se oculta ese resultado. La variante de 1.000 nodos reduce esos impactos a 39/1.000 y 45/1.000. Los informes `*.audit.json` preservan los detalles y distinguen los análisis exhaustivos operativos de los no ejecutados sobre el maestro grande.

La arista más larga del operativo mide 1.147,754 m (p95: 333,964 m). Las pruebas comprueban que su recorrido existe y no oculta cruces. Sigue siendo un solo salto del contrato, lo que constituye una limitación del modelo de turnos. No se fuerza una cobertura vial completa en 300 nodos fusionando intersecciones reales. La comparación de evacuación usa remapeos explícitos y registra el cambio de distancias; topologías distintas pueden alterar persecuciones.

## Zonas de aparición

| ID | Nombre | Fuente municipal | Candidatos en v2 | Peso por defecto |
| --- | --- | --- | --- | --- |
| `tarqui` | Tarqui | geo_barrio / geo_barrio.31 | 26 | 1.0 |
| `los-esteros` | Los Esteros | geo_parroquia / geo_parroquia.1 | 22 | 1.0 |
| `barbasquillo` | Barbasquillo | geo_barrio / geo_barrio.168 | 12 | 1.0 |
| `jocay` | Jocay | geo_barrio / geo_barrio.84 | 29 | 1.0 |

Tarqui se concreta como el barrio municipal Tarqui Centro; Los Esteros usa la parroquia completa porque su denominación corresponde a ese ámbito en la capa encontrada. Las extensiones de las zonas no son iguales. La elección y sus IDs son explícitos y reemplazables. Los pesos equilibrados son una configuración de prueba, no valores del jurado.

El grafo publica para cada zona un anillo exterior cerrado y los candidatos válidos. La referencia municipal GeoJSON original conserva todos sus polígonos y huecos; la representación ligera muestra el anillo principal. La pertenencia de candidatos se calcula contra la geometría fuente completa, incluidos huecos, y se valida de nuevo al cargar Go. Las zonas restringen únicamente el nacimiento de sobrevivientes: una ruta puede salir de ellas y atravesar cualquier calle operativa transitable. Los zombies pueden aparecer en todo el operativo conforme a la configuración del simulador.

## Cuatro refugios ficticios

Se eligieron antes de evaluar semillas, mediante dispersión geográfica de puntos reales con al menos tres vecinos cuando hay candidatos. El primer nodo es el más cercano al centro de los nodos operativos; cada siguiente maximiza su distancia mínima a los ya elegidos. No se afirma que sean instalaciones oficiales ni lugares seguros para una evacuación real. Cada variante conserva en su procedencia coordenadas y criterios exactos.

| Refugio v2 | Nodo OSM | Latitud, longitud | Capacidad asumida |
| --- | --- | --- | --- |
| R-1 | OSM-363647993 | -0.9591257, -80.7165734 | 60 |
| R-2 | OSM-5069690117 | -0.9558303, -80.7688276 | 60 |
| R-3 | OSM-5189385207 | -0.9596957, -80.6828249 | 60 |
| R-4 | OSM-2499223926 | -0.9865327, -80.7304837 | 60 |

La capacidad inicial es 60 por refugio, total 240, configurable en el JSON. Los ensayos que aíslan geografía remapean los refugios históricos a la nueva red y documentan distancias; las rondas urbanas usan esta distribución nueva por separado.

El evento físico de ronda 2 puede seguir usando `E-4420ceab96c993b4`, vía OSM [32491400](https://www.openstreetmap.org/way/32491400), conservada en las tres variantes con `bridge: true`. La bandera procede del etiquetado OSM; el colapso es ficticio. No se confunde con los puentes calculados por Tarjan.

## Regenerar y validar

Desde la raíz, sin red:

```sh
python3 tools/geo/urban_manta.py
python3 -m unittest discover -s tools/geo -p 'test_*.py' -v
cd services/evacuation
go test -race ./internal/graph
```

Para adquirir nuevas fuentes, explícitamente:

```sh
python3 tools/geo/urban_manta.py --download
```

El comando conserva la caché temporal de teselas, divide los errores de límite de nodos y solo guarda la instantánea procesada cuando la descarga termina. Si falla la red, los archivos de FASE 1 y la instantánea urbana anterior no se sustituyen por un mapa inventado. Los tamaños pueden cambiar con `--target-nodes` y `--expanded-nodes`; eso crea otra configuración y exige volver a medir, nunca comparar cifras de distintas topologías como si fueran una mejora algorítmica.

Elegir explícitamente una variante:

```sh
npm run simulate -- -graph data/manta-v1.json -scenario scenarios/round3.json
npm run simulate -- -graph data/manta-v2.json -scenario scenarios/urban/round3.json
npm run simulate -- -graph data/manta-expanded.json -scenario scenarios/urban/round3.json
```

Los archivos de escenario deben usar aristas existentes en la variante; el puente físico anterior está conservado, mientras que índices de aristas pueden cambiar. El maestro se conserva para referencia e investigación y no se impone a las 200 solicitudes por turno.

## Validaciones ejecutadas y límites

Pasaron diez pruebas Python (incluidas las tres de FASE 1) y las pruebas Go del grafo con `-race`. Se verifican reproducción offline, coordenadas exactas de OSM, cada par vecino de cada recorrido, longitudes, ausencia de intersecciones ocultas, seis parroquias presentes en el maestro, cuatro zonas/capacidades, conectividad, polígonos, sentidos peatonales y puente físico. Los fixtures de prueba sintéticos están identificados y no se publican como Manta.

Las observaciones de OSM y la cartografía municipal no sustituyen una verificación en terreno. El caso de los caminos peatonales aislados se registra, no se conecta por proximidad. El acceso público a las capas municipales se documenta sin afirmar una licencia abierta no publicada. Los datos de calles derivados de OSM conservan © OpenStreetMap contributors y ODbL-1.0, con sus URLs y checksum; la interfaz debe mostrar atribución.
