# Caducidad de un despliegue CoroDev

Este auxiliar elimina exclusivamente el despliegue aprobado `corodev-phase2`. La [guía AWS](../../docs/despliegue.md#infraestructura-nueva-y-retirada) identifica la instalación; esta página conserva horario, alcance y cancelación del auxiliar. No desplegarlo con parámetros supuestos: los ARN, IDs y buckets deben capturarse del stack real autorizado.

`handler.py` ejecuta un reconciliador idempotente. `build_template.py` genera `stack.json` con el código inline y permisos acotados para los proveedores de eliminación. AWS suministra boto3 en Python 3.13; el código configura reintentos y timeouts. Los tests aíslan completamente los clientes AWS.

```sh
python3 -m unittest discover -s deploy/autokill -v
python3 deploy/autokill/build_template.py deploy/autokill/stack.json
cfn-lint deploy/autokill/stack.json deploy/aws/stack.yaml
```

El despliegue exige `CAPABILITY_NAMED_IAM`. `ExpiresAtUtc` usa RFC3339 UTC; `ScheduleAtUtc` y `AuthorizationUntilUtc` requieren milisegundos (`2026-10-31T06:46:00.000Z`) por el proveedor Scheduler de CloudFormation. `ScheduleAtExpression` omite sufijo y zona (`2026-10-31T06:46:00`); el recurso declara UTC. El vencimiento de permisos debe ser posterior a la programación. Validar la política resuelta con Access Analyzer y revisar el change set antes de ejecutarlo.

Los recursos importados o compartidos se preservan. Los buckets `Retain` del proyecto se vacían después de borrar el stack, con todas sus versiones. El rol de la función permanece hasta que CloudFormation termina de retirar el auxiliar; la invocación en curso revoca la política y trata de eliminar el rol. Sus permisos tienen caducidad aunque ese último paso no termine. La cola de fallos y los logs pertenecen al auxiliar y se retiran con él; conservar evidencias fuera de AWS antes del vencimiento si se necesitan después.

## Programación registrada

La solicitud quedó anclada al **27 de octubre de 2026, 06:45:51 UTC**. Los cuatro días vencen el **31 de octubre de 2026, 06:45:51 UTC**. Las acciones de Scheduler están habilitadas a partir de las **06:46 UTC / 01:46 de Ecuador del 31 de octubre**. El borrado completo es asíncrono y puede terminar después de esa hora.

El stack auxiliar `corodev-expiry-20261027` contiene dos programaciones independientes:

- `stop-instance`: solicita detener la EC2 concreta al vencer el plazo, para cortar su ejecución aunque el borrado posterior falle.
- `cleanup`: invoca cada minuto un reconciliador Lambda que elimina el ARN exacto capturado de `corodev-phase2`, espera su retirada, vacía y borra ambos buckets retenidos, incluidos históricos y marcadores, y elimina el certificado ACM dedicado cuando ya no está asociado. Después elimina su propio stack auxiliar.

La retirada incluye EC2, disco raíz, EIP, grupo de seguridad, distribución/función/OAC de CloudFront, roles/perfil del servicio, alarma, logs, web, artefactos y datos persistentes locales de reportes/referencia. **Es un borrado de datos, además del apagado.** Antes del cambio se descargó un backup privado de los dos archivos persistentes: 27.347 bytes, SHA-256 `a28d97fb4b5832373098a9eb89f9c2dc73a06565a4896be76362d1bc24aed75d`. No contiene los cambios posteriores de esos archivos. Está en `deploy/evidence-private/phase5-resize-expiry-20261027/citizen-reference-data-backup.tgz`, con permisos `600` y excluido de Git.

El Budget externo de 50 USD, la identidad del operador, la VPC y la subred compartidas se conservan. **Los registros DNS de Cloudflare están fuera de AWS y de este autokill**: retirar allí el A de `api.sistemamanta.lexinnovate.com` y el CNAME de `sistemamanta.lexinnovate.com` cuando se retire el servicio. Los archivos y backups locales tampoco se borran.

El reconciliador recibe IDs y fecha desde configuración fija, nunca desde el evento. Las operaciones de modificación están denegadas antes del vencimiento; todos sus permisos caducan el **2 de noviembre a las 01:46 de Ecuador**, tras una ventana de reintentos de dos días. Sus permisos se limitan a los recursos registrados y a lecturas requeridas por los proveedores CloudFormation. Una cola cifrada recibe fallos de entrega/ejecución. El plan de cuenta y Budget no sustituyen esta programación.

## Inspección y cancelación

Consultar ambos horarios y estados:

```sh
aws scheduler get-schedule --region us-east-2 \
  --group-name corodev-expiry-20261027 --name stop-instance
aws scheduler get-schedule --region us-east-2 \
  --group-name corodev-expiry-20261027 --name cleanup
aws cloudformation describe-stacks --region us-east-2 \
  --stack-name corodev-expiry-20261027
```

Para cancelar antes del vencimiento, eliminar **ambas** programaciones con los siguientes comandos. Esto genera drift intencional; no aplicar posteriormente una actualización que las restaure. Una acción ya despachada requiere revisar también las invocaciones/reintentos; estos comandos por sí solos no revierten un borrado iniciado.

```sh
aws scheduler delete-schedule --region us-east-2 \
  --group-name corodev-expiry-20261027 --name stop-instance
aws scheduler delete-schedule --region us-east-2 \
  --group-name corodev-expiry-20261027 --name cleanup
```

La evidencia de esa operación está en [validation-phase5-deployment.json](../validation-phase5-deployment.json).
Se verificaron `plan`, rechazo de `execute` antes del plazo y entrega de Scheduler;
no se adelantó el borrado del proyecto para probarlo. La eliminación futura puede
fallar o dejar un rol sin permisos: revisar eventos y cola. Las políticas caducan
tras la ventana registrada. Durante la limpieza documental previa no se consultó ni cambió AWS; la comprobación de publicación posterior fue de sólo lectura.
