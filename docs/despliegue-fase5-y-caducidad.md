# FASE 5 en AWS y retirada programada

El 27 de octubre de 2026 se actualizó el despliegue autorizado de Ohio (`us-east-2`). [Escape](https://sistemamanta.lexinnovate.com/escape) y la [API](https://api.sistemamanta.lexinnovate.com/healthz) ejecutan FASE 5. La [evidencia resumida](../deploy/validation-phase5-deployment.json) distingue comprobaciones reales y límites; las respuestas completas permanecen privadas.

## Instancia y ejecución

El propietario eligió mantener el plan **FREE** en lugar de autorizar el cambio de facturación de toda la cuenta. Se utilizó **`m7i-flex.large`, 2 vCPU y 8 GiB**, elegible en esta cuenta; `m7i.xlarge` quedó descartada por requerir Paid. El Budget externo se verificó en **50 USD**. No se cambió el plan ni se creó otro presupuesto.

CloudFormation actualizó `corodev-phase2` y terminó en `UPDATE_COMPLETE`. Conservó la instancia, el disco raíz gp3 cifrado de 20 GB y la Elastic IP. Una política de stack impide reemplazar o retirar la instancia y los buckets durante actualizaciones; no impide `DeleteStack`. `CreditSpecification` sólo se aplica a los tipos T3. El reinicio interrumpió temporalmente la API; posteriormente se verificó HTTPS con DNS público normal.

Se desplegó la imagen Go `sha256:b3f8651035f81ac590fa8d98707476a111a821b52a0f0491abb2f5304eb617aa` y el bundle React de FASE 5. CloudFront terminó la invalidación. Los contenedores anteriores quedan detenidos para rollback; el laboratorio conserva su volumen ciudadano y su copia oficial. Se preservaron las credenciales privadas y sus archivos con permisos `600`, sin incorporarlas a Git ni al navegador. Caddy quedó activo con reinicio `unless-stopped`.

El backend tiene límite Docker de **4 GiB / 2 CPU**, `GOMAXPROCS=2` y `GOMEMLIMIT=3GiB`. El laboratorio independiente tiene **768 MiB / 0,5 CPU**. El manager admite **4 sesiones activas, hasta 1 FULL_MANTA, 16 retenidas y 1.024 MiB de reservas estimadas**. Las pausadas retienen cupo. El [perfil operativo](../deploy/backend.phase5-ec2.env.example) conserva TTL y límites de duración; `SIM_AUTOSTART=false` mantiene el mundo legacy en turno cero.

Una prueba HTTP acotada en la EC2 ejecutó simultáneamente tres sesiones zombie BASE y una inundación FULL_MANTA, **200 agentes en cada una y tres turnos**, con intervalo de cinco segundos. Las cuatro terminaron sin decisiones inválidas ni timeouts. La quinta creación y una segunda FULL devolvieron `503`. El lote duró 18,484 segundos; una muestra durante el intervalo indicó 108,2 MiB para el backend, sin medir el pico. Esto verifica esa combinación breve: no certifica carga sostenida, cuatro FULL simultáneas ni latencias HTTPS equivalentes a las decisiones internas.

El navegador público verificó exploración sin crear trabajo, creación única por doble clic, credenciales independientes, pausa/recarga/reanudación y finalización tras cerrar el navegador después de confirmar la reanudación. La prueba móvil completó una inundación FULL de cinco agentes y dos turnos, sin desborde horizontal. El laboratorio siguió accesible mediante `/lab/catalog` y `/flood-lab`. Las capturas se conservan privadas.

## Autokill autorizado

La solicitud quedó anclada al **27 de octubre de 2026, 06:45:51 UTC**. Los cuatro días vencen el **31 de octubre de 2026, 06:45:51 UTC**. Las acciones de Scheduler están habilitadas a partir de las **06:46 UTC / 01:46 de Ecuador del 31 de octubre**. El borrado completo es asíncrono y puede terminar después de esa hora.

El stack auxiliar `corodev-expiry-20261027` contiene dos programaciones independientes:

- `stop-instance`: solicita detener la EC2 concreta al vencer el plazo, para cortar su ejecución aunque el borrado posterior falle.
- `cleanup`: invoca cada minuto un reconciliador Lambda que elimina el ARN exacto capturado de `corodev-phase2`, espera su retirada, vacía y borra ambos buckets retenidos, incluidos históricos y marcadores, y elimina el certificado ACM dedicado cuando ya no está asociado. Después elimina su propio stack auxiliar.

La retirada incluye EC2, disco raíz, EIP, grupo de seguridad, distribución/función/OAC de CloudFront, roles/perfil del servicio, alarma, logs, web, artefactos y datos persistentes locales de reportes/referencia. **Es un borrado de datos, además del apagado.** Antes del cambio se descargó un backup privado de los dos archivos persistentes: 27.347 bytes, SHA-256 `a28d97fb4b5832373098a9eb89f9c2dc73a06565a4896be76362d1bc24aed75d`. No contiene los cambios posteriores de esos archivos. Está en `deploy/evidence-private/phase5-resize-expiry-20261027/citizen-reference-data-backup.tgz`, con permisos `600` y excluido de Git.

El Budget externo de 50 USD, la identidad del operador, la VPC y la subred compartidas se conservan. **Los registros DNS de Cloudflare están fuera de AWS y de este autokill**: retirar allí el A de `api.sistemamanta.lexinnovate.com` y el CNAME de `sistemamanta.lexinnovate.com` cuando se retire el servicio. Los archivos y backups locales tampoco se borran.

El reconciliador recibe IDs y fecha desde configuración fija, nunca desde el evento. Las operaciones de modificación están denegadas antes del vencimiento; todos sus permisos caducan el **2 de noviembre a las 01:46 de Ecuador**, tras una ventana de reintentos de dos días. Sus permisos se limitan a los recursos registrados y a lecturas requeridas por los proveedores CloudFormation. Una cola cifrada recibe fallos de entrega/ejecución. El plan de cuenta y Budget no sustituyen esta programación.

## Verificación del temporizador y límites

La invocación real `plan` identificó el stack correcto sin modificarlo; `execute` antes del plazo devolvió `waiting_for_deadline`. Una programación temporal de prueba invocó `plan` mediante el mismo rol de Scheduler y se autoeliminó. CloudWatch registró una entrega sin errores del destino. Las pruebas locales del reconciliador pasaron **12 casos**; ambas plantillas pasaron `cfn-lint`, y Access Analyzer no devolvió hallazgos para la política final.

La simulación de la política aislada comprobó denegación antes del plazo, permiso durante la ventana para el stack aprobado, rechazo de otro stack y denegación después de la ventana. El simulador del principal devolvió una denegación de Organizations incluso para `DescribeStacks`, mientras esa misma lectura funcionó desde Lambda. Por esa discrepancia, no se interpreta ese simulador como prueba de permisos efectivos de borrado. Se revisaron además los permisos declarados de eliminación de los proveedores CloudFormation. No se borró anticipadamente el proyecto para probar el desenlace futuro.

Una prueba auxiliar real comprobó la eliminación de un stack descartable y de su propio rol. El rol ejecutor se retiene durante la eliminación del auxiliar para que CloudFormation conserve sus credenciales; después la invocación en curso revoca su política e intenta retirar el rol. Si la revocación se propaga antes de esa última llamada, puede quedar un rol IAM sin política y sin costo. Si el proveedor tarda más que los cinco minutos de esa invocación final, puede quedar el rol con permisos caducados. El borrado futuro sigue sujeto a errores de AWS o cambios posteriores; revisar eventos y la cola si no concluye.

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

El código está en [deploy/autokill](../deploy/autokill/README.md), la actualización de tipo en [stack.yaml](../deploy/aws/stack.yaml) y el rollout con recuperación en [rollout-phase5.sh](../deploy/rollout-phase5.sh). Se conservaron los commits previos; no se hizo push.
