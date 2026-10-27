# Laboratorio React de inundaciones — FASE 4B

Los escenarios de inundación emplean parámetros sintéticos y no constituyen pronósticos hidrológicos ni recomendaciones oficiales de evacuación.

## Abrir y usar

Desde la raíz, con las dependencias instaladas:

```sh
npm install
npm run dev:lab
```

Abrir **http://127.0.0.1:5173/escape**. Este comando compila y arranca dos procesos Go independientes y Vite: zombie en `127.0.0.1:8080`, laboratorio en `127.0.0.1:8082` y React en `127.0.0.1:5173`. Configura ambas URLs y CORS automáticamente, genera credenciales privadas de movimiento sin imprimirlas y cierra sus procesos con Ctrl+C. No utiliza AWS ni cambia servicios existentes. Si un puerto está ocupado, el comando falla y limpia sólo sus procesos. Para otros puertos:

```sh
LAB_WEB_PORT=5190 LAB_WORLD_PORT=18080 LAB_FLOOD_PORT=18082 npm run dev:lab
```

1. Cambiar **Escenarios → Inundaciones urbanas**. La identificación **SIMULACIÓN — DATOS SINTÉTICOS** permanece visible incluso durante carga o error.
2. Elegir cobertura y parámetros de lluvia, duración, semilla, comportamiento y agentes. Los tres presets son configuraciones artificiales, no niveles oficiales de alerta.
3. Pulsar **Iniciar tormenta**. El motor activo, el reloj, las condiciones viales y los agentes proceden de Go. Elegir un agente en la tabla dibuja su ruta publicada.
4. Usar **Pausar** y **Continuar** para detener/reanudar el reloj del backend. El ACK de pausa espera que termine el paso en curso; la consulta siguiente conserva ese mismo paso. La velocidad cambia el intervalo del scheduler, no la matemática de la amenaza. El tiempo de cálculo se añade a ese intervalo.
5. **Reiniciar** reconstruye la configuración activa y deja `idle` en paso cero; **Repetir misma seed** reconstruye esa misma configuración y la pone en ejecución. Para aplicar ediciones del formulario, usar **Iniciar tormenta**. Se puede reemplazar una ejecución pausada con los cambios preparados.

Cambiar de escenario cambia la vista; las dos ejecuciones son independientes. Para detener la inundación antes de volver al panel zombie, usar **Pausar**. Al regresar se recuperan el estado y los candidatos de la ejecución activa. La experiencia zombie y sus controles administrativos conservan su implementación.

El selector ofrece **Modo base** (300 nodos/383 aristas) y **Manta completa — maestro urbano** (9.179/13.452), con cantidades recibidas del catálogo. El maestro representa la geografía urbana conservada, no todas las calles de la ciudad. El preset intermedio de 1.000 nodos no se ofrece como mapa completo. Cambiar cobertura primero previsualiza la geografía y retira los agentes de la otra red; **Iniciar tormenta** envía el modo al motor real. La UI muestra por separado cobertura preparada y motor activo.

## Cuatro refugios candidatos

Se pueden conservar los cuatro originales o editar cuatro alternativas. Cada ficha permite nombre, coordenadas, capacidad experimental, selección mediante clic, eliminación, reemplazo y restauración. Se pueden introducir coordenadas conocidas de una universidad, instalación deportiva, aeropuerto o terminal; no hay un directorio de instalaciones verificadas ni se inventan sus coordenadas. El nombre aportado por el usuario no certifica el uso del edificio.

**Validar cuatro candidatos** solicita a Go:

- Coordenadas finitas y dentro del rango geográfico; identificador y nombre presentes.
- Capacidad entre 1 y 200 por candidato, coherente con los límites del laboratorio.
- Exactamente cuatro identificadores y nodos ajustados diferentes.
- Nodo incidente a una calle base transitable, con ajuste de hasta **500 m**.
- Alcance dirigido: cada candidato debe ser accesible desde todos los nodos de la red base validada.

La distancia máxima es una regla experimental de ajuste, no una recomendación peatonal. Se publican nodo, coordenadas ajustadas, distancia y explicación. Si el lugar está demasiado lejos, duplicado o inaccesible, la UI muestra el motivo y bloquea el inicio personalizado/A/B. Los parámetros malformados reciben error 400; los candidatos con campos válidos pero problemas de acceso reciben `valid:false`. Editar un candidato o la cobertura invalida su validación anterior. Una respuesta atrasada tampoco valida ediciones posteriores.

Los cambios se aplican al iniciar otra ejecución. No se trasladan ocupantes ni reservas entre refugios a mitad de una ronda. Las capacidades y reservas de la ejecución activa siguen siendo autoritativas; proponer otra ficha no modifica esas plazas.

## Comparación A/B

Tras validar cuatro alternativas, pulsar **Comparar A/B**. El backend pausa la ejecución activa y ejecuta asincrónicamente dos simulaciones completas:

- A: cuatro refugios originales del grafo seleccionado.
- B: cuatro candidatos personalizados, incluidas sus capacidades.

Ambas reciben exactamente los mismos agentes, identidad, semilla, duración, lluvia, comportamiento y focos de exposición. La comparación se ejecuta acelerada en Go; no reproduce otro motor en React. Las latencias mostradas son el costo medio de `Step` completo, excluyendo las esperas visuales.

La semilla sola no bastaba: el generador existente excluye nodos con refugios al aparecer agentes. Por eso el laboratorio genera y congela la población sobre el grafo de competición y sus refugios originales **antes** de sustituir candidatos. Entrega esos agentes como `InitialSurvivors`. El manifiesto `origins` conserva ID y coordenadas geográficas fuente; al pasar al maestro se reutilizan sus nodos compartidos. Si faltara un ID, se aplicaría ajuste determinista limitado a 500 m o se rechazaría la ejecución. En los datos revisados, el cambio base→maestro registra ajuste de origen de cero metros.

También congela tres focos sobre la geografía base: uno artificial en `OSM-363647979`, elegido para estresar rutas, y dos determinados por semilla. Sus radios son 150–800 m y usan factor sintético 1. La posición del foco de estrés no es evidencia de inundación real. Este diseño conserva el campo de amenaza entre grafos y estrategias sin modificar el motor 4A.

Cada resultado lleva `origins_hash`, `config_hash`, denominador, semilla y modo. `config_hash` excluye los refugios e incluye los focos efectivos. React sólo acepta una comparación terminada si coinciden estos controles; el porcentaje usa `evacuados / total_agents` en ambos casos. Se muestran evacuación, aislamiento, tiempo medio entre quienes evacuaron, saturación, replanificaciones, bloqueos finales y latencia. Cambiar capacidades también cambia la estrategia; para aislar el efecto de ubicación hay que conservarlas.

El resultado vale para esa configuración artificial y ese horizonte. Una mayor evacuación en B no certifica instalaciones seguras ni demuestra superioridad general. Los agentes todavía en movimiento al finalizar tampoco se convierten en muertos o aislados automáticamente.

## Mapa e interacción

El proyecto no usaba una biblioteca externa: `WorldMap` era un renderer SVG propio. El mapa de inundación reutiliza esa tecnología sin añadir Leaflet, MapLibre ni otra dependencia. Conserva pan, zoom y navegación mediante flechas, `+`, `−` y `0`. Las geometrías OSM se proyectan a Mercator y se indexan una vez por grafo; un grid espacial permite inspeccionar aristas mediante clic. El campo **Inspeccionar arista** ofrece una alternativa por teclado con sugerencias acotadas.

Las calles se agregan en **tres paths SVG**, evitando miles de objetos React por calle. Las condiciones del snapshot actual reclasifican esos paths; los agentes se limitan a 200 y los refugios a cuatro. Sólo se dibuja la ruta seleccionada. El maestro conserva su geografía real y no cambia de dataset para mejorar artificialmente el rendimiento.

Las ocho capas son independientes: exposición azul, calles transitables, precaución amarilla, bloqueos rojos, rutas, agentes, refugios e incidentes. Los refugios disponibles se representan en verde. Los iconos, trazos, leyenda, estados textuales, tablas y descripciones aportan información adicional al color. La capa de incidentes queda vacía y preparada para FASE 4C; no se fabrican eventos.

El mapa base combina geometría OSM conservada con teselas raster opcionales. La atribución permanece visible. El proveedor predeterminado es `https://tile.openstreetmap.org/{z}/{x}/{y}.png`; se solicitan sólo teselas del viewport, con límite 32, sin precarga ni descarga offline, y se respetan la caché y el Referer del navegador. Esta integración sigue la [política oficial de teselas](https://operations.osmfoundation.org/policies/tiles/). Si falla el proveedor, permanecen la cartografía vectorial, datos y controles.

La línea temporal inspecciona métricas registradas sin fingir que retrocede el mapa o el motor. El mapa siempre corresponde al estado actual publicado. El backend conserva hasta 512 entradas mediante muestreo; el progreso sigue mostrando el reloj real.

## URLs, CORS y configuración

`src/services/api.ts` continúa siendo el único adaptador HTTP. Valida respuestas, tiempos, denominadores y versiones; conserva el request ID y traduce errores de red/API. TanStack Query hace polling de inundación cada 500 ms; AppShell observa su caché sin otro temporizador. Zombie conserva sus consultas de dos segundos.

```sh
# Arranque manual, alternativa al comando integrado:
npm run dev:flood:lab -- -listen 127.0.0.1:8082 -origin http://127.0.0.1:5173
VITE_WORLD_API_BASE_URL=http://127.0.0.1:8080 VITE_FLOOD_API_BASE_URL=http://127.0.0.1:8082 npm run dev --workspace @corodev/web -- --host 127.0.0.1
```

Usar el mismo hostname en React y laboratorio: `127.0.0.1` en ambos o `localhost` en ambos. Mezclar esos nombres puede impedir la cookie SameSite. El origen incluye esquema y puerto; para Vite en otro puerto hay que pasar ese origen al laboratorio. `npm run dev:lab` evita esta mezcla automáticamente.

Variables públicas:

| Variable | Uso |
| --- | --- |
| `VITE_WORLD_API_BASE_URL` | Instancia zombie; producción sigue siendo su valor predeterminado |
| `VITE_FLOOD_API_BASE_URL` | Laboratorio controlable; puerto local 8082 |
| `VITE_API_TIMEOUT_MS` | Límite del adaptador HTTP |
| `VITE_OSM_TILES_ENABLED=false` | Deshabilitar raster opcional conservando vectores OSM |
| `VITE_OSM_TILE_URL_TEMPLATE` | Proveedor HTTPS alternativo con `{z}/{x}/{y}` |

Las URLs rechazan credenciales, consultas y fragmentos; los mensajes no imprimen valores sensibles. Nunca colocar API keys en variables `VITE_`. El servidor de lectura 4A (`npm run dev:flood`, puerto 8081) se conserva, pero no ofrece los controles nuevos: para React 4B se usa **`dev:flood:lab`**.

El laboratorio exige binding literal de loopback, rechaza Host ajenos a loopback y verifica Origin. La fase móvil posterior permite iniciar/controlar tormentas, validar candidatos y comparar sin sesión de operador: `/lab/runs`, `/lab/actions`, `/lab/candidates/validate` y `/lab/comparisons`. Conserva `expected_run_id`, validaciones y exclusión mutua, con límites de 120 controles y 10 inicios/comparaciones por IP/minuto. Las mutaciones de moderación de incidentes y actualización de referencia conservan cookie HttpOnly y CSRF. La credencial interna de `/paso` nunca se envía al navegador. El controlador zombie no se modifica.

## Contratos nuevos

OpenAPI conserva todos los endpoints y schemas anteriores y añade:

| Operación | Función |
| --- | --- |
| `GET /lab/catalog` | Modos revisados, presets, defaults, originales y límites |
| `GET /lab/session` | Sesión local y CSRF en memoria |
| `GET /lab/state` | Estado coherente del controlador, escenario 4A, plazas, orígenes, timeline y A/B |
| `GET /lab/published` | Snapshot actual para espectadores, caché ETag, timeline vacío, sin comparación ni geografía |
| `GET /lab/graph?mode=…` | Previsualización del dataset solicitado |
| `GET /lab/graph?run_id=…` | Grafo efectivo de esa ejecución, incluidos candidatos |
| `POST /lab/runs` | Iniciar configuración real con `expected_run_id` |
| `POST /lab/actions` | `pause`, `resume`, `restart`, `repeat`, `speed` |
| `POST /lab/candidates/validate` | Validar cuatro ubicaciones contra el grafo |
| `POST /lab/comparisons` | A/B asíncrono con entradas congeladas |

`LabState.scenario` reutiliza `ScenarioSnapshot` de 4A. El grafo efectivo tiene una versión derivada de sus candidatos; las lecturas se asocian por `run_id` y `graph_version`. Cambiar ejecución limpia selección/rutas y la UI nunca mezcla un escenario activo con una previsualización diferente. No se descarga de nuevo el maestro por cada pausa o cambio de velocidad.

## Verificación y límites

```sh
npm run check
npm test
npm run build:web
npm run test:e2e
npm run test:lab:flood
npm run test:backend
npm run test:race
```

El checker 4B arranca Go y Chromium reales, valida JSON Schema, controles, pausa efectiva, candidatos, A/B, maestro, CORS y ausencia de credenciales en peticiones. Guarda informe y capturas en `deploy/evidence-private/phase4b-20261026/`. Las pruebas automatizadas deshabilitan las teselas públicas; sus capturas muestran los vectores OSM reales del repositorio. La política OSM no permite usar bots que desplacen/acerquen el mapa para descargar teselas. No se atribuye a esas capturas una verificación de disponibilidad del proveedor raster.

Los [resultados y archivos modificados](informe-fase4b.md) incluyen métricas reales de payload, DOM y memoria. El límite sigue siendo el laboratorio local, sin persistencia tras reiniciar proceso, sin directorio verificado de instalaciones y con el costo de clonar grafos del núcleo 4A. No se implementó 4C ni un despliegue, proxy o administración remota de este servicio. La nueva UI no activa automáticamente esta fase en la web publicada.
