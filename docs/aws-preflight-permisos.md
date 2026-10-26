# Permisos para reanudar el preflight

## Revisión vigente del operador

La [revisión de seguridad](revision-seguridad-fase3a2.md) sustituye la propuesta agrupada anterior. El change set, la plantilla y los parámetros permanecen intactos. No se cambiaron permisos en AWS desde el agente.

1. **Reemplazar** DeployCliPolicy con la copia privada operator-base-policy.json: retira sus mutadores CloudFormation amplios y permite ejecutar sólo el ARN ya preparado. Adjuntar otra política sin retirar el Allow anterior no limita permisos efectivos.
2. Asociar al operador deploy-cli el complemento execute-changeset-policy.json, ahora de cuatro bloques: inline del rol exacto sólo vía CloudFormation y Run Command con tags/documento exactos.
3. Administración interactiva Session Manager y auditoría son documentos separados. Auditoría Free Tier/CloudTrail no bloquea el despliegue. La política interactiva hace explícito Resource * sólo en OpenDataChannel, pues su referencia de autorización no admite ARN de recurso; sigue restringida al usuario operador y Ohio.

Copias listas: `deploy/evidence-private/phase3a2-operator-audit-20261026/`. Los ejemplos públicos requieren completar cuenta y UUID. El complemento imprescindible compacto tiene 1343 caracteres y cabe dentro del límite inline de usuario si no hay otras políticas inline; también puede ser administrado por separado. **No asociar ninguno al rol EC2.**

${aws:username} se evalúa por IAM a deploy-cli en las sesiones del usuario actual; no representa la cuenta local ni funciona igual con roles/SSO. El documento interactivo conserva esa variable sólo para ResumeSession/TerminateSession; el despliegue por Run Command no depende de ella.

Las 17 simulaciones conjuntas pasaron, incluyendo rechazos de otros cambios/stacks, inline directo y tags ajenos. El complemento aún no está asociado y la lectura real de DescribeEvents continúa denegada: faltan aplicación por el propietario y verificación efectiva antes de pedir autorización de ejecución.

## Evidencia de las revisiones anteriores

## Reintento con permisos nuevos

Ya funcionan EC2/VPC, S3, IAM de lectura, logs y Budget. Verificados el Budget de 30 USD (gasto informado 0,00 USD), sus tres avisos/email, red pública y AMI AL2023 x86_64. Siguen denegados CloudFormation, ACM, CloudFront, servicequotas, plan de cuenta, CloudTrail y SSM público. La consulta SSM no bloquea la AMI porque se comprobó por EC2.

El [suplemento de preparación](../deploy/prepare-changeset-policy.example.json) tiene copia con cuenta real en `deploy/evidence-private/phase3a2-retry-20261026/prepare-changeset-policy.json`, modo 600 y fuera de Git. Revisar y asociar con un administrador autorizado; no se aplicó desde aquí. El ejemplo público requiere sustituir el marcador de cuenta.

Permite listar/validar CloudFormation y preparar change sets `phase3a2-*` para `corodev-phase2` en Ohio, **sin RoleARN ni tags**. Incluye lectura de certificados/distribuciones/cuotas/plan/auditoría y una solicitud ACM pública, sin tags, DNS y no exportable para el frontend exacto en Virginia. [Condiciones oficiales ACM](https://docs.aws.amazon.com/acm/latest/userguide/acm-conditions.html). No permite ejecutar el change set ni modificar IAM.

La ejecución aprobada necesitará después permisos de CloudFormation, IAM para el rol/perfil concreto y PassRole restringido, CloudFront/OAC/Function y alarma CloudWatch, incluyendo operaciones de recuperación. Se revisarán contra el change set real; no se pide AdministratorAccess ni se reemplazan los permisos actuales. No se solicitó certificado ni se creó change set por falta de acceso.

## Primera revisión y política de lectura

El 26 de octubre de 2026 STS confirmó una identidad IAM de la cuenta autorizada; las consultas de infraestructura fueron denegadas por falta de un Allow en las políticas de identidad. El propietario eligió preparar archivos y dejar el acceso pendiente. No se aplicó ninguna política ni se pidió una nueva Access Key.

La [plantilla de política de lectura](../deploy/preflight-readonly-policy.example.json) es una propuesta para revisión de un administrador autorizado. Las acciones se comprobaron en la [referencia oficial programática de autorización](https://docs.aws.amazon.com/service-authorization/latest/reference/service-reference.html) y errores reales. No deriva permisos de los algoritmos de la aplicación. No contiene ExecuteChangeSet, RunInstances, PassRole, AttachPolicy ni creación de recursos. Preparar el change set requerirá después `cloudformation:CreateChangeSet` sobre el stack concreto; esta política no lo concede.

| Bloque/Sid | Alcance y motivo |
| --- | --- |
| `OhioEc2Inventory` | Lecturas EC2 en Ohio; los listados requieren Resource * |
| `OhioVpcDns` | Atributos DNS de VPC de la propia cuenta en Ohio |
| `PublicAmazonLinuxAmi` | Solo el parámetro público AL2023 x86_64; sin parámetros privados ni decryption |
| `OhioEc2Quotas` | Cuotas EC2 de vCPU estándar y EIP de Ohio |
| `ExistingBudgetRead` | Ver Budget/notificaciones/suscriptores de la propia cuenta; nombre aún desconocido |
| `AccountPlanRead` | Consultar plan de cuenta; no cambiarlo |
| `CloudFormationInventory` / `CloudFormationStackRead` | Listar/describir stacks de Ohio; no modificarlos |
| `CloudFormationTemplateValidation` | Validar documento; no desplegar |
| `CloudFrontCertificateInventory` / `CloudFrontCertificateRead` | Listar/describir ACM de la cuenta en us-east-1; no solicitar ni exportar |
| `GlobalInventory` | Listar zonas, distribuciones y buckets para descubrir recursos; sin leer objetos |
| `PublicPriceRead` | Consultar precios públicos mediante Price List, sin aprovisionamiento |
| `OhioLogInventory` | Listar grupos de Ohio; sin leer eventos ajenos |
| `CurrentIamUserRead` | Políticas/grupos de la identidad IAM actual |
| `AccountGroupRead` / `PolicyDocumentRead` | Leer políticas heredadas y documentos; no modificarlos |

La plantilla pública usa `REPLACE_WITH_AUTHORIZED_ACCOUNT_ID`: sustituirlo por la cuenta autorizada antes de asociarla. [AWS no admite variables IAM en el campo account de un ARN](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_variables.html#policy-vars-resource). Se dejó una copia con el ID real exclusivamente en `deploy/evidence-private/phase3a2/preflight-readonly-policy.json`, modo 600 y fuera de Git. `aws:username` corresponde al usuario IAM actual y no existe en sesiones de rol: si se usa un rol temporal, adaptar la inspección al **rol concreto**, sin ampliar acceso por defecto. Los inventarios globales no permiten modificar DNS ni certificados.

Revisar como política administrada por el cliente; no asumir que cabe en el límite agregado de políticas inline de un usuario. No se validó con IAM Access Analyzer o simulación del servicio por falta de acceso. La comprobación local verifica JSON, acciones existentes y alcance de lectura. SCP, permission boundaries y políticas de sesión también pueden limitar el acceso; no se pudieron inspeccionar.

Una vez habilitado el acceso, repetir las consultas fallidas y limitar ARN/nombres a los recursos elegidos cuando sea posible. Verificar Budget y recursos antes de pedir permisos de despliegue. La ejecución que cree IAM, cómputo o gasto seguirá esperando la aprobación del change set específico.
