# Despliegue AWS — FASE 3A.2

**Revisión del operador antes de autorizar:** [seguridad y separación de permisos](revision-seguridad-fase3a2.md). El ARN, ambos hashes, los 14 recursos y el costo siguen intactos. El complemento aún no está asociado y DescribeEvents sigue denegado; la autorización final todavía no procede. No se repitieron pruebas locales.

**Estado al 26 de octubre de 2026, America/Guayaquil:** preflight principal comprobado; certificado del frontend **ISSUED** y change set **phase3a2-20261026T211726Z** creado para `corodev-phase2`, Ohio. Estado `CREATE_COMPLETE / AVAILABLE`, **sin ejecutar**. El stack está en `REVIEW_IN_PROGRESS`: no hay EC2, EIP, buckets o distribución aprovisionados por ese plan.

El Budget mensual real de **30 USD** está HEALTHY, con avisos reales al 85%/100% y previsto al 100%, cada uno con email configurado. Informa **0,00 USD** acumulados con posible retraso, sin créditos/reembolsos. No se duplicó ni modificó.

Verificados identidad IAM no root/cuenta autorizada, perfil `default`, VPC/subred pública en `us-east-2a`, ruta IGW, DNS/DHCP, NACL, AMI Amazon Linux 2023 x86_64 y cuotas: ocho vCPU estándar y cinco EIP; se planean dos vCPU y una EIP. Se conserva la AMI kernel 6.1 ya verificada; el parámetro público actual también se consultó y apunta a kernel 6.18. La imagen Docker sigue siendo linux/amd64.

No había certificado reutilizable. Se solicitó ACM público **no exportable** en us-east-1 y el propietario añadió el CNAME; DNS y validación SUCCESS comprobados, certificado emitido. Los registros que enrutan frontend/API esperan los outputs de la infraestructura.

La revisión del operador separó cuatro documentos: base CloudFormation acotada, despliegue/Run Command imprescindible, administración interactiva y auditoría opcional. PutRolePolicy/DeleteRolePolicy sólo pueden concederse para el rol exacto mediante CloudFormation; además hay que reemplazar el bloque CloudFormation amplio del operador para impedir otros payloads. **Estos permisos son del operador, nunca del rol EC2.** Véase la revisión enlazada; no se aplicaron cambios IAM desde el agente.

## Cambio específico pendiente de aprobación

- Nombre: `phase3a2-20261026T211726Z`; stack `corodev-phase2`; región `us-east-2`.
- Resultado AWS: **14 Add, cero Modify/Remove/reemplazos**. [Lista y evidencia](../deploy/validation-phase3a2-changeset.json).
- Incluye EC2 t3.small, raíz gp3 20 GB cifrada, EIP, grupo exclusivo, dos buckets privados/políticas, logs/alarma y CloudFront/OAC/función SPA.
- IAM global: rol y perfil `deploy-cli-ec2-corodev-phase2`, `CAPABILITY_NAMED_IAM`; rol con SSM y permisos internos sólo de logs/releases.
- Red: entrada pública TCP80/443 y egreso TCP80/443. Sin SSH22 o Go8080 públicos.
- ACM frontend en us-east-1, emitido y sin exportación; IAM y CloudFront/OAC/función globales. Cómputo, discos, EIP, S3 y logs en Ohio.
- Estimación **22,96 USD/mes**, reserva de planificación 24 USD, sin descuentos/impuestos. Budget existente 30 USD; no es un corte automático.

La revisión con ARN completo y hashes está en `deploy/evidence-private/phase3a2-final-preflight-20261026/change-set-review.md`. Ese documento conserva la revisión del cambio; la nueva revisión de seguridad del operador documenta las correcciones del complemento y las condiciones previas a autorizar. No ejecutar otro change set ni cambiar plantilla/parámetros bajo esta aprobación.

## Evidencias y permisos pendientes

- [Change set real y certificado](../deploy/validation-phase3a2-changeset.json), [reintento anterior](../deploy/validation-phase3a2-retry.json), [estado consolidado](../deploy/validation-phase3a.json), [preflight de esta fase](../deploy/validation-phase3a2-preflight.json) y [validación local](../deploy/validation-phase3a2-local.json).
- Respuestas/errores actuales: `deploy/evidence-private/phase3a2-final-preflight-20261026/`, privado y excluido de Git. No contienen credenciales.
- [Plantilla de política de lectura para preflight](../deploy/preflight-readonly-policy.example.json), con marcador de cuenta, revisable y **no aplicada**. Un administrador autorizado debe revisarla para el usuario existente o adaptar la inspección a un rol temporal.
- [Explicación de los permisos](aws-preflight-permisos.md). Los permisos de preparar/ejecutar el change set se revisarán por separado, con los recursos reales. No usar AdministratorAccess para resolver este bloqueo.

Cuotas, inventario CloudFormation/CloudFront y certificado ya comprobados. El plan de cuenta, CloudTrail y los eventos detallados de validación siguen sin acceso; no se afirma auditabilidad o validación de esa capa. Las evidencias anteriores se conservan como historia.

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

Son **14 recursos declarados** con Budget nuevo desactivado; EBS es parte de Backend. La lista coincide con el **change set real creado**, todavía sin ejecutar. No se crean VPC, NAT Gateway, balanceador ni zona DNS.

`CreateProjectBudget=false` mantiene el Budget fuera de CloudFormation. `ExistingBudgetName` procede de una comprobación real; no se importa ni modifica. El modo alternativo que crea Budget queda para otros entornos, requiere aprobación y no garantiza precedencia del Budget respecto al consumo. No usarlo en este despliegue.

El grupo de seguridad comienza restringido en el ejemplo. El change set creado muestra **TCP 80/443 desde 0.0.0.0/0**, solicitado para Caddy/ACME; 22 y 8080 seguirán cerrados. Egreso TCP 80/443 para paquetes, SSM, logs y ACME. Go publica 8080 en loopback/red Docker. IMDS hop limit uno impide acceso desde el contenedor Go; el driver de logs utiliza el rol desde el host.

## Dominios, DNS y certificados

DNS público observado: `lexinnovate.com` usa **Cloudflare**, servidores `kayleigh.ns.cloudflare.com` y `luke.ns.cloudflare.com`. No se hallaron A/CNAME para los nombres del proyecto. No hay acceso conectado y autorizado a Cloudflare; no se modificó DNS ni se asumió Route 53.

| Uso | Registro en Cloudflare, inicialmente DNS only | Valor pendiente |
| --- | --- | --- |
| Frontend | CNAME sistemamanta.lexinnovate.com | Output real WebCloudFrontDomain |
| API | A api.sistemamanta.lexinnovate.com | Output real BackendIPv4 |
| Validación ACM, completada | CNAME _18414b2fbc926162e72dc758bc022bf9.sistemamanta.lexinnovate.com | _7fe3626cee5c306831112ca94dc4d567.wzccmgtwzk.acm-validations.aws |

El CNAME ACM ya está creado y verificado; conservarlo para renovación. Sus datos están en [DNS de validación](../deploy/dns-validation-phase3a2.json). Los destinos de aplicación todavía dependen de outputs; no inventar IP/hostname ni añadir AAAA sin ruta IPv6 comprobada.

Buscar primero ACM en **us-east-1**: certificado ISSUED, vigente y SAN exacto o wildcard válido para el frontend. `*.lexinnovate.com` puede cubrirlo, pero no `api.sistemamanta.lexinnovate.com`. Caddy obtiene un certificado independiente para API. [Requisitos de CloudFront](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html).

La [solicitud preparada](../deploy/aws/certificate-request.example.json) ya se ejecutó, sin tags, pública/DNS/Export=DISABLED. El certificado exacto está ISSUED y cargado en los parámetros privados del change set. Es independiente del HTTPS que Caddy emitirá para la API.

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

**Change set preparado y certificado emitido.** Los parámetros privados ya están completos; faltan aprobación específica y permisos acotados para ejecución/instalación y lectura de validaciones. Estimación base **22,96 USD/mes**, reserva de 24 USD; t3.medium alcanzaría 38,15 USD. Ver [costos y supuestos](costos.md).

La copia `deploy/aws/parameters.production.json`, modo 600 y excluida de Git, ya tiene la VPC, subred, AMI, Budget y TCP 80/443 públicos previstos. El ARN ACM real está completado. El stack `corodev-phase2` ya existe en REVIEW_IN_PROGRESS con el cambio CREATE preparado; reutilizar ese plan. No borrar el stack ni recrearlo para saltar controles.

```sh
# CHANGE_SET_TYPE corresponde al estado real; nombre phase3a2-* para el suplemento IAM.
# No usar --tags ni RoleARN con la política de preparación.
aws cloudformation create-change-set --region "$AWS_REGION" \
  --stack-name corodev-phase2 --change-set-name "$CHANGE_SET_NAME" \
  --change-set-type "$CHANGE_SET_TYPE" --template-body file://deploy/aws/stack.yaml \
  --parameters file://deploy/aws/parameters.production.json --capabilities CAPABILITY_NAMED_IAM
aws cloudformation describe-change-set --region "$AWS_REGION" \
  --stack-name corodev-phase2 --change-set-name "$CHANGE_SET_NAME"
```

La creación y descripción del change set **ya se ejecutaron**; no repetirlas sin necesidad. Crear el change set no aprovisiona los 14 recursos. DescribeEvents aún fue denegado: obtener esos resultados antes de ejecutar, una vez añadido el complemento de permisos.

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

Pasaron cfn-lint 1.58.0 en Ohio, shell, JSON y controles estáticos de seguridad/identidad. **cfn-guard no disponible**: cumplimiento automatizado pendiente; la revisión estática no lo sustituye. ValidateTemplate del servicio pasó. El change set llegó a CREATE_COMPLETE; DescribeEvents todavía denegado. CloudTrail y plan de cuenta siguen como auditoría opcional. Las 17 simulaciones de políticas propuestas están en evidencia privada y no sustituyen comprobar las políticas efectivamente asociadas. El canal interactivo usa una política separada y requiere comprobación real.

Pasaron checks/contratos/generación consistente/TypeScript/ESLint, 22 React, 40 mock, Go race/build, 10 pruebas de grafo, Docker con 200 decisiones internas, Caddy sin red e integración HTTP urbana Chromium/Dart. Flutter analyze, 21 pruebas unitarias y APK debug correctos; sin prueba física. Son resultados **locales**, no latencias AWS. No se repitieron experimentos FASE 2 ni se cambiaron motores/grafos/contratos.

Git estaba inicializado en main, sin commits/remoto. El encargo actual autoriza commits reales tras escanear, por encima de la prohibición histórica de FASE 2 en AGENTS.md. Se creó el primer commit con fechas auténticas tras el escaneo; comprobar git log para el identificador. No hay remoto definido ni publicación: el destino requiere autorización del propietario. .gitignore excluye credenciales, .env, parámetros completos, reportes privados, bundles, builds y evidencias sensibles.

**Pendiente:** reemplazar la base amplia del operador, asociar el complemento imprescindible, leer eventos de validación, obtener aprobación específica, ejecutar, instalar/publicar y configurar los DNS de aplicación con outputs reales. No se inició FASE 3B.
