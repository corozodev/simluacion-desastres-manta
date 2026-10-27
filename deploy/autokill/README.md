# Caducidad de un despliegue CoroDev

Este auxiliar elimina exclusivamente el despliegue aprobado `corodev-phase2`. El [informe operativo](../../docs/despliegue-fase5-y-caducidad.md) documenta el horario real, alcance, backups, verificaciones y cancelación. No desplegarlo con parámetros supuestos: los ARN, IDs y buckets deben capturarse del stack real autorizado.

`handler.py` ejecuta un reconciliador idempotente. `build_template.py` genera `stack.json` con el código inline y permisos acotados para los proveedores de eliminación. AWS suministra boto3 en Python 3.13; el código configura reintentos y timeouts. Los tests aíslan completamente los clientes AWS.

```sh
python3 -m unittest discover -s deploy/autokill -v
python3 deploy/autokill/build_template.py deploy/autokill/stack.json
cfn-lint deploy/autokill/stack.json deploy/aws/stack.yaml
```

El despliegue exige `CAPABILITY_NAMED_IAM`. `ExpiresAtUtc` usa RFC3339 UTC; `ScheduleAtUtc` y `AuthorizationUntilUtc` requieren milisegundos (`2026-10-31T06:46:00.000Z`) por el proveedor Scheduler de CloudFormation. `ScheduleAtExpression` omite sufijo y zona (`2026-10-31T06:46:00`); el recurso declara UTC. El vencimiento de permisos debe ser posterior a la programación. Validar la política resuelta con Access Analyzer y revisar el change set antes de ejecutarlo.

Los recursos importados o compartidos se preservan. Los buckets `Retain` del proyecto se vacían después de borrar el stack, con todas sus versiones. El rol de la función permanece hasta que CloudFormation termina de retirar el auxiliar; la invocación en curso revoca la política y trata de eliminar el rol. Sus permisos tienen caducidad aunque ese último paso no termine. La cola de fallos y los logs pertenecen al auxiliar y se retiran con él; conservar evidencias fuera de AWS antes del vencimiento si se necesitan después.
