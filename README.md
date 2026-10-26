# CoroDev — Escape de Manta Zombie

FASE 2 de Track A: backend Go con simulación determinista, planificación dinámica, predicción observable de runners, reservas y clientes React/Flutter. La fuente urbana OSM de Manta tiene **9.179 nodos y 13.452 aristas**; el grafo operativo tiene **300 nodos y 383 aristas**, y el experimental **1.000 nodos y 1.599 aristas**. Los cuatro sectores son zonas de aparición con polígonos municipales: Tarqui, Los Esteros, Barbasquillo y Jocay. La navegación puede salir de ellas. Los cuatro refugios son ficticios. Los turnos duran dos segundos en modo normal y se ejecutan sin esperas en modo acelerado. Entrega prevista por el equipo: **28 de octubre de 2026, 10:00 Ecuador (UTC−05:00)**.

Se conservan la API mock, las pantallas demo y el tema compartido. FASE 3A.2 preparó CloudFormation para Ohio, Budget existente y dominios HTTPS. El reintento verifica Budget, red pública y AMI; aún faltan permisos CloudFormation/ACM/CloudFront y cuotas, además del DNS pendiente de Cloudflare. No hay change set ni despliegue público. El repositorio conserva un primer commit local con fechas auténticas tras escanear secretos; sin remoto definido ni publicación. Consulta el [último preflight real](deploy/validation-phase3a2-retry.json).

## Inicio local

Requiere Node.js ≥22.12, npm ≥10, Go ≥1.23 y Python 3. Flutter/Dart solo se necesitan para móvil. Los scripts detectan Go en `/usr/local/go/bin/go`; aceptan `GO_BIN`. Flutter debe estar en PATH o `FLUTTER_BIN`.

Desde `corodev-spooky`:

```sh
npm install
npm run contracts:generate
npm run tokens:generate
```

Terminal 1, motor y simulación normal. La clave solo vive en el servidor:

```sh
export API_KEY="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
npm run dev:backend
```

Terminal 2, mock para conservar las pantallas demo:

```sh
npm run dev:api
```

Terminal 3, React observa el backend real mientras las demos usan el mock:

```sh
VITE_WORLD_API_BASE_URL=http://localhost:8080 npm run dev:web
```

Abre `http://localhost:5173/escape`: grafo, turno, contadores, refugios, conexión y búsqueda de sobrevivientes. El estado se consulta cada dos segundos. Go escucha en `127.0.0.1:8080`; el mock, en `127.0.0.1:3001`. El backend conserva el snapshot final después de 150 turnos. Reiniciar el proceso reinicia el escenario; `Ctrl+C` lo cierra.

Para fixtures sintéticas de desarrollo, inicia solo mock y web sin `VITE_WORLD_API_BASE_URL`. Su fuente se identifica como sintética; no representa Manta real.

```sh
curl http://localhost:8080/healthz
curl http://localhost:8080/estado
curl http://localhost:8080/grafo
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

```sh
cd apps/mobile
flutter pub get
flutter run --dart-define=API_MODE=mock --dart-define=API_BASE_URL=http://10.0.2.2:3001 --dart-define=WORLD_API_BASE_URL=http://10.0.2.2:8080
```

Para emulador Android, iniciar cada servicio desde la raíz en interfaces accesibles: `HOST=0.0.0.0 npm run dev:api` y `LISTEN_ADDR=0.0.0.0:8080 npm run dev:backend`. En Flutter web/escritorio usar `localhost`; en dispositivo físico, la IP LAN. Escape permite consultar un sobreviviente y conserva navegación, Riverpod/Dio, tema y repositorio demo. Sin `WORLD_API_BASE_URL` se utiliza el mismo mock HTTP. No se necesitan credenciales privilegiadas en el cliente.

Desde la raíz, con Flutter en PATH o `FLUTTER_BIN`:

```sh
npm run mobile:check
npm run mobile:test
npm run mobile:build
```

Un APK compilado no demuestra una sesión en dispositivo. iOS no está preparado. Se conserva la [configuración Android previa](docs/development/local-setup.md).

## Variables Go

| Variable | Predeterminado / uso |
| --- | --- |
| `API_KEY` | Obligatoria; solo servidor; nunca se imprime |
| `LISTEN_ADDR` | `127.0.0.1:8080` |
| `GRAPH_PATH` | `data/manta-v2.json`; cambiar junto al escenario |
| `SCENARIO_PATH` | `scenarios/urban/round1.json` |
| `SIM_INTERVAL` | `2s`; `0s` acelera |
| `SIM_TURNS` | JSON del escenario, normalmente 150 |
| `SIM_SEED` | JSON del escenario |
| `SIM_CONCURRENCY` | JSON del escenario: 16/16/32 |
| `PREDICTION_ENABLED` | `true`; comparación sin predicción disponible |
| `RISK_WEIGHT` / `PREDICTION_WEIGHT` | `0.6` / `12`, riesgos estimados, no garantías |
| `CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` |

Go no carga `.env` automáticamente: exportar variables. Web usa `VITE_API_BASE_URL` para demo y `VITE_WORLD_API_BASE_URL` para el mundo; móvil usa `API_BASE_URL` y `WORLD_API_BASE_URL`. URLs públicas sin credenciales.

## Estructura y continuidad

| Ruta | Responsabilidad |
| --- | --- |
| `services/evacuation/cmd/{server,sim,bench}` | Servidor, simulación acelerada y benchmark HTTP |
| `services/evacuation/internal/{world,graph,simulation,decision,httpapi,application}` | Modelos, datos, reglas, rutas, HTTP y composición |
| `services/evacuation/{data,scenarios,reports}` | OSM, rondas y mediciones |
| `apps/web`, `apps/mobile` | Clientes existentes con Escape |
| `services/mock-api` | Demo conservada y observación sintética |
| `packages/contracts`, `packages/design-tokens` | Contratos e identidad compartidos |
| `tools/{codegen,geo,qa,scripts}` | Generación, importación, QA y comandos |

Leer [diagnóstico geográfico](docs/diagnostico-geografico.md), [diagnóstico de supervivencia](docs/diagnostico-supervivencia.md), [arquitectura](docs/arquitectura.md), [informe FASE 2](docs/informe-fase2.md), [AWS](docs/despliegue-aws.md) y [costos estimados](docs/costos.md). El [informe histórico FASE 1](docs/informe-fase1.md) permanece intacto. FASE 3A.2 verificó autenticación y validaciones locales; faltan permisos de lectura y aprobación de un change set concreto. No se inició FASE 3B.


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

**Preparación local; acceso AWS pendiente.** Perfil existente `default`, identidad IAM no root y cuenta/región autorizadas comprobadas por STS. Ya se verificaron el Budget real, sus avisos/destinatarios, VPC/subred pública y AMI AL2023 x86_64. Aún se deniegan CloudFormation, ACM, CloudFront y consultas de cuotas/plan. Cloudflare sigue pendiente; no se creó ni ejecutó un change set.

La plantilla reutiliza el Budget externo, configura alias `sistemamanta.lexinnovate.com`, exige ACM emitido en `us-east-1` y mantiene API `api.sistemamanta.lexinnovate.com` con Caddy. Los parámetros privados de VPC/subred/AMI/Budget están completados; el ARN del certificado sigue pendiente. DNS confirma Cloudflare; los nombres todavía no tienen A/CNAME.

Estimación pequeña para **us-east-2: 22,96 USD/mes**; reserva 24 USD, sin descuentos/impuestos. `t3.medium` subiría a 38,15 USD. El Budget mensual de **30 USD está verificado**, con avisos reales al 85%/100% y previsto al 100%, todos con email. Informa gasto acumulado de **0,00 USD**, con posible retraso. El Budget no detiene cargos. Ver [costos y fuentes](docs/costos.md).

Pasaron checks, tests React/mock/Go, Docker, Caddy sin red, integración Chromium/Dart y Flutter analyze/tests/APK. Son verificaciones locales. No hay latencias públicas AWS, HTTPS externo o logs CloudWatch comprobados. El probe conserva métricas parciales de errores/timeouts. No se modificaron algoritmos, grafos, simulación ni contratos.

El [complemento de permisos de preparación](deploy/prepare-changeset-policy.example.json) y su [explicación](docs/aws-preflight-permisos.md) documentan el acceso faltante. La copia con cuenta real queda privada; no se aplicaron permisos desde el agente. El [procedimiento](docs/despliegue-aws.md) incluye los 14 recursos previstos, DNS/certificados, aprobación específica, publicación y rollback. Sin remoto Git definido ni publicación pública; el destino requiere autorización. No enviar claves por chat ni publicar .env/evidencia privada. No se inició FASE 3B.
