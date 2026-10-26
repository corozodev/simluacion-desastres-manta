# Permisos para reanudar el preflight

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
