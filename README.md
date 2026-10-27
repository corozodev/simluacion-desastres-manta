# CoroDev — Escape de Manta Zombie

FASE 2 de Track A: backend Go con simulación determinista, planificación dinámica, predicción observable de runners, reservas y clientes React/Flutter. La fuente urbana OSM de Manta tiene **9.179 nodos y 13.452 aristas**; el grafo operativo tiene **300 nodos y 383 aristas**, y el experimental **1.000 nodos y 1.599 aristas**. Los cuatro sectores son zonas de aparición con polígonos municipales: Tarqui, Los Esteros, Barbasquillo y Jocay. La navegación puede salir de ellas. Los cuatro refugios son ficticios. Los turnos duran dos segundos en modo normal y se ejecutan sin esperas en modo acelerado. Entrega prevista por el equipo: **28 de octubre de 2026, 10:00 Ecuador (UTC−05:00)**.

**Interfaz React MantaSim:** navegación directa entre `/escape` y `/flood-lab`, mapas compartidos, refugios editables y acceso de operador desde inundaciones. Consulta [cambios, validación y límites de esta iteración](docs/informe-mantasim-ux.md). No se despliega automáticamente.

**FASE 5: sesiones independientes bajo demanda.** Abrir React `/escape` carga el mapa y las capacidades sin ejecutar turnos. **Iniciar simulación** crea una sesión privada de zombies o inundación urbana sintética; Go avanza sus turnos y permite pausar, reanudar, cancelar y reiniciar. La recarga recupera la misma ejecución mediante una credencial en `sessionStorage`. Flutter conserva los endpoints Go anteriores y no recibe la clave de `/paso`. Consulta [arquitectura, API, pruebas y límites FASE 5](docs/informe-fase5.md).

**FASE 6A validada localmente:** sprites CC0 a 4 FPS, interpolación de recorridos comprobables, agrupación por zoom, focos de inundación, leyenda y controles de movimiento. Incluye símbolos estáticos Flutter y evidencia desktop/móvil. [Implementación, recursos, pruebas y límites](docs/informe-fase6a.md).

[Abrir Escape en AWS](https://sistemamanta.lexinnovate.com/escape) · [API HTTPS](https://api.sistemamanta.lexinnovate.com/healthz). **FASE 5 desplegada el 27 de octubre:** `m7i-flex.large`, 2 vCPU / 8 GiB, cuatro sesiones activas con hasta una FULL_MANTA. El propietario mantuvo el plan FREE y elevó el Budget a 50 USD. **Retirada AWS programada a partir del 31 de octubre, 01:46 de Ecuador**, incluidos disco y versiones S3. Ver [despliegue, comprobaciones, alcance y cancelación](docs/despliegue-fase5-y-caducidad.md).

## Inicio local

Requiere Node.js ≥22.12, npm ≥10, Go ≥1.23 y Python 3. Flutter/Dart sólo se necesitan para móvil. Los scripts detectan Go en `/usr/local/go/bin/go`; aceptan `GO_BIN`. Flutter debe estar en PATH o `FLUTTER_BIN`.

Desde `corodev-spooky`:

```sh
npm install
npm run contracts:generate
npm run tokens:generate
```

Terminal 1, servidor Go preparado sin simulación activa. La clave sólo vive en el servidor:

```sh
export API_KEY="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
npm run dev:backend
```

Terminal 2, React observando ese Go local:

```sh
VITE_WORLD_API_BASE_URL=http://127.0.0.1:8080 npm run dev:web
```

Abre `http://localhost:5173/escape`. La raíz y las rutas retiradas redirigen a Escape. Sin un override explícito, web y móvil utilizan la API HTTPS de AWS. No hay fallback de datos cuando Go falla: se presenta el error y se permite reintentar. `npm run dev:api` es un alias del servidor Go.

En `/escape`, configura el grafo, los agentes, la ronda y los refugios y pulsa **Iniciar simulación**. El brote zombi es fijo; semilla y turnos están en **Configuración avanzada**. Inundaciones tiene su entrada propia en la barra lateral. El cliente consulta su sesión aproximadamente cada dos segundos mientras está activa; Go continúa sin depender del polling. Los valores predeterminados son 150 turnos de 2 s y BASE (300 nodos). FULL_MANTA requiere `ENABLE_FULL_MODE=true` y conserva un cupo experimental propio. Reiniciar el proceso pierde las sesiones en RAM y vuelve a esperar un inicio explícito. Los puertos locales de desarrollo no cambian los puertos públicos de AWS.

```sh
curl http://127.0.0.1:8080/healthz
curl http://127.0.0.1:8080/estado
curl http://127.0.0.1:8080/grafo
curl http://127.0.0.1:8080/v1/simulations/capabilities
```

## Simulación y medición

No requieren servidores previamente iniciados ni clave manual: cada comando crea un servidor HTTP temporal, genera una clave efímera, consulta realmente `/paso` y cierra el proceso al terminar.

```sh
npm run simulate -- -scenario scenarios/urban/round1.json -output reports/phase2/current-round1.json
npm run simulate -- -scenario scenarios/urban/round2.json -output reports/phase2/current-round2.json
npm run simulate -- -scenario scenarios/urban/round3.json -output reports/phase2/current-round3.json
npm run bench:backend -- -requests 10000 -concurrency 16 -output reports/phase2/http-16.json
npm run bench:backend -- -requests 10000 -concurrency 200 -burst -output reports/phase2/http-burst-200.json
```

Los argumentos de ruta son relativos a `services/evacuation`. Las rondas tienen 20/80/200 sobrevivientes y 150 turnos. Cantidades de zombies, semillas y eventos están en JSON editable; son supuestos de prueba. Ronda 2 simula el colapso de un puente identificado por OSM; ronda 3 bloquea dos calles.

`simulate` acepta `-graph`, `-seed`, `-concurrency`, `-turns` y `-interval 2s`; el intervalo predeterminado es cero. Los eventos deben quedar dentro de los turnos configurados. Las métricas incluyen evacuados, mordidos, activos, turnos, solicitudes exitosas/inválidas/fuera de plazo, disponibilidad y latencia HTTP p50/p95/p99. El benchmark usa un snapshot estable tras calentamiento; las rondas también miden invalidaciones dinámicas. Ver [informe FASE 2](docs/informe-fase2.md) y [metodología](docs/pruebas.md).

## Contrato y pruebas

`POST /paso` exige `x-api-key` y exactamente este cuerpo:

```json
{"sobrevivienteId":"S-0089","nodoActual":"N-0117","turno":142}
```

Responde únicamente `{"siguienteNodo":"N-0118"}`. IDs y turno deben corresponder al snapshot; el mapa real utiliza IDs `OSM-...`. Un movimiento cruza como máximo una arista transitable o mantiene el nodo. Las consultas no mutan el mundo. Nunca introducir la clave en React, Flutter, `VITE_` ni `--dart-define`.

La prueba de contrato genera su propia clave y prueba `/paso` por HTTP real:

```sh
npm run test:contracts:http
npm run test:contracts:simulations
npm run test:simulations:browser
npm run check
npm test
npm run build:web
npm run build:api
npm run test:backend
npm run test:race
npm run build:backend
npm run graph:test
```

También: `go vet ./...` desde `services/evacuation`. OpenAPI genera TypeScript, Dart y JSON Schema draft-07. Ver [contratos](docs/contratos.md), [reglas](docs/reglas-simulacion.md) y [algoritmo](docs/algoritmo.md).

## Grafo offline

El runtime carga JSON local sin consultar OSM. Regeneración exacta de la instantánea versionada, sin dependencias Python:

```sh
npm run graph:generate
npm run graph:test
```

Adquirir una instantánea nueva explícitamente:

```sh
python3 tools/geo/urban_manta.py --download
```

`tools/geo/speeds.json` configura velocidades peatonales por vía. Entrada comprimida, checksum, fuentes municipales, geometrías y recorridos por arista están en `services/evacuation/data/manta*`. El maestro representa la red urbana peatonal relevante; el operativo es una muestra conectada de aproximadamente 300 intersecciones y representa 4,44% de la longitud vial del maestro. No se ocultan intersecciones reales dentro de una arista. La envolvente mostrada en el mapa es una referencia visual, no un límite oficial de ciudad. Los refugios no son instalaciones oficiales de emergencia. Datos © OpenStreetMap contributors, ODbL-1.0. Ver [procedencia y supuestos FASE 2](docs/grafo-fase2.md).

## Flutter

El cliente inicia directamente Escape y utiliza `https://api.sistemamanta.lexinnovate.com` por defecto:

```sh
cd apps/mobile
flutter pub get
flutter run
```

Para una instancia Go local en emulador Android:

```sh
flutter run --dart-define=WORLD_API_BASE_URL=http://10.0.2.2:8080
```

Iniciar Go con `LISTEN_ADDR=0.0.0.0:8080 npm run dev:backend` para permitir el acceso desde el emulador o la LAN. Flutter web/escritorio puede utilizar `http://127.0.0.1:8080`; un dispositivo físico necesita una dirección accesible. El override contiene una URL pública de observación, nunca credenciales.

Desde la raíz, con Flutter en PATH o `FLUTTER_BIN`:

```sh
npm run mobile:check
npm run mobile:test
npm run mobile:build
# Requiere una instancia Go accesible mediante WORLD_API_BASE_URL:
npm run mobile:integration
```

El APK debug actualizado está en `apps/mobile/build/app/outputs/flutter-apk/app-debug.apk`, excluido de Git. Un APK compilado no demuestra una sesión en dispositivo; iOS no está preparado.

## Variables Go

| Variable | Predeterminado / uso |
| --- | --- |
| `API_KEY` | Obligatoria; solo servidor; nunca se imprime |
| `LISTEN_ADDR` | `127.0.0.1:8080` |
| `GRAPH_PATH` | `data/manta-v2.json`; cambiar junto al escenario |
| `SCENARIO_PATH` | `scenarios/urban/round1.json` |
| `SIM_AUTOSTART` | `false`; `true` impide el arranque para evitar ejecuciones accidentales |
| `SIM_INTERVAL` | `2s`; intervalo del runtime legacy, que permanece inactivo |
| `SIM_TURNS` | `150` en el catálogo; el cliente configura `max_ticks` dentro del límite público |
| `SIM_SEED` | JSON del escenario |
| `SIM_CONCURRENCY` | JSON del escenario: 16/16/32 |
| `PREDICTION_ENABLED` | `true`; comparación sin predicción disponible |
| `RISK_WEIGHT` / `PREDICTION_WEIGHT` | `0.6` / `12`, riesgos estimados, no garantías |
| `CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` |
| `SIM_MAX_ACTIVE` / `SIM_MAX_FULL_ACTIVE` | `2` / `1`; cupos de sesiones en ejecución o pausa |
| `SIM_MAX_RETAINED` / `SIM_MAX_MEMORY_MB` | `8` / `128`; sesiones totales y presupuesto estimado reservado |
| `SIM_DEFAULT_TICK_INTERVAL` / `SIM_DEFAULT_MAX_TICKS` | `2s` / `150`; valores por defecto de la API de sesiones |
| `SIM_IDLE_TTL` / `SIM_PAUSED_TTL` | `2m` / `5m`; abandono y pausa |
| `SIM_COMPLETED_TTL` / `SIM_MAX_WALL_TIME` | `15m` / `15m`; retención final y duración máxima |
| `SIM_RATE_LIMIT_PER_MINUTE` / `SIM_CREATE_LIMIT_PER_MINUTE` | `120` / `10`; solicitudes y creaciones por dirección remota |
| `ENABLE_FULL_MODE` | `false`; habilitar el maestro experimental sólo tras medir su presupuesto |

Go no carga `.env` automáticamente: exportar variables. Web usa únicamente `VITE_WORLD_API_BASE_URL` y móvil `WORLD_API_BASE_URL`, ambas URLs públicas sin credenciales. El generador Dart selecciona los modelos alcanzables desde las cuatro operaciones Go; el contrato compartido histórico se conserva.

## Estructura y continuidad

| Ruta | Responsabilidad |
| --- | --- |
| `services/evacuation/cmd/{server,sim,bench}` | Servidor, simulación acelerada y benchmark HTTP |
| `services/evacuation/internal/{world,graph,simulation,decision,httpapi,application}` | Modelos, datos, reglas, rutas, HTTP y composición |
| `services/evacuation/internal/sessions` | Sesiones privadas, lifecycle, seguridad, cuotas y resultados |
| `services/evacuation/{data,scenarios,reports}` | OSM, rondas y mediciones |
| `apps/web`, `apps/mobile` | Clientes existentes con Escape |
| `services/mock-api` | Demo conservada y observación sintética |
| `packages/contracts`, `packages/design-tokens` | Contratos e identidad compartidos |
| `tools/{codegen,geo,qa,scripts}` | Generación, importación, QA y comandos |

Leer [diagnóstico geográfico](docs/diagnostico-geografico.md), [diagnóstico de supervivencia](docs/diagnostico-supervivencia.md), [arquitectura](docs/arquitectura.md), [informe FASE 2](docs/informe-fase2.md), [AWS histórico](docs/despliegue-aws.md), [AWS FASE 5 y caducidad](docs/despliegue-fase5-y-caducidad.md) y [costos estimados](docs/costos.md). El [informe histórico FASE 1](docs/informe-fase1.md) permanece intacto. Las evidencias distinguen mediciones públicas y pruebas locales de cada entrega.


## Comparaciones controladas

```sh
# Motor histórico congelado; mismas posiciones y refugios geográficos remapeados.
npm run evaluate -- -graphs data/manta-v1.json -strategies phase1 -output reports/phase2/baseline
npm run evaluate -- -graphs data/manta-v2.json -strategies phase1 -output reports/phase2/geography
npm run evaluate -- -graphs data/manta-expanded.json -strategies phase1 -output reports/phase2/expanded-geography
# Mismo v2 y estado inicial por ronda/semilla: motor, predicción y reservas.
npm run evaluate -- -protocol urban -graphs data/manta-v2.json -strategies phase1,improved,no-prediction,no-reservations -output reports/phase2/urban
```

Cada comando usa las tres rondas, 150 turnos y semillas predeclaradas `historical,7,42`. `historical` corresponde a 20261026/20261027/20261028 según ronda. JSON/CSV incluyen estado inicial, hashes, remapeos, diagnóstico, evacuados, vivos, inmovilidad, eficiencia y tiempos separados. Los diagnósticos son **privados**: pueden incluir posiciones iniciales de sleepers; nunca publicarlos mediante web/S3/endpoints.

La comparación geográfica mantiene refugios históricos remapeados. Los escenarios urbanos cambian deliberadamente a aparición equilibrada por zonas y nuevos refugios; sus cifras no pueden atribuirse solo al algoritmo. El motor histórico existe exclusivamente para evaluación. Cargar `manta-v1` en el servidor actual no restaura automáticamente el algoritmo anterior.

Elegir variantes explícitamente:

```sh
npm run simulate -- -graph data/manta-v2.json -scenario scenarios/urban/round3.json
npm run simulate -- -graph data/manta-expanded.json -scenario scenarios/urban/round3.json
npm run test:contracts:http -- --urban
FLUTTER_BIN=/ruta/flutter/bin/flutter npm run test:contracts:http -- --urban --browser --flutter
```

Los pesos de aparición se editan en `scenarios/urban/*.json`; los valores iniciales iguales son supuestos, no instrucciones oficiales del jurado. Las capacidades se editan en el grafo. No se modifican las reglas zombie para elevar resultados. La variante ampliada no sustituye automáticamente el grafo operativo de competición.


## Despliegue FASE 3A.2 — 26 de octubre de 2026

**CREATE_COMPLETE, 14 recursos**, exclusivamente mediante `phase3a2-20261026T211726Z`, autorizado por el propietario. No se alteraron sus hashes, plantilla, parámetros o estimación. EC2 t3.small, EBS cifrado, EIP, grupo público sólo 80/443, rol runtime limitado, SSM, buckets privados, CloudFront/OAC, logs siete días y alarma CPU. AdministratorAccess corresponde al operador por elección expresa del propietario; no a EC2.

- React: https://sistemamanta.lexinnovate.com/escape
- API: https://api.sistemamanta.lexinnovate.com
- Cloudflare: CNAME web a CloudFront y A API a `77.112.199.249`, ambos DNS only. Certificados independientes Amazon/Let's Encrypt válidos.
- GET healthz/grafo/estado: 200. POST /paso autorizado: 200; sin clave o clave incorrecta: 401; rutas administrativas: 404.
- Probe externo: 30 éxitos en 41 intentos, 11 conflictos de turno reintentados, 0 errores/timeouts en la corrida completa. p50 364,43 ms; p95 384,72 ms; p99/máximo 524,49 ms. Los intentos iniciales fallidos por resolución/red se conservan. Se utilizó DNS público explícito por cachés inconsistentes del ISP, manteniendo TLS estricto.
- CloudWatch recibió logs reales sin la API key. No se encontró OTel ni se añadió observabilidad nueva.

**Estimación: 22,96 USD/mes**; reserva 24 USD. Budget existente **30 USD**, HEALTHY, avisos reales 85%/100% y previsto 100%, con email. Último gasto informado **0,00 USD**, con fecha de actualización anterior al despliegue y posible retraso: no representa una factura final ni recursos sin costo. El Budget no detiene cargos. [Costos](docs/costos.md).

La simulación existente termina en 150 turnos y conserva el snapshot final. Un reinicio vuelve a la semilla y pierde la RAM; no se añadió reproducción automática. Se verificó un reinicio controlado para coordinar la prueba del navegador. React avanzó de turno y 60 marcadores cambiaron posición; zoom/selección y ancho móvil pasaron sin errores de red/JavaScript. Al cierre ambos dominios también respondieron 200 por HTTPS con DNS normal del equipo, sin overrides. FASE 3B.1 retiró posteriormente esas pantallas y sus adaptadores de ambos clientes; Flutter mantiene su APK local sin prueba física nueva.

Se conservaron los artefactos y resultados locales previos, sin repetir la batería de pruebas o los experimentos de FASE 2. [Informe de despliegue](docs/despliegue-aws.md), [evidencia consolidada](deploy/validation-phase3a2-deployment.json) y [probe público](deploy/validation-phase3a-public.json). La API_KEY se generó en EC2 y sólo se compartió cifrada con el cliente externo autorizado; nunca se publica en React, Flutter, comandos o logs.

Git conserva commits reales con fechas auténticas y está publicado en [corozodev/simluacion-desastres-manta](https://github.com/corozodev/simluacion-desastres-manta), usando el remoto configurado por el propietario. La evidencia privada, parámetros, credenciales, bundles y builds permanecen excluidos. La entrega de alertas Budget y una captura auténtica de consola siguen sin confirmar; su configuración sí se verificó por API. FASE 3B.2 añade catálogo y selector local; el rollout AWS requiere autorización separada.

## Integración y diagnóstico FASE 3B.1

La retirada del servidor anterior se aplicó en React y Flutter, incluyendo configuración, pantallas, navegación y modelos Dart generados sin uso. Se conserva la apariencia de Escape y el contrato Go. Las referencias del servicio histórico y los informes FASE 1/2 permanecen en su ámbito original; ningún cliente los importa ni consulta.

El diagnóstico distingue el procesamiento Go, la duración dentro de Caddy, el HTTPS desde EC2 y el cliente de Ecuador. Con el snapshot final estable, reutilizar conexiones redujo la mediana del cliente de aproximadamente 361 a 113–115 ms. El navegador ya utiliza conexiones persistentes; esto corrige la metodología del probe y no demuestra una aceleración del motor. La cola del lote posterior conservó un máximo de 606 ms: no se garantiza un máximo externo de 500 ms.

Se usaron hooks existentes y registros Caddy sanitizados temporales, sin OTel nuevo, agente, IAM o infraestructura adicional. No se reinició el backend de producción ni se cambió el algoritmo. Las cifras, controles, archivos publicados y commits están en [docs/informe-fase3b1.md](docs/informe-fase3b1.md) y la [metodología de latencia](docs/latencia-aws-fase3b1.md). No se inicia FASE 3B.2 automáticamente.

## Simulación multigrafo FASE 3B.2

React distingue previsualización de inicio real. Competición (300/383) conserva prioridad; el maestro (9.179/13.452) y el ampliado (1.000/1.599) son experimentales. El control autenticado sólo inicia entre rondas, usa sesión HttpOnly/CSRF independiente de `/paso` y conserva diez finales observables en RAM. Los visitantes siguen en modo lectura.

El maestro se evalúa por compatibilidad, comportamiento y costo, sin exigirle el rendimiento del preset oficial ni cambiar reglas para favorecerlo. No se habilitan experimentales ni se reemplaza la EC2 automáticamente. Véanse [operación](docs/operacion-multigrafo.md) e [informe y mediciones](docs/informe-fase3b2.md).

## Inundaciones urbanas experimentales — FASE 4A

`npm run simulate:flood` ejecuta lluvia, exposición espacial y drenaje sobre el grafo oficial. `npm run dev:flood` sirve la API experimental en `127.0.0.1:8081`, con polling de `/v1/scenario`. El motor y servidor zombie conservan sus reglas y catálogo.

Los escenarios de inundación emplean parámetros sintéticos y no constituyen pronósticos hidrológicos ni recomendaciones oficiales de evacuación.

La [guía del modelo y contrato React 4B](docs/urban-flood.md) incluye parámetros, límites, procedencia y reproducción. El [informe FASE 4A](docs/informe-fase4a.md) registra pruebas, mediciones, archivos y riesgos. No se despliega esta fase automáticamente.

## Laboratorio interactivo React — FASE 4B

`npm run dev:lab` arranca React y los dos servicios locales sin iniciar simulaciones. Abrir `http://127.0.0.1:5173/escape` para las sesiones independientes; el laboratorio avanzado se conserva en `http://127.0.0.1:5173/flood-lab` (también en el enlace histórico `?scenario=urban_flood`). Allí **Iniciar tormenta** permite pausar/continuar el motor, cambiar parámetros y grafo, validar cuatro refugios candidatos y ejecutar su comparación A/B con orígenes congelados.

Conserva el escenario zombie y añade ocho capas, inspección de calles, rutas, métricas y timeline. El maestro usa la geografía real revisada; las calles de inundación se agrupan en tres paths SVG. No se modifica el servidor publicado ni se despliega esta fase automáticamente. Ver [uso y contratos](docs/laboratorio-inundaciones.md), [resultados y capturas](docs/informe-fase4b.md).

## Reportes ciudadanos georreferenciados — FASE 4C

Flutter permite **Nueva novedad** desde el mapa: marcador manual o GPS Android con permiso explícito, revisión, confirmación y reintento idempotente. Go guarda el reporte en un directorio privado persistente; React muestra una capa separada con tipo, procedencia, estado y antigüedad. **Reporte ciudadano pendiente de verificación** permanece visible aunque un operador aplique el incidente al laboratorio.

La acción **Aplicar incidente a simulación** requiere sesión local/CSRF, ejecución experimental esperada y confirmación explícita. Añade un overlay temporal, replanifica sin avanzar el paso y conserva auditoría, sin alterar el grafo base ni el escenario zombie. No ofrece navegación real de emergencia ni convierte reportes en hechos oficiales.

`npm run dev:lab` conserva los reportes en `services/evacuation/private/incidents`. `FLUTTER_BIN=/ruta/flutter/bin/flutter npm run test:incidents:e2e` reproduce Flutter → Go → reinicio → React → cierre y desvío verificable. Ver [guía y endpoints](docs/incidentes-ciudadanos.md), [resultados y límites](docs/informe-fase4c.md) y [decisión de persistencia/costo](docs/decisions/ADR-004-incidentes-persistencia.md). No se realiza push ni despliegue automático.

## Referencia oficial, procedencia y modo offline — FASE 4D

El laboratorio incorpora una capa independiente de **Susceptibilidad oficial a inundaciones**, con 59 polígonos SNGR para la envolvente de Manta, atribución CONAGE 2024, fecha, CRS y versión local verificable. La copia incluye 16 eventos históricos por lluvias, separados de carreteras y reportes ciudadanos. No representa inundación actual ni ofrece predicción hidrológica.

**Usar susceptibilidad geográfica como referencia** permite un experimento opcional con pesos adimensionales por clase, manteniendo lluvia sintética, semilla y grafo. Cada ejecución fija su versión y registra las intersecciones. `npm run dev:lab` funciona sin Internet con la copia versionada; una fuente ausente deja disponible el modo totalmente sintético. `LAB_REFERENCE_ONLINE=true` habilita actualización externa asíncrona; no se despliega automáticamente.

`npm run test:references:e2e` valida Go/React reales en 300 y 9.179 nodos, polígonos, modo offline, procedencia e independencia del escenario zombie. Ver [fuentes, endpoints y demos A–E](docs/datos-oficiales-y-demo.md), [pruebas y benchmarks](docs/informe-fase4d.md) y [copia de datos](services/evacuation/data/reference/README.md).
