# Revisión de seguridad del operador — FASE 3A.2

**Estado vigente después de la autorización:** el propietario aprobó expresamente el change set `phase3a2-20261026T211726Z` y se ejecutó exclusivamente ese ARN. El stack alcanzó CREATE_COMPLETE con los 14 recursos; plantilla, parámetros y costo revisados permanecen intactos. El operador deploy-cli tiene AdministratorAccess por elección y asociación del propietario; la EC2 conserva SSM/logs/releases, sin AdministratorAccess. Run Command y Session Manager se comprobaron realmente. La cuenta sigue FREE/ACTIVE; no se cambió el plan ni se descontaron créditos de la estimación. [Evidencia de despliegue](../deploy/validation-phase3a2-deployment.json).

La autorización limitó la actuación del agente al cambio revisado. AdministratorAccess permite técnicamente operaciones más amplias y no equivale a una restricción IAM al único change set. No se ampliaron permisos del runtime ni se crearon nuevas claves.

**Registro histórico de la alternativa acotada y sus bloqueos, anterior a la elección administrativa y la aprobación.** Las referencias siguientes a permisos faltantes o ejecución pendiente describen ese momento; el estado vigente es el indicado arriba.

**Estado intermedio conservado:** el propietario aplicó la base v2 y el complemento; ambos coinciden con los documentos revisados. Diez simulaciones de los permisos efectivos pasaron. DescribeEvents sigue denegado en AWS, incluso con una sesión temporal nueva. El propietario pidió usar permisos globales para desarrollo en la identidad operadora. Se intentó asociar AdministratorAccess, pero el operador carece de AttachUserPolicy: la asociación queda pendiente de un administrador autorizado. No se creó otra cuenta ni se cambiaron claves, rol EC2, plantilla, parámetros o change set. No existe aprobación de ejecución. [Estado actual](../deploy/validation-phase3a2-operator-effective.json).

El resto del documento conserva la revisión anterior de la alternativa acotada. AdministratorAccess, una vez asociado por el propietario, será una decisión explícita distinta y no permite afirmar mínimo privilegio global del operador. El rol runtime de EC2 conserva su alcance limitado.

Revisión del 26 de octubre de 2026, America/Guayaquil. Sólo consultas AWS y revisión de permisos: **sin ejecutar CloudFormation, modificar IAM, crear otro change set o repetir pruebas locales**.

## Integridad del cambio existente

| Control | Resultado |
| --- | --- |
| Change set | `phase3a2-20261026T211726Z` |
| Estado | CREATE_COMPLETE / AVAILABLE |
| Stack | `corodev-phase2`, Ohio, REVIEW_IN_PROGRESS |
| ARN y UUID | Coinciden exactamente con el recibo original privado |
| Recursos | Mismos 14 Add; ningún Modify, Remove o reemplazo |
| Plantilla AWS y archivo local | SHA-256 `be8bbda4995169bfe75342ddeb3746ebcb1e05c83e4064ce3579cd9967eadbf5` |
| Parámetros locales | SHA-256 `bd72f438eb145b5881966c7bba29ca2661043d24ef2d1b389f4d3f54d3536315`; valores AWS coincidentes |
| Costo | Mismos supuestos y partidas: 22,96 USD/mes, reserva 24 USD |
| Certificado | ISSUED para el frontend; región us-east-1 |
| Presupuesto | Mensual 30 USD, HEALTHY; último gasto informado 0,00 USD, con retraso posible |

El cuerpo original obtenido con GetTemplate desde AWS conserva **el mismo hash de bytes**, no sólo equivalencia YAML. El parámetro adicional de AWS es el valor predeterminado vacío de BudgetEmail; el Budget nuevo continúa desactivado. Ninguna revisión de permisos cambia esos inputs.

GetTemplateSummary no funciona contra un stack REVIEW_IN_PROGRESS; esa respuesta no implica un defecto de plantilla. Se conserva la validación AWS anterior correcta, vinculada al mismo hash. DescribeEvents todavía devuelve AccessDenied: **no se puede afirmar que se revisaron sus eventos detallados**.

## Hallazgo: administración de políticas internas

`iam:PutRolePolicy` permite escribir cualquier documento inline en el rol autorizado. Acotar Resource al rol **no limita el contenido de ese documento**. Combinado con PassRole y cómputo puede permitir escalamiento si se acepta otro payload. `DeleteRolePolicy` es necesario para la recuperación de esta creación.

El complemento revisado limita ambas acciones al rol exacto, al principal operador y a `aws:CalledViaLast=cloudformation.amazonaws.com`. Una llamada directa no recibe ese Allow. [CloudFormation documenta FAS para sus operaciones](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/fas-requests-and-permission-evaluation.html).

Esa condición por sí sola **no vincula la política al change set**. Por eso también se preparó un reemplazo del bloque CloudFormation de la política actual DeployCliPolicy:

- Lecturas sólo del stack/cambio concreto.
- ExecuteChangeSet sólo sobre ese stack y con el ARN completo del cambio como condición.
- Etiquetado del stack concreto como dependencia de ejecución.
- Retira CreateStack, UpdateStack, CreateChangeSet, DeleteStack y DeleteChangeSet de ese bloque.

El resto de los bloques de DeployCliPolicy se conserva idéntico. **Es un reemplazo de la política existente**, no otra política Allow adicional: adjuntar otra sin retirar el Allow amplio anterior no restringe los permisos efectivos. La condición ChangeSetName corresponde al parámetro API; al ejecutar debe utilizarse el ARN completo. [Condiciones de CloudFormation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/control-access-with-iam.html).

No se modificó el rol EC2 ni su política de runtime. Los archivos siguientes son de la **identidad operadora deploy-cli**.

## Separación de documentos

| Documento público de referencia | Uso |
| --- | --- |
| [operator-base-policy.example.json](../deploy/operator-base-policy.example.json) | Reemplazo de DeployCliPolicy: acota su bloque CloudFormation al plan preparado; conserva los demás bloques |
| [execute-changeset-policy.example.json](../deploy/execute-changeset-policy.example.json) | Imprescindible: inline vía CloudFormation y Run Command limitado al backend, documento exacto y lectura de resultados |
| [admin-ssm-policy.example.json](../deploy/admin-ssm-policy.example.json) | Administración interactiva Session Manager, separada de la instalación por Run Command |
| [audit-readonly-policy.example.json](../deploy/audit-readonly-policy.example.json) | Opcional: plan Free Tier y lectura CloudTrail; no crea ni cambia auditoría |

Las copias concretas con cuenta/UUID están en `deploy/evidence-private/phase3a2-operator-audit-20261026/`, modo 600. Los ejemplos públicos requieren reemplazar marcadores. La ruta original del complemento execute-changeset-policy.json también se actualizó, conservando una copia de la versión previa en la evidencia de auditoría.

Los documentos comprueban el ARN de la identidad **operadora**, además de las restricciones de recursos/región. No deben asociarse al rol EC2. Los documentos para Run Command y Session Manager son distintos y no permiten ejecutar otros documentos SSM; la instancia debe tener ambos tags Project=CoroDev y Name=corodev-phase2-backend.

## Variable de sesiones y canal de datos

`${aws:username}` es una variable de evaluación IAM, no una variable de shell. Para la identidad comprobada se resuelve a deploy-cli. Es válida en la porción resource del ARN de sus sesiones; no está disponible de la misma forma para roles/SSO. El ARN del principal también está acotado al usuario actual. [Variables IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_variables.html).

La referencia de autorización de ssmmessages no admite ARN Resource para OpenDataChannel. El documento interactivo usa **Resource * sólo para esa acción**, limitado al operador y Ohio, en lugar de afirmar falsamente aislamiento por ARN de sesión. ResumeSession/TerminateSession mantienen el ARN de sesiones propias. Esta ampliación de alcance del canal es **explícita y separada**, no se aplica automáticamente ni es requisito de Run Command. La sesión real debe comprobarse después de crear la instancia. [Referencia ssmmessages](https://docs.aws.amazon.com/service-authorization/latest/reference/list_ssmmessages.html).

## Permisos efectivos y límites

La identidad AWS sigue siendo IAM user deploy-cli, no root, sin permissions boundary. El complemento no está asociado y no hay políticas inline de usuario: todavía faltan los permisos efectivos de inline/SSM y lectura de eventos. Las simulaciones prueban evaluación de políticas/contextos; no sustituyen ejecución real o comprobación de las políticas nuevas ya asociadas.

Los FullAccess preexistentes de EC2/VPC/S3/logs no se alteraron. Esta revisión reduce la ruta CloudFormation y los permisos añadidos; **no certifica mínimo privilegio global de todas las políticas de la cuenta**. No se propusieron permisos administrativos generales nuevos ni una permissions boundary sobre la EC2.

CloudTrail y Free Tier quedan como lecturas opcionales: no bloquearán el despliegue por no adjuntar el documento de auditoría. cfn-guard no se ejecutó y no se instalaron herramientas. Se conservan las evidencias locales previas sin repetirlas.

## Siguiente paso

1. Un administrador autorizado reemplaza DeployCliPolicy con la copia concreta operator-base-policy.json.
2. Asocia el complemento imprescindible execute-changeset-policy.json al operador. Los documentos de administración interactiva y auditoría se revisan por separado.
3. El agente vuelve a leer las políticas efectivas y DescribeEvents; comprueba que no haya validaciones bloqueantes y que los inputs sigan inmutables.
4. Sólo entonces presenta la autorización final para ejecutar **exclusivamente el ARN ya preparado**.

No hay aprobación de ejecución recibida, infraestructura facturable aprovisionada ni nuevos algoritmos/funcionalidades.
