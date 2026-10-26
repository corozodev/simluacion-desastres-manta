# Permisos para reanudar el preflight

## Change set creado y permisos finales

CF/ACM/CloudFront/cuotas y parámetro público ya responden. El certificado del frontend está ISSUED tras validar el CNAME; el change set real está creado y sin ejecutar. Se adaptaron los nombres de rol/perfil a `deploy-cli-ec2-corodev-phase2` para respetar la restricción de prefijo que configuró el propietario.

La simulación AWS detectó que faltan `iam:PutRolePolicy` y `iam:DeleteRolePolicy` sólo para ese rol, y permisos SSM para instalar/administrar el backend sin SSH. El [complemento final](../deploy/execute-changeset-policy.example.json) conserva los límites de tags Project=CoroDev/Name=corodev-phase2-backend, documentos exactos y sesiones propias. Incluye lecturas de eventos del stack/change set, plan y auditoría; no se aplicó desde el agente. La copia lista está en `deploy/evidence-private/phase3a2-final-preflight-20261026/execute-changeset-policy.json`, modo 600.

**Asociar como política administrada separada tras revisión/autorización:** el documento compacto supera el límite agregado de 2048 caracteres inline de un usuario. El ejemplo público exige cuenta y UUID del stack; la copia privada ya tiene ambos. Adjuntarlo no ejecuta CloudFormation. El cambio facturable sigue requiriendo aprobación de su ARN específico.

Simulaciones: los objetivos correctos permiten inline/SSM y los tags, roles, documentos o sesiones ajenos se deniegan. OpenDataChannel devolvió implicitDeny en simulador pese al patrón restringido del ejemplo oficial; requiere verificación real y no se amplió a Resource *. Run Command sí pasó por simulación. CloudWatch tagging y perfil IAM ya están permitidos; no se pidieron de nuevo. UpdateAssumeRolePolicy no se necesita para esta creación inicial.

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
