# Despliegue y operación AWS

[Índice](INDEX.md) · [Arquitectura](arquitectura.md) · [Costos](costos.md) · [Pruebas](pruebas.md)

Esta guía describe la infraestructura existente y la preparación local de una
release. La versión vigente de frontend, API y laboratorio es `e8459c7`, publicada
el 28 de octubre de 2026 con autorización expresa: [registro de movilidad](../deploy/deployment-mobility-20261028.json).
La entrega base desplegó el commit `47f51fa` el 27 de octubre de 2026;
[registro y verificaciones](../deploy/deployment-delivery-20261027.json). El ajuste
CloudWatch posterior actualizó los binarios API/laboratorio desde un árbol local
basado en `a8fdc64`; sus fuentes ya forman parte de la imagen vigente. [Evidencia histórica y hashes](../deploy/observability/verification-20261027.json).
Sustituir servicios interrumpe sesiones en RAM y requiere autorización
expresa del propietario para la cuenta/región y el cambio concreto.

## Estado respaldado por evidencia

| Elemento | Configuración registrada |
| --- | --- |
| Web React | [Escape](https://sistemamanta.lexinnovate.com/escape), [laboratorio](https://sistemamanta.lexinnovate.com/flood-lab), [visor móvil](https://sistemamanta.lexinnovate.com/mobile); S3 privado + CloudFront/OAC |
| API | [HTTPS /healthz](https://api.sistemamanta.lexinnovate.com/healthz); Caddy → Go; el puerto 8080 no es público |
| Stack / región | `corodev-phase2`, `us-east-2` (Ohio); ACM de CloudFront en `us-east-1` |
| Instancia registrada | `i-05fd56f1bcb3b1aba`, **m7i-flex.large, 2 vCPU / 8 GiB**, Linux/amd64; raíz gp3 cifrada de 20 GiB |
| Docker backend | 4 GiB, 2 CPU; `GOMAXPROCS=2`, `GOMEMLIMIT=3GiB`; un escritor por simulación |
| Docker laboratorio | 768 MiB, 0,5 CPU; listener `127.0.0.1:8082`, comparte namespace de red con backend |
| Persistencia | Reportes y referencia en `/var/lib/corodev/flood`, fuera de imágenes; sesiones sólo en RAM |
| Gestión | CloudFormation, SSM sin SSH público, CloudWatch Logs con retención de siete días y alarma CPU |
| Budget externo | 50 USD/mes, HEALTHY, confirmado por lectura el 28 de octubre; avisa, no limita cargos |
| Externos a AWS | DNS Cloudflare; certificado de la API Let's Encrypt gestionado por Caddy; datos OSM/GeoManta/SNGR |

Fuentes: [resize y límites](../deploy/validation-phase5-deployment.json),
[última publicación registrada](../deploy/deployment-mobility-20261028.json),
[plantilla](../deploy/aws/stack.yaml) y [perfil operativo](../deploy/backend.phase5-ec2.env.example).
La publicación vigente usa una imagen Linux/amd64 identificada por el commit
`e8459c7`; se retiraron exclusivamente los montajes read-only de los ejecutables
anteriores para que no ocultaran los nuevos binarios. Se conservaron variables,
límites, logs, datos y contenedores anteriores para reversión. React sirve el
build HTTPS nuevo: las tres rutas y sus 16 assets se comprobaron por SHA-256,
con invalidación CloudFront completada. Una sonda PRO de ocho agentes avanzó tres
turnos, se pausó y quedó cancelada; `/paso` mantuvo 401/200 y su respuesta exacta.
No se midió capacidad ni p95. Los GET
públicos a `/escape` y `/healthz` devolvieron 200 durante la auditoría inicial,
con DNS/TLS normales. El despliegue posterior añadió las comprobaciones HTTP
funcionales acotadas descritas en el registro de entrega. La lectura AWS
del 27 de octubre, aproximadamente 18:58 de Ecuador, confirmó identidad vigente
no-root, la instancia exacta en ejecución en `us-east-2a`, `m7i-flex.large`,
2 vCPU/8 GiB y único EBS gp3 cifrado de 20 GiB adjunto. Se usaron STS,
DescribeInstances, DescribeInstanceTypes y DescribeVolumes sin cambios. Los IDs
de cuenta/ARN no se publican. Esta lectura no verifica configuración interna
actual de Docker ni capacidad bajo carga; revalidar antes de operar.

8 GiB es capacidad de memoria, no CPU adicional. La prueba AWS histórica de
cuatro sesiones duró tres turnos; no certifica carga sostenida. Las mediciones
locales con `GOMAXPROCS=2` tampoco equivalen a esta EC2.

La comprobación histórica de limpieza del 27 de octubre recompiló ambos binarios Go y
comparó sus SHA-256 con los ejecutables activos por SSM: coincidieron exactamente.
El código del frontend no había cambiado y el HTML público coincidía con la entrega base;
API y web respondieron 200. En aquella limpieza **no se necesitó redespliegue ni reinicio**.
La configuración del agente también coincidía. Aquellos labels conservaban el commit base
con el que se compilaron originalmente; los hashes identifican los binarios reales.
[Registro de comparación](../deploy/observability/verification-20261027.json).

## Desarrollo local

La demo web funciona sin AWS, Docker ni Flutter. Se requieren Node ≥22.12, npm ≥10, Go ≥1.23 (`services/evacuation/go.mod`), Python 3 y GNU Make. `GO_BIN` y `FLUTTER_BIN` admiten ejecutables fuera de PATH.

### Arranque y cierre

Desde la raíz:

```sh
make help
make setup
make dev
```

`setup` comprueba herramientas, ejecuta `npm install` con lockfile, genera contratos/tokens y crea `.env` y `apps/web/.env.local` sólo si faltan. La clave local se genera aleatoriamente y no se imprime. No sobreescribe valores existentes ni solicita credenciales AWS. Para una instalación CI estricta puede usarse `npm ci`.

`dev` reutiliza `tools/scripts/dev_lab.mjs`: compila Go temporalmente e inicia la API de sesiones en `127.0.0.1:8080`, laboratorio en `127.0.0.1:8082` y Vite en `127.0.0.1:5173`. Comprueba puertos y readiness, y configura los tres adaptadores web hacia loopback; no apunta a producción por defecto. Abrir `/escape`, `/flood-lab` o `/mobile`. El inicio de cada simulación es explícito.

Ctrl+C detiene los tres hijos; `make stop` desde otra terminal solicita el mismo cierre autenticado por loopback. El registro privado `.local/dev.json` sólo identifica este lanzador y se elimina al cerrar. Ningún comando borra reportes, volúmenes ni datos persistentes. Un segundo `make dev` falla sin afectar el primero.

```sh
# Con make dev activo, desde otra terminal
make smoke
make stop
```

Smoke comprueba web, health, capacidades, publicados, laboratorio y `/paso` 401/200 con respuesta vecina válida; no crea sesiones ni avanza turnos. `/estado` permanece inactivo aunque haya sesiones públicas ejecutándose.

### Configuración

`make dev` carga `.env` de raíz; variables ya exportadas tienen prioridad. Go directo no carga dotenv. `apps/web/.env.local` contiene sólo configuración pública. Nunca guardar secretos en `VITE_*` ni `--dart-define`.

| Variable | Uso local |
| --- | --- |
| `LAB_WEB_PORT`, `LAB_WORLD_PORT`, `LAB_FLOOD_PORT` | 5173, 8080, 8082; tres puertos distintos, 1024–65535 |
| `LAB_INCIDENT_DIR` | `services/evacuation/private/incidents`, conserva novedades entre arranques |
| `LAB_REFERENCE_CACHE` | `services/evacuation/private/reference.json` |
| `LAB_REFERENCE_ONLINE` | `false`; copia SNGR versionada disponible sin Internet |
| `LAB_OSM_TILES_ENABLED` | `false`; geometría OSM local sigue visible, `true` solicita teselas externas |
| `API_KEY` | Sólo backend/smoke local; sin valor se crea una clave efímera privada |
| `SIM_MAX_*`, `SIM_*_TTL` | Cupos/retención del ejecutor; consultar [contratos](contratos.md) |

El lanzador mantiene BASE y deshabilita FULL/expanded; no habilita administrador ni autostart. Para un servidor configurado expresamente, exportar `API_KEY`, `SIM_AUTOSTART=false` y ejecutar `npm run dev:backend`; FULL requiere `ENABLE_FULL_MODE=true`. `npm run dev:api` es un alias de `dev:backend`.

### Verificación

`make test` ejecuta JavaScript y Go. `make verify` ejecuta documentos, contratos/derivados/lint, Go/race, geografía, contratos HTTP/sesiones/flood, espectadores HTTP y builds. No requiere servicios previos, AWS ni Flutter. [Pruebas, navegador, benchmarks y evidencia actual](pruebas.md).

No hay Docker Compose en este repositorio: se conserva el Dockerfile de backend y el despliegue existente, sin añadir otra infraestructura local. AWS se opera con el procedimiento de esta misma guía.

### Flutter Android complementario

No controla motores. Observa las ejecuciones publicadas y permite reportar novedades. [Guía del cliente](../apps/mobile/README.md).

```sh
npm run mobile:check
npm run mobile:test
npm run mobile:build
# Harness efímero con Go real: publicados y reporte ciudadano idempotente
npm run test:spectators:http -- --flutter
```

Añadir Flutter a PATH o definir `FLUTTER_BIN` antes. APK debug en `apps/mobile/build/app/outputs/flutter-apk/app-debug.apk`; web en `apps/web/dist`, ambos ignorados. No compilar Flutter Web. Un APK construido no prueba dispositivo físico.

Para conectar Android vía ADB, conservar servicios loopback y usar `adb reverse` en los puertos del backend y laboratorio, configurando WORLD/FLOOD/INCIDENTS_API_BASE_URL mediante `--dart-define`. No debilitar validación Host del laboratorio para conectar un emulador. La consola React debe iniciar las ejecuciones antes de observarlas.

### Recuperación

| Síntoma | Acción |
| --- | --- |
| Puerto ocupado | Detener su propietario o cambiar los tres `LAB_*`; el lanzador no mata procesos ajenos. |
| Registro local antiguo | `make stop` retira registro si el PID terminó. Si aún vive, usar Ctrl+C en su terminal; no se envían señales por PID desde make stop. |
| SDK ausente | Configurar PATH/`GO_BIN`/`FLUTTER_BIN`; `flutter doctor -v` para Android/Java17/licencias. |
| Contratos desincronizados | Editar YAML y `npm run contracts:generate`; tokens desde JSON y `npm run tokens:generate`. |
| Configuración no cambia | Reiniciar Vite/Go. Usar el archivo y prefijo correctos; Go directo sólo lee exports. |
| HTTP/CORS/Host | Usar `127.0.0.1` consistentemente y el origen/puerto configurado; conservar requestId y código, nunca tokens/cuerpos privados. |
| Simulación final/expirada | Crear otra ejecución explícitamente; recargar sólo recupera la sesión existente. |
| Chromium ausente | `npx playwright install chromium` o `PLAYWRIGHT_CHROMIUM_EXECUTABLE` con ejecutable real. |

No ejecutar `docker system prune`, `down -v` ni limpiezas de `private` como solución de arranque.

## Preparar una release

Flutter es complementario. Para una release Linux/amd64 con Docker disponible,
desde la raíz y tras superar [verificación](pruebas.md):

```sh
VITE_WORLD_API_BASE_URL=https://api.sistemamanta.lexinnovate.com \
VITE_FLOOD_API_BASE_URL=https://api.sistemamanta.lexinnovate.com \
VITE_INCIDENTS_API_BASE_URL=https://api.sistemamanta.lexinnovate.com \
npm run build:web
npm run build:backend
docker build --platform linux/amd64 -f services/evacuation/Dockerfile \
  -t corodev-backend:delivery .
bash deploy/aws/prepare-release.sh corodev-backend:delivery \
  deploy/releases/delivery-review
```

La imagen [Dockerfile](../services/evacuation/Dockerfile) contiene `server`,
`flood-lab`, healthcheck, escenarios y geografía. El empaquetador verifica
arquitectura, guarda checksums y rechaza un destino existente; **no llama AWS**.
Su bundle contiene imagen y scripts iniciales; acompañarlo con el frontend
completo y [rollout-image.py](../deploy/rollout-image.py) para actualizar el
par backend/laboratorio existente. Conservar hashes, commit real, configuración
sanitizada, evidencia de pruebas y respaldo de datos para cada release.

El build de release anterior fija los endpoints HTTPS explícitamente, porque `make setup` crea una configuración web local. No publicar un build que apunte a loopback. El frontend compilado incorpora URLs públicas: para una instancia diferente
configurar `VITE_WORLD_API_BASE_URL`, `VITE_FLOOD_API_BASE_URL` y
`VITE_INCIDENTS_API_BASE_URL` antes del build. Nunca poner secretos en `VITE_*`,
Dart, capturas o archivos del bundle. [Contrato y regeneración](contratos.md).

La entrega base utilizó el bundle privado `deploy/releases/delivery-review-20261027/`:
imagen Linux/amd64, frontend HTTPS, OpenAPI, rollout, manifest y checksums.
El [registro de entrega](../deploy/deployment-delivery-20261027.json) conserva
los hashes y comprobaciones de aquella publicación; la instrumentación posterior
se registra por separado en [observabilidad](../deploy/observability/verification-20261027.json).
Un artefacto local no acredita una versión publicada ni un resultado de carga.

## Configuración privada y acceso

La API requiere `API_KEY` para `/paso`; el administrador usa
`ADMIN_OPERATOR` / `ADMIN_ACCESS_HASH` independientes. El archivo
`/etc/corodev/backend.env` es privado, modo `600`, basado en
[backend.env.example](../deploy/backend.env.example) y los
[overrides de EC2](../deploy/backend.phase5-ec2.env.example). No reemplazar un
archivo operativo por un ejemplo ni imprimir `docker inspect` completo: contiene
credenciales. Preservar los valores privados existentes.

Para configurar un operador nuevo, genera archivos privados desde la raíz:

```sh
node tools/scripts/go.mjs run ./cmd/operator-key -operator operador -directory ../../.local/operator
```

El comando rechaza un destino existente y no imprime secretos. Incorpora el
verificador de `operator.env` al entorno privado del backend; el código de
`operator-login.json` queda fuera de Git y Web Storage. Esta credencial sirve
para moderación, no es necesaria para iniciar simulaciones ni sustituye `/paso`.
[Autorización y cookies](contratos.md#administración-de-operador).

El perfil registra `SIM_AUTOSTART=false`, cuatro activas, una FULL, dieciséis
retenidas y 1.024 MiB de reserva estimada. Las pausadas ocupan cupo. El TTL final
es quince minutos. `SIM_MAX_WALL_TIME=15m` limita la vida de una ejecución en AWS:
los horizontes personalizados largos pueden caducar antes de agotar turnos;
no aumentar límites sin medir capacidad y revisar costo. `FLOOD_LAB_UPSTREAM`
sólo admite `http://127.0.0.1:8082`; CORS contiene orígenes exactos.

La demo pública no pide login de operador para iniciar simulaciones o tormentas.
Cada creación recibe su propio token de control; los espectadores sólo leen.
La moderación de reportes y actualización de referencias permanecen protegidas.
La clave de evaluación `/paso` se entrega al jurado **por canal privado**, con
vigencia y alcance acordados; nunca se publica en GitHub. `/paso` público observa
el runtime de compatibilidad, mientras cada sesión tiene su HTTP loopback;
[pruebas y límites de evaluación](pruebas.md).

## Actualización de la instalación existente

Primero comprobar identidad y región, outputs del stack, espacio en disco,
readiness, ausencia de ejecuciones que deban conservarse, compatibilidad de datos
y backup privado reciente del directorio persistente. Acceder con SSM y permisos
autorizados; los IDs se obtienen del stack real, no de ejemplos copiados.
Validar los checksums al transferir y ejecutar `docker load` en la EC2.

Para actualizar **ambos** contenedores, el mecanismo genérico disponible es:

```sh
# Sólo en el host autorizado, tras revisar imagen, montajes y ventana de cambio:
python3 deploy/rollout-image.py replace --image corodev-backend:delivery \
  --suffix before-delivery --recovery /etc/corodev/recovery-delivery.json
```

El script conserva configuración, variables, recursos y montajes existentes;
recrea el namespace compartido, espera health y `/lab/catalog`, retiene los
contenedores anteriores y revierte si falla. Su archivo de recuperación contiene
configuración privada y se crea `600`. **Revisar los bind mounts antes de usarlo**:
la última publicación registrada monta ejecutables externos en sólo lectura.
Esos montajes prevalecen sobre los binarios de una imagen nueva; la actualización
requiere una release que cambie también los montajes revisados, o su retirada
explícita en el plan autorizado. No ejecutar este ejemplo a ciegas en esa versión.

Tras confirmar que la imagen nueva contiene ambos ejecutables, añadir
`--image-binaries` retira únicamente los bind mounts de
`/usr/local/bin/corodev-server` y `/usr/local/bin/corodev-flood-lab`. Conserva los
montajes de datos y la configuración privada; el recovery guarda los montajes
originales para revertir. Las etiquetas de la imagen nueva identifican su commit.

`start-backend.sh`, `rollout.sh` y `rollback.sh` forman el bundle inicial y
gestionan sólo el backend. No actualizan por sí solos el par backend/laboratorio
ni sus montajes actuales; para ese caso usar el procedimiento anterior.

Para publicar React, con bucket/distribución/región reales ya verificados:

```sh
bash deploy/publish-web.sh apps/web/dist "$WEB_BUCKET" \
  "$CLOUDFRONT_ID" us-east-2
```

Este script comprueba sprites del catálogo, publica assets antes de `index.html`,
conserva archivos anteriores y crea invalidación. El comando modifica S3 y
CloudFront y se ejecuta sólo con autorización de publicación.

## Salud, logs y recuperación

Comprobaciones públicas ligeras, sin crear sesiones:

```sh
curl --fail --silent --show-error https://api.sistemamanta.lexinnovate.com/healthz
curl --fail --silent --show-error https://api.sistemamanta.lexinnovate.com/v1/simulations/capabilities
curl --fail --silent --show-error https://api.sistemamanta.lexinnovate.com/lab/catalog
curl --fail --silent --show-error --output /dev/null https://sistemamanta.lexinnovate.com/escape
```

En el host, `docker exec corodev-backend /usr/local/bin/healthcheck` comprueba
readiness y `docker stats --no-stream` permite inspeccionar recursos. Los
contenedores usan `awslogs`; revisar eventos mediante CloudWatch/SSM, sin cuerpos,
cabeceras de autorización ni configuración privada:

```sh
aws logs tail /corodev/corodev-phase2/backend --since 10m --region us-east-2
aws cloudformation describe-stack-events --stack-name corodev-phase2 --region us-east-2
```

Health 200 prueba disponibilidad de un endpoint, no avance del mapa. La
verificación funcional posterior debe iniciar una ejecución explícita autorizada,
observar cambios y controles, probar móvil y `/paso`, y conservar errores y
mediciones. La publicación anterior de controles omitió tests y navegador. Esta release
reutiliza la validación local completa documentada en [pruebas](pruebas.md); durante
el despliegue sólo se hicieron comprobaciones HTTP puntuales, sin nuevas suites
ni cargas. Dos archivos persistentes quedaron idénticos al backup; la caché oficial
sólo actualizó metadatos de consulta por su configuración online ya existente.

Rollback del par: conservar los contenedores anteriores y su namespace, detener
primero el laboratorio nuevo y luego el backend nuevo, restaurar los dos nombres
y arrancar backend antes de laboratorio. El script genérico hace esta secuencia
automáticamente si falla el reemplazo; no tiene subcomando de rollback manual.
No eliminar contenedores, imágenes o recovery antes de comprobar HTTPS y datos.
Restaurar una release web completa previa y volver a invalidar CloudFront.
**La RAM no se recupera** y lectores antiguos pueden rechazar campos nuevos de
moderación; preservar auditoría y probar compatibilidad antes de retroceder.

## Observabilidad mínima CloudWatch

Configuración focalizada del **27 de octubre de 2026** en la misma EC2 de Ohio
(`us-east-2`, 2 vCPU/8 GiB). El agente instalado estaba detenido y sin JSON;
se respaldó su directorio `etc` antes de activarlo. [Configuración versionable](../deploy/observability/cloudwatch-agent.json).
Publica **CPU total `cpu_usage_active` y RAM `mem_used_percent`, cada 60 s**,
namespace `CoroDev/MantaSim`, única dimensión `InstanceId`. No se publican CPUs
individuales ni disco, y EC2 conserva monitoreo básico; no se activó el detallado.
En CloudWatch → Metrics → `CoroDev/MantaSim` → `InstanceId`, usar Average/1 minuto.
Ambas series se consultaron: a las 20:05 de Ecuador, CPU 1,35 % y RAM 5,54 %;
son muestras puntuales en reposo, sin acreditar capacidad bajo carga.

El perfil de instancia correcto conserva `AmazonSSMManagedInstanceCore` y su
política de logs. No tenía `CloudWatchAgentServerPolicy` ni PutMetricData;
se añadió sólo [MantaSimHostMetrics](../deploy/observability/host-metrics-policy.json),
con `cloudwatch:PutMetricData` restringido al namespace. `Resource:*` es necesario
para esta operación sin ARN de métrica; la condición limita el destino. No hay
credenciales administrativas en el agente, nuevos usuarios ni roles adicionales.
La política inline y el JSON están fuera de la plantilla CloudFormation actual;
reaplicarlos si se recrea el rol/host. Tras copiar el JSON al host por SSM:

```sh
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config -m ec2 -s -c file:/etc/corodev/cloudwatch-agent.json
```

La API reutiliza su hook de tiempos en [httpapi](../services/evacuation/internal/httpapi/api.go).
`PASO_HTTP_LOG_ENABLED=true` activa eventos JSON `paso_http` por POST `/paso`,
sin muestreo: método, ruta fija, estado, `duration_ms`, resultado y desglose
snapshot/decisión. `run_id` identifica sesiones zombie en logs, nunca dimensiones
CloudWatch; el laboratorio compartido se correlaciona por stream y ventana UTC.
No se registran cuerpos, claves ni IDs de sobrevivientes. El envío usa una cola
asíncrona acotada, sin AWS ni escrituras de logs en el hilo de decisión. Los
contenedores conservan su driver `awslogs`, grupo `/corodev/corodev-phase2/backend`,
streams `backend`/`flood-lab`, retención existente de siete días. El agente no lee
stdout de Docker. Se actualizaron sólo los dos binarios, sin reiniciar EC2 ni Caddy.

En Logs Insights están guardadas cuatro consultas `CoroDev/MantaSim/paso-*`:
[latencia](../deploy/observability/paso-latency.ql), [estados y resultados](../deploy/observability/paso-outcomes.ql),
[errores 5xx/cancelaciones/timeouts](../deploy/observability/paso-server-errors.ql) y
[cobertura](../deploy/observability/paso-coverage.ql). La consulta principal es:

```text
filter event = "paso_http" and method = "POST" and route = "/paso"
| stats count(*) as requests, pct(duration_ms,50) as p50_ms,
        pct(duration_ms,95) as p95_ms, pct(duration_ms,99) as p99_ms by bin(1m)
```

`duration_ms` mide desde entrada al handler hasta terminar la escritura de su
respuesta; incluye lectura/validación, snapshot y decisión. No es sólo A*/Dijkstra
ni incluye handshake, RTT WAN, cola previa del servidor, flush final de `net/http`
o decodificación cliente.
El benchmark HTTP cliente sigue siendo la evidencia principal del reto. Una
cancelación observada antes del presupuesto local se distingue de su vencimiento;
no permite saber si el cliente canceló manualmente o agotó su propio timeout.

Para R1/R2/R3 seleccionar sus ventanas UTC completas y el `run_id` correspondiente;
[consulta de ronda](../deploy/observability/paso-round.ql). No promediar p95 de
minutos para obtener p95 de ronda. Los marcadores `paso_http_log_status` muestran
intentadas/emitidas/perdidas/errores/pendientes por proceso: esperar cola vacía y
contrastar número de registros con intentos del benchmark. Si hay pérdidas,
reinicio abrupto o discrepancias, no afirmar cobertura ni p95 de toda la ronda.
La cola nunca bloquea `/paso`: ante saturación incrementa `dropped`, sin ocultarlo.

La última verificación usa lecturas de CPU/RAM y cuatro solicitudes puntuales
(un éxito, un 401, un timeout y una cancelación; ocho en las dos comprobaciones
de activación). Insights devolvió los cuatro eventos, con cero descartes/errores
de escritura y cola vacía. No es una ronda ni un benchmark. Se compilaron sólo
los binarios modificados, sin tests automáticos, lint, E2E ni carga. No se midió
sobrecoste de logging bajo concurrencia. Evidencia operacional privada en
`.local/cloudwatch/`, fuera de Git.

**Costos:** dos series personalizadas (USD 0,60/mes bruto al primer tramo de
Ohio, sin descontar franquicias) más ingesta/almacenamiento de logs, APIs y GB
escaneados por Insights según uso. Las consultas guardadas no se ejecutan solas.
No se añadieron métricas HTTP personalizadas, dashboards, X-Ray ni ADOT.
[Catálogo regional verificado](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/current/us-east-2/index.json)
y [tarifas](https://aws.amazon.com/cloudwatch/pricing/). El Budget existente se conserva.

**Reversión:** `sudo systemctl disable --now amazon-cloudwatch-agent` devuelve
el estado operativo inicial (detenido); configuración anterior en
`/etc/corodev/cloudwatch-backup-20261027/agent-etc.tgz`. Conservar respaldos y logs.
Retirar sólo la política inline nueva `MantaSimHostMetrics` si ya no se publica.
Para retirar toda la instrumentación, restaurar
`corodev-backend-before-cloudwatch-20261027-2008` y
`corodev-flood-lab-before-cloudwatch-20261027-2008` con el procedimiento de
recuperación de esta guía; conserva datos, entorno y driver. Los respaldos con
sufijo `-cancel` sólo revierten la segunda activación y todavía registran HTTP.
No reiniciar EC2 ni borrar grupos/métricas. Las definiciones nuevas
pueden borrarse individualmente; las anteriores se respaldaron y no se alteraron.

## Infraestructura nueva y retirada

No hace falta crear recursos para preparar la entrega local. Si se autoriza otra
instalación, usar [stack.yaml](../deploy/aws/stack.yaml), parámetros privados
basados en [el ejemplo](../deploy/aws/parameters.example.json), validación local
y un change set revisado. El ejemplo de parámetros aún es el baseline histórico
`t3.small`/Budget 30; no describe la instancia actual. La plantilla reutiliza VPC,
subred pública, certificado ACM y Budget existente verificados. No crea NAT,
ALB, RDS, Redis, ECR ni API Gateway para la simulación.

Existe **retirada programada desde el 31 de octubre de 2026, 01:46 de Ecuador**,
registrada por la autorización previa del propietario. Incluye borrado de datos,
no sólo detener EC2; su ejecución futura no está verificada. Horarios, alcance,
backup y cancelación explícita están en
[el auxiliar y su procedimiento operativo](../deploy/autokill/README.md). No activar, cancelar ni ampliar esa
programación durante esta consolidación. Antes del vencimiento, el propietario
debe preservar los reportes que necesite y confirmar la vigencia de la demo.

Detener EC2 corta cómputo pero conserva costos EBS/IPv4. Los buckets `Retain`,
versiones y DNS externos requieren revisión; el Budget avisa y no apaga recursos.
No usar eliminación de stack, vaciado de buckets o borrado de volúmenes como
solución de fallos. Véanse [costos](costos.md) y [limitaciones](limitaciones.md).

Los registros sanitizados `deploy/validation*.json` y `deployment*.json`
conservan fechas, hashes y alcances de publicaciones anteriores; no sustituyen
el inventario vigente ni autorizan una nueva intervención.
