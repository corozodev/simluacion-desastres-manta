# Despliegue y operación AWS

[Índice](INDEX.md) · [Arquitectura](arquitectura.md) · [Costos](costos.md) · [Pruebas](pruebas.md)

Esta guía describe la infraestructura existente y la preparación local de una
release. **Esta consolidación no ejecuta push, despliegue, reinicios ni cambios
AWS.** Sustituir servicios interrumpe sesiones en RAM y requiere autorización
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
| Budget externo | 50 USD/mes, HEALTHY, confirmado por lectura el 27 de octubre; avisa, no limita cargos |
| Externos a AWS | DNS Cloudflare; certificado de la API Let's Encrypt gestionado por Caddy; datos OSM/GeoManta/SNGR |

Fuentes: [resize y límites](../deploy/validation-phase5-deployment.json),
[última publicación registrada](../deploy/deployment-report-controls-20261027.json),
[plantilla](../deploy/aws/stack.yaml) y [perfil operativo](../deploy/backend.phase5-ec2.env.example).
La última publicación registrada corresponde a `e4863a9`, el 27 de octubre;
no acredita que los cambios locales posteriores estén desplegados. Los GET
públicos a `/escape` y `/healthz` devolvieron 200 durante esta auditoría, usando
DNS y TLS normales; no se inició ninguna simulación pública. La lectura AWS
del 27 de octubre, aproximadamente 18:58 de Ecuador, confirmó identidad vigente
no-root, la instancia exacta en ejecución en `us-east-2a`, `m7i-flex.large`,
2 vCPU/8 GiB y único EBS gp3 cifrado de 20 GiB adjunto. Se usaron STS,
DescribeInstances, DescribeInstanceTypes y DescribeVolumes sin cambios. Los IDs
de cuenta/ARN no se publican. Esta lectura no verifica configuración interna
actual de Docker ni capacidad bajo carga; revalidar antes de operar.

8 GiB es capacidad de memoria, no CPU adicional. La prueba AWS histórica de
cuatro sesiones duró tres turnos; no certifica carga sostenida. Las mediciones
locales con `GOMAXPROCS=2` tampoco equivalen a esta EC2.

## Desarrollo y preparación local

La demo local no necesita Docker ni AWS: [guía local](development/local-setup.md).
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

## Artefacto preparado durante esta revisión

La revisión local construyó y verificó `corodev-backend:delivery-review` y dejó
`deploy/releases/delivery-review-20261027/` (ignorado): imagen Linux/amd64,
`web/` compilado con los tres endpoints HTTPS, OpenAPI, script de rollout actual,
manifest y `SHA256SUMS`. El manifest identifica el commit base y el árbol
modificado; no inventa un commit de release. Los checksums se comprobaron tras
empaquetar. No incluye credenciales ni implica publicación/despliegue.

`python3 tools/qa/verify_docker.py --image corodev-backend:delivery-review`
verificó inicio idle, health, usuario no-root/readonly y una sesión official R3
con 200 decisiones HTTP autenticadas; el contenedor temporal se retiró. Este
script no toca los contenedores de producción ni borra volúmenes.

## Configuración privada y acceso

La API requiere `API_KEY` para `/paso`; el administrador usa
`ADMIN_OPERATOR` / `ADMIN_ACCESS_HASH` independientes. El archivo
`/etc/corodev/backend.env` es privado, modo `600`, basado en
[backend.env.example](../deploy/backend.env.example) y los
[overrides de EC2](../deploy/backend.phase5-ec2.env.example). No reemplazar un
archivo operativo por un ejemplo ni imprimir `docker inspect` completo: contiene
credenciales. Preservar los valores privados existentes.

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

`rollout.sh`/`rollback.sh` gestionan sólo el backend histórico;
`rollout-phase5.sh` recrea el par con opciones de aquella fase. No son una
actualización automática de la instalación actual. `rollout-phase4.sh` elimina
la imagen anterior: se conserva como historial, no como procedimiento recomendado.

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
mediciones. La última publicación histórica omitió tests y navegador: esta guía
no transforma esa omisión en evidencia positiva.

Rollback del par: conservar los contenedores anteriores y su namespace, detener
primero el laboratorio nuevo y luego el backend nuevo, restaurar los dos nombres
y arrancar backend antes de laboratorio. El script genérico hace esta secuencia
automáticamente si falla el reemplazo; no tiene subcomando de rollback manual.
No eliminar contenedores, imágenes o recovery antes de comprobar HTTPS y datos.
Restaurar una release web completa previa y volver a invalidar CloudFront.
**La RAM no se recupera** y lectores antiguos pueden rechazar campos nuevos de
moderación; preservar auditoría y probar compatibilidad antes de retroceder.

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
[la evidencia operativa de caducidad](despliegue-fase5-y-caducidad.md) y
[el auxiliar](../deploy/autokill/README.md). No activar, cancelar ni ampliar esa
programación durante esta consolidación. Antes del vencimiento, el propietario
debe preservar los reportes que necesite y confirmar la vigencia de la demo.

Detener EC2 corta cómputo pero conserva costos EBS/IPv4. Los buckets `Retain`,
versiones y DNS externos requieren revisión; el Budget avisa y no apaga recursos.
No usar eliminación de stack, vaciado de buckets o borrado de volúmenes como
solución de fallos. Véanse [costos](costos.md) y [limitaciones](limitaciones.md).

El [registro de despliegue inicial](despliegue-aws.md) permanece histórico;
los informes posteriores conservan fechas, hashes y autorizaciones reales.
