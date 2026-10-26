# Despliegue AWS — FASE 3A.2

**Estado al 26 de octubre de 2026, America/Guayaquil:** preparación local completada; acceso AWS pendiente por decisión del propietario tras comprobar errores IAM. STS autentica con el perfil existente `default`, usuario IAM `deploy-cli`, cuenta coincidente con la autorizada y región configurada `us-east-2`. No es root. No existe perfil `corodev`; no se modificaron perfiles ni credenciales.

AWS denegó las 26 consultas iniciales de inventario, Budget, IAM, cuotas y certificados, además de `cloudformation:ValidateTemplate` y `pricing:GetProducts`. La causa informada es ausencia de una política de identidad que permita esas acciones. **No se creó un change set ni infraestructura; no hay despliegue, HTTPS público o latencias externas comprobados.** STS no demuestra permisos de aprovisionamiento.

## Evidencias y acceso pendiente

- [Estado consolidado](../deploy/validation-phase3a.json), [preflight de esta fase](../deploy/validation-phase3a2-preflight.json) y [validación local](../deploy/validation-phase3a2-local.json).
- Respuestas/errores completos: `deploy/evidence-private/phase3a2/`, privado y excluido de Git. No contienen credenciales.
- [Plantilla de política de lectura para preflight](../deploy/preflight-readonly-policy.example.json), con marcador de cuenta, revisable y **no aplicada**. Un administrador autorizado debe revisarla para el usuario existente o adaptar la inspección a un rol temporal.
- [Explicación de los permisos](aws-preflight-permisos.md). Los permisos de preparar/ejecutar el change set se revisarán por separado, con los recursos reales. No usar AdministratorAccess para resolver este bloqueo.

VPC, subred, rutas, NACL, grupos, cuotas, estado/plan de cuenta, AMI AL2023, recursos reutilizables, certificados y Budget siguen **sin verificar**. Un AccessDenied no demuestra que no existan. Los resultados de FASE 2/3A anteriores se conservan como evidencia histórica.

## Infraestructura existente adaptada

Se reutilizan `deploy/aws/stack.yaml`, Docker, Caddy y scripts de release/rollout/rollback. Completar una copia privada de [parameters.example.json](../deploy/aws/parameters.example.json) con parámetros comprobados.

| Recursos previstos con Budget externo | Finalidad |
| --- | --- |
| EC2 `Backend` | Una t3.small x86_64, raíz gp3 20 GB cifrada e IMDSv2 obligatorio |
| EIP `BackendAddress` | IPv4 estable API |
| `BackendSecurityGroup` | Grupo exclusivo, sin SSH ni Go 8080 público |
| `BackendRole` / `BackendProfile` | SSM, escritura en logs y lectura releases/* del bucket privado |
| `BackendLogs` / `CPUAlarm` | Logs siete días y alarma CPU sin acciones SNS |
| `ArtifactBucket` / `ArtifactBucketPolicy` | Bundle privado, TLS obligatorio, expiración siete días |
| `WebBucket` / `WebBucketPolicy` | S3 privado cifrado/versionado y lectura exclusiva por OAC/distribución |
| `WebOriginAccess` / `SPARoutes` / `WebDistribution` | OAC, rutas SPA, alias CloudFront y TLS mínimo 1.2 |

Son **14 recursos declarados** con Budget nuevo desactivado; EBS es parte de Backend. Es una previsión local, **no un change set AWS**. No se crean VPC, NAT Gateway, balanceador ni zona DNS.

`CreateProjectBudget=false` mantiene el Budget fuera de CloudFormation. `ExistingBudgetName` procede de una comprobación real; no se importa ni modifica. El modo alternativo que crea Budget queda para otros entornos, requiere aprobación y no garantiza precedencia del Budget respecto al consumo. No usarlo en este despliegue.

El grupo de seguridad comienza restringido en el ejemplo. El change set público deberá mostrar **TCP 80/443 desde 0.0.0.0/0**, solicitado para Caddy/ACME; 22 y 8080 seguirán cerrados. Egreso TCP 80/443 para paquetes, SSM, logs y ACME. Go publica 8080 en loopback/red Docker. IMDS hop limit uno impide acceso desde el contenedor Go; el driver de logs utiliza el rol desde el host.

## Dominios, DNS y certificados

DNS público observado: `lexinnovate.com` usa **Cloudflare**, servidores `kayleigh.ns.cloudflare.com` y `luke.ns.cloudflare.com`. No se hallaron A/CNAME para los nombres del proyecto. No hay acceso conectado y autorizado a Cloudflare; no se modificó DNS ni se asumió Route 53.

| Uso | Registro en Cloudflare, inicialmente DNS only | Valor pendiente |
| --- | --- | --- |
| Frontend | CNAME sistemamanta.lexinnovate.com | Output real WebCloudFrontDomain |
| API | A api.sistemamanta.lexinnovate.com | Output real BackendIPv4 |
| Validación ACM | CNAME devuelto por ACM | DomainValidationOptions[].ResourceRecord real |

No existen destinos exactos todavía: faltan outputs y una respuesta ACM accesible. No inventar IP, hostname o token DNS. No tocar otros registros ni añadir AAAA sin ruta IPv6 comprobada.

Buscar primero ACM en **us-east-1**: certificado ISSUED, vigente y SAN exacto o wildcard válido para el frontend. `*.lexinnovate.com` puede cubrirlo, pero no `api.sistemamanta.lexinnovate.com`. Caddy obtiene un certificado independiente para API. [Requisitos de CloudFront](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html).

Si no existe certificado reutilizable, preparar solicitud pública sin exportación y validación DNS para el frontend. No se ha solicitado uno aquí. Tras autorizar y realizar la solicitud, entregar el CNAME exacto de ACM y esperar ISSUED antes del change set final.

CloudFront, función/OAC e IAM son globales. ACM CloudFront y endpoints globales Budgets/Price List utilizan us-east-1. EC2, EBS, EIP, S3 y CloudWatch permanecen en Ohio.

## Reanudar el preflight

Cuando el propietario confirme acceso habilitado, elegir el perfil autorizado sin sobrescribir el actual:

```sh
export AWS_PROFILE=default
export AWS_REGION=us-east-2
# Definir EXPECTED_AWS_ACCOUNT_ID fuera del repositorio con la cuenta autorizada.
bash deploy/aws/check-access.sh
aws cloudformation validate-template --region "$AWS_REGION" --template-body file://deploy/aws/stack.yaml
aws budgets describe-budgets --region us-east-1 --account-id "$EXPECTED_AWS_ACCOUNT_ID"
```

El script verifica cuenta y rechaza root; no sustituye el preflight completo. Verificar Budget mensual **30 USD**, filtros/cobertura, vigencia, salud, avisos y suscriptores con describe-budget, describe-notifications-for-budget y describe-subscribers-for-notification. Guardar destinatarios privados, confirmar entrega y no crear otro Budget por un permiso denegado.

Elegir VPC/subred existentes: disponible, misma VPC, ruta efectiva activa 0.0.0.0/0 a Internet Gateway adjunto, DNS habilitado y NACL que permita HTTP/HTTPS y respuestas efímeras. Una asociación explícita de rutas prevalece sobre la principal. Revisar attachments antes de tocar grupos existentes; la plantilla crea un grupo exclusivo.

Consultar SSM público `/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64` en Ohio y describir la AMI de Amazon: disponible, AL2023, x86_64, EBS/HVM y compatible con t3.small. Verificar oferta en la zona y cuotas/uso vCPU/EIP. La imagen local es linux/amd64; no seleccionar ARM sin reconstrucción y validación.

## Change set y aprobación obligatoria

**No se puede preparar un change set real hasta verificar red, Budget, AMI, certificado y permisos.** Los parámetros conservan marcadores visibles. Estimación base **22,96 USD/mes**, reserva de 24 USD; t3.medium alcanzaría 38,15 USD. Ver [costos y supuestos](costos.md).

Copiar el ejemplo a `deploy/aws/parameters.production.json`, excluido de Git, y completar solo datos reales. Revisar si existe `corodev-phase2` y elegir CREATE/UPDATE según su estado; no eliminar/recrear para evitar errores.

```sh
# CHANGE_SET_TYPE y CHANGE_SET_NAME corresponden al estado/nombre revisados.
aws cloudformation create-change-set --region "$AWS_REGION" \
  --stack-name corodev-phase2 --change-set-name "$CHANGE_SET_NAME" \
  --change-set-type "$CHANGE_SET_TYPE" --template-body file://deploy/aws/stack.yaml \
  --parameters file://deploy/aws/parameters.production.json --capabilities CAPABILITY_IAM
aws cloudformation describe-change-set --region "$AWS_REGION" \
  --stack-name corodev-phase2 --change-set-name "$CHANGE_SET_NAME"
```

Son comandos preparados, **no ejecutados**. Crear el change set no aprovisiona sus recursos. Obtener resultados de validación del servicio cuando estén disponibles.

Antes de execute-change-set, mostrar **ARN específico**, Add/Modify/Remove/reemplazos, recursos, costos, rol/perfil IAM, reglas de red y recursos globales/us-east-1. Solicitar aprobación expresa para **ese change set**. El encargo y la decisión de preparar archivos no son aprobación anticipada.

## Artefactos locales listos

Se preparó `deploy/releases/corodev-release-phase3a2-20261026.tgz` con la imagen validada y scripts existentes; SHA-256 `1d0713cafb19a18f2699080f29089379b50d1f32c42590add90f29819305ff53`. Se conserva fuera de Git y no se subió a AWS. El build React final contiene la URL HTTPS real prevista de la API; tampoco se publicó. Sus metadatos están en el preflight.

## Publicar solamente tras aprobación

1. Ejecutar el change set aprobado; esperar stack y comprobar outputs/eventos. Investigar errores concretos antes de reintentar.
2. `bash deploy/aws/prepare-release.sh corodev-evacuation:phase2 DIRECTORIO_NUEVO_PRIVADO`: verifica linux/amd64 y SHA-256 de imagen/scripts/Caddyfile; sin secretos.
3. Subir bundle a releases/ del bucket privado. Entrar con Session Manager, descargar en /opt/corodev, verificar `sha256sum -c SHA256SUMS` y cargar Docker. Sin SSH.
4. Crear /etc/corodev/backend.env modo 600 en el host; generar API_KEY allí sin imprimirla. Conservar grafo/escenario urbano validados y fijar CORS_ORIGINS=https://sistemamanta.lexinnovate.com. No enviar la clave por SSM Run Command ni registrar su contenido.
5. Iniciar deploy/start-backend.sh con LOG_DRIVER=awslogs, AWS_REGION=us-east-2 y AWS_LOG_GROUP del output. Conserva no-root, readonly, capabilities eliminadas, límites y reinicio; Docker utiliza el rol del host.
6. Crear DNS con outputs reales. Iniciar Caddy con API_DOMAIN=api.sistemamanta.lexinnovate.com y contacto TLS privado real. Conserva volúmenes de certificados, redirección HTTP, admin apagado y logs sin claves. Verificar cadena HTTPS desde Internet.
7. **Compilar al final**, porque la integración puede reemplazar dist con una URL local: `VITE_WORLD_API_BASE_URL=https://api.sistemamanta.lexinnovate.com npm run build:web`. Confirmar URL y ausencia de credenciales.
8. Publicar exclusivamente apps/web/dist: assets con hash/caché inmutable, index.html no-cache, invalidar /index.html y /escape. Conservar versiones/assets para rollback.

React y Flutter no reciben la API key de /paso. Se conserva mock/demo; no se añade un servidor demo productivo o pantallas. No se encontró OTel y no se introduce una plataforma nueva.

## Pruebas externas y rollback

Desde un cliente fuera de EC2, simulación activa y clave solo en su entorno privado:

```sh
python3 tools/qa/phase3a_probe.py https://api.sistemamanta.lexinnovate.com \
  --output deploy/validation-phase3a-public.json
```

Comprueba DNS público/TLS, /healthz, /grafo, /estado, /paso autenticado, 401 sin clave, ausencia de rutas administrativas y avance. Registra p50/p95/p99/máximo, intentos, errores y timeouts; conserva resultados parciales. Registrar la procedencia del cliente externo: el JSON solo no la demuestra. Leer percentiles exitosos junto con errores/timeouts.

Verificar además /escape en navegador externo, mapa/turnos, URL Go real, CORS, cadena TLS y logs efectivos CloudWatch. La simulación finalizada sigue respondiendo health: coordinar reinicios antes de medir. La alarma CPU no tiene SNS. No hay resultados públicos ni latencias AWS de esta fase.

deploy/rollout.sh conserva el contenedor previo y lo restaura si falla el nuevo; deploy/rollback.sh vuelve después. Reinicia desde semilla: **no restaura RAM**. Web: restaurar index.html anterior y assets, invalidar CloudFront. Infraestructura: revisar el cambio concreto; no eliminar el stack por un fallo parcial.

Al retirar, revisar EBS, EIP y buckets/versiones Retain. El Budget externo no pertenece al stack ni debe borrarse con él. Conservar evidencia de gasto si se necesita.

## Validación local y Git

Pasaron cfn-lint 1.58.0 en Ohio, shell, JSON y controles estáticos de seguridad/identidad. **cfn-guard no disponible**: cumplimiento automatizado pendiente; la revisión estática no lo sustituye. ValidateTemplate del servicio fue denegado. CloudTrail y auditabilidad de cuenta sin verificar por falta de permisos.

Pasaron checks/contratos/generación consistente/TypeScript/ESLint, 22 React, 40 mock, Go race/build, 10 pruebas de grafo, Docker con 200 decisiones internas, Caddy sin red e integración HTTP urbana Chromium/Dart. Flutter analyze, 21 pruebas unitarias y APK debug correctos; sin prueba física. Son resultados **locales**, no latencias AWS. No se repitieron experimentos FASE 2 ni se cambiaron motores/grafos/contratos.

Git estaba inicializado en main, sin commits/remoto. El encargo actual autoriza commits reales tras escanear, por encima de la prohibición histórica de FASE 2 en AGENTS.md. Se creó el primer commit con fechas auténticas tras el escaneo; comprobar git log para el identificador. No hay remoto definido ni publicación: el destino requiere autorización del propietario. .gitignore excluye credenciales, .env, parámetros completos, reportes privados, bundles, builds y evidencias sensibles.

**Pendiente:** habilitar acceso, completar preflight, resolver ACM/DNS con valores efectivos, crear change set y obtener aprobación específica. No se inició FASE 3B.
