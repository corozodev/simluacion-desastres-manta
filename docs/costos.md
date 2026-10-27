# Costos AWS — FASE 3A.2

**Actualización del 27 de octubre — FASE 5:** el propietario elevó el Budget a **50 USD** y eligió mantener el plan FREE. La instancia ahora es **`m7i-flex.large` (2 vCPU / 8 GiB)**, con retirada programada a partir del **31 de octubre, 01:46 de Ecuador**. Su tarifa Linux On-Demand en Ohio, consultada en el [catálogo oficial EC2](https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/ec2-ondemand-without-sec-sel/US%20East%20(Ohio)/Linux/index.json), es **0,09576 USD/h**: **9,19 USD por 96 horas**, antes de créditos. EBS de 20 GB e IPv4 añaden aproximadamente **0,21 y 0,48 USD** por ese período bajo los supuestos históricos; tráfico, solicitudes, logs y el auxiliar de caducidad dependen del uso. Esto no incluye consumo anterior de la cuenta ni constituye una factura. Mantener sólo esa EC2 durante 730 horas costaría **69,90 USD**, por encima del Budget mensual de 50 USD; no extender el período sin revisar el costo. El Budget avisa y no impone un tope. Ver [operación, borrado y verificación](despliegue-fase5-y-caducidad.md). El cálculo siguiente conserva el escenario histórico `t3.small`.

Consulta del **26 de octubre de 2026**, America/Guayaquil. Región: **us-east-2 (Ohio)**. Estimación mensual base: **22,96 USD**; reservar **24 USD** para el consumo pequeño descrito. No es gasto observado, cotización ni límite de facturación.

El reintento con permisos nuevos comprobó el **Budget mensual real de 30 USD**, HEALTHY y sin filtros de cuenta. Tiene avisos ACTUAL al 85%/100% y FORECASTED al 100%, con un destinatario EMAIL por aviso. No se cambiaron ni duplicaron. Direcciones y respuestas completas se conservan privadas.

**Gasto acumulado observado por AWS Budgets: 0,00 USD**, consultado el 26 de octubre de 2026. Es un dato de cuenta con posible retraso, excluye créditos/reembolsos y no demuestra una factura final ni atribución exclusiva al proyecto. El stack aprobado ya creó los 14 recursos el 26 de octubre a las 18:04 de Ecuador. La última actualización del Budget devuelta por AWS es de las 14:41:50 de Ecuador, anterior al despliegue; ese cero todavía no refleja su consumo. La estimación usa catálogos públicos oficiales descargados; no se consultó Cost Explorer.

## Supuestos y cálculo reproducible

730 horas de Linux `t3.small` x86_64, disco de 20 GB gp3 con rendimiento base incluido, una IPv4 estable, 1 GB de web, 500 PUT/LIST y 10.000 GET S3, 100.000 solicitudes HTTPS y 10 GB CloudFront, 10 GB de salida directa de API, 1 GB de logs ingerido y una reserva de 1 GB-mes almacenado. Una alarma CPU; ninguna métrica personalizada. Retención de logs: siete días.

| Componente | Cálculo sin descuentos | USD/mes |
| --- | --- | ---: |
| EC2 `t3.small`, Ohio | 730 × 0,0208/h | 15,1840 |
| EBS gp3, Ohio | 20 × 0,08/GB-mes | 1,6000 |
| IPv4 pública, Ohio | 730 × 0,005/h | 3,6500 |
| S3 Standard web, Ohio | 1 × 0,023 + 500 × 0,000005 + 10.000 × 0,0000004 | 0,0295 |
| S3 artefactos | Reserva para bundle temporal y solicitudes; expiración siete días | 0,0100 |
| CloudFront `PriceClass_100` | 10 × 0,085/GB + 100.000 × 0,000001/solicitud HTTPS | 0,9500 |
| CloudFront Function SPA | 100.000 × 0,0000001/invocación | 0,0100 |
| Transferencia directa API | Reserva conservadora: 10 × 0,09/GB | 0,9000 |
| CloudWatch Logs, Ohio | 1 × 0,50/GB ingerido + 1 × 0,03/GB-mes almacenado | 0,5300 |
| CloudWatch alarma CPU, Ohio | 1 × 0,10/mes | 0,1000 |
| Budget existente y ACM integrado sin exportación | Monitoreo sin acciones de pago y certificado CloudFront | 0,0000 |
| **Total calculado** | Decimal, antes de redondear | **22,9635** |

El [JSON de cálculo](../deploy/cost-estimate-phase3a2.json) conserva cantidades, tarifas, procedencia y sumas. La salida API de 0,09/GB es una reserva de planificación, no una tarifa contractual verificada en la cuenta. El catálogo EC2 también publica `t3.medium` a 0,0416/h: con estos mismos supuestos subiría a **38,15 USD/mes**, superando el Budget informado. No cambiar de tamaño sin revisión y aprobación.

No se descuentan créditos, Free Tier ni franquicias compartidas. El plan FREE/ACTIVE y los créditos se verificaron en evidencia privada; no se cambió el plan. La elegibilidad no sustituye el seguimiento del gasto. CloudFront cobra por ubicación de entrega; `PriceClass_100` permite servir Ecuador desde sus ubicaciones admitidas. La fila usa el precio de entrega en Estados Unidos; revisar tráfico real y planes disponibles antes de aprobar. La plantilla no contrata un plan de tarifa plana.

## Fuentes consultadas

Se descargaron catálogos públicos, sin consultas pagadas a Cost Explorer:

- [EC2 Linux Ohio](https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/ec2-ondemand-without-sec-sel/US%20East%20(Ohio)/Linux/index.json) y [EBS](https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/ebs.json), publicación 23 de octubre de 2026.
- [S3 Ohio](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/us-east-2/index.json), publicación 15 de octubre.
- [IPv4/VPC Ohio](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonVPC/current/us-east-2/index.json), publicación 16 de octubre.
- [CloudWatch Ohio](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/current/us-east-2/index.json), publicación 7 de octubre.
- [CloudFront global](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudFront/current/index.json), publicación 19 de octubre; [tarifas y funciones](https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/).
- [Budgets](https://aws.amazon.com/aws-cost-management/aws-budgets/pricing/), [ACM](https://aws.amazon.com/certificate-manager/pricing/) y [transferencia EC2](https://aws.amazon.com/ec2/pricing/on-demand/).

Los endpoints regionales de precios no crean infraestructura. Catálogos completos y errores de cuenta permanecen en `deploy/evidence-private/phase3a2/`, excluido de Git.

## Budget y riesgos de consumo

La plantilla usa `CreateProjectBudget=false` y exige `ExistingBudgetName`. El parámetro **no demuestra que exista el Budget**: antes del change set verificar importe mensual en USD, cobertura/filtros, vigencia, salud, avisos y suscriptores. No crear otro presupuesto para resolver un permiso denegado.

El Budget monitoriza y avisa; **no detiene automáticamente los cargos**. Confirmar entrega de alertas con el propietario. Los avisos comprobados equivalen a 25,50 USD de gasto real (85%), 30 USD de gasto real y 30 USD previsto. Cada aviso tiene un email configurado; entrega aún sin confirmar. La captura de consola debe ser auténtica y privada en `docs/budget.png` o `deploy/evidence-private/`; aún no existe una captura de esta fase.

La estimación deja aproximadamente **7,04 USD** respecto al Budget informado para este proyecto aislado. El Budget puede cubrir otras aplicaciones de la cuenta. Tráfico API/CloudFront, logs, versiones S3 antiguas, pruebas sostenidas, snapshots, impuestos o soporte pueden consumir el margen. No hay NAT Gateway, ALB, RDS, ECR ni escalado automático.

Los créditos T3 se mantienen en `standard`: evitan cargos Unlimited pero pueden limitar CPU sostenida. El rendimiento local no demuestra que `t3.small` satisfaga objetivos externos.

Detener EC2 no elimina cargos de EBS ni de una EIP retenida. Borrar el stack tampoco borra buckets `Retain` ni el Budget externo. Revisar almacenamiento, versiones y recursos retenidos antes de declarar consumo terminado. Véase [despliegue y rollback](despliegue-aws.md).

## Gasto observado

AWS Budgets devolvió CalculatedSpend.ActualSpend de **0,00 USD** para el Budget mensual de cuenta. Su configuración excluye créditos y reembolsos. La fecha y alcance están en [la evidencia del reintento](../deploy/validation-phase3a2-retry.json) y [el cálculo actualizado](../deploy/cost-estimate-phase3a2.json). No interpretar ese importe como disponibilidad garantizada de créditos ni como costo final de los recursos ya desplegados.

No se consultó Cost Explorer: puede tener costo por consulta. No hay captura de consola auténtica disponible. La consulta posterior al despliegue sigue informando 0,00 USD con LastUpdatedTime anterior a la creación efectiva; consultar de nuevo cuando AWS actualice facturación. La captura no se fabricó. [Evidencia de despliegue](../deploy/validation-phase3a2-deployment.json).

En FASE 3B.1 se reutilizaron estos recursos y no se añadió infraestructura, agente, métrica personalizada o permiso IAM. Se publicaron nuevos objetos web/diagnóstico en los buckets existentes y se ejecutaron consultas acotadas de CloudWatch; el Budget sigue informando 0,00 USD con la misma actualización anterior al despliegue. La estimación aprobada no cambió. [Informe de esta iteración](informe-fase3b1.md).
