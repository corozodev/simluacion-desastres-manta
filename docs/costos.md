# Costos AWS y presupuesto

[Índice](INDEX.md) · [Despliegue](despliegue.md) · [Evidencia AWS](../deploy/validation-phase5-deployment.json)

**Proyección modelada: 77,68 USD/mes** para la instancia registrada
`m7i-flex.large` en Ohio, 730 horas y el uso pequeño descrito debajo.
**Gasto real atribuible al evento: pendiente de completar con Billing.**
Son cantidades distintas: una estimación no es factura ni prueba de consumo.
Fecha de referencia y consulta de precios públicos: **27 de octubre de 2026**.
Moneda USD, antes de créditos, descuentos, franquicias, impuestos y soporte.

## Proyección mensual reproducible

La evidencia de despliegue registra 2 vCPU / 8 GiB, 20 GiB gp3 cifrados y una
IPv4 pública. La lectura EC2 del 27 de octubre, 18:58 de Ecuador, confirmó
tipo, CPU, memoria y disco; no modifica los supuestos de consumo. Los precios Linux On-Demand de Ohio y las tarifas del modelo se
reconsultaron en los catálogos oficiales enlazados. Las cantidades de tráfico,
logs y solicitudes son **supuestos**, no observaciones. No hay NAT Gateway,
ALB, RDS ni ECR en el stack de aplicación.

| Componente | Supuesto y cálculo | USD/mes |
| --- | --- | ---: |
| EC2 `m7i-flex.large` | 730 h × 0,09576/h | 69,9048 |
| EBS gp3, rendimiento base | 20 GB-mes × 0,08 | 1,6000 |
| IPv4 pública | 730 h × 0,005 | 3,6500 |
| **Subtotal fijo modelado** | EC2 + disco + IPv4 | **75,1548** |
| S3 web y artefactos | 1 GB × 0,023 + 500 PUT/LIST × 0,000005 + 10.000 GET × 0,0000004 + reserva artefactos 0,01 | 0,0395 |
| CloudFront + función SPA | 10 GB × 0,085 + 100.000 HTTPS × 0,000001 + 100.000 funciones × 0,0000001 | 0,9600 |
| Salida directa API | Reserva de planificación: 10 GB × 0,09; tarifa efectiva de cuenta pendiente | 0,9000 |
| CloudWatch | 1 GB ingerido × 0,50 + 1 GB-mes almacenado × 0,03 + una alarma × 0,10 | 0,6300 |
| **Total de partidas modeladas** | Suma sin redondear | **77,6843** |

CloudFront `PriceClass_100` se modela con entrega en EE. UU.; el origen de la
petición, el plan y las franquicias reales pueden cambiar la factura. S3 de
artefactos y salida API son reservas explícitas. Logs tienen retención de siete
días, y la reserva mensual almacenada es conservadora. El auxiliar de caducidad
usa Scheduler/Lambda/SQS y logs: su costo depende de invocaciones, duración,
solicitudes y retención, **no cuantificados en ese total**. También quedan fuera
el dominio externo, almacenamiento retenido extra, versiones antiguas, tráfico
excedente e impuestos. No se aplica ningún descuento Free Tier supuesto.

Cálculo exacto con la biblioteca estándar, desde cualquier terminal con Python 3:

```sh
python3 - <<'PY'
from decimal import Decimal as D
fijo = D('730') * D('.09576') + D('20') * D('.08') + D('730') * D('.005')
s3 = D('.023') + D('500') * D('.000005') + D('10000') * D('.0000004') + D('.01')
cdn = D('10') * D('.085') + D('100000') * D('.000001') + D('100000') * D('.0000001')
api = D('10') * D('.09')
logs = D('.50') + D('.03') + D('.10')
print('Subtotal fijo USD:', fijo)
print('Total modelado USD:', fijo + s3 + cdn + api + logs)
print('EC2 durante 96 horas USD:', D('96') * D('.09576'))
PY
```

Sólo EC2 durante 96 horas cuesta **9,19296 USD** a esa tarifa, antes de créditos;
el resto de recursos se agrega. La proyección de 730 h no describe el período
real de vida de la demo, que tiene [retirada programada](despliegue-fase5-y-caducidad.md).
El [cálculo antiguo](../deploy/cost-estimate-phase3a2.json) de 22,96 USD/mes se
conserva como histórico: era `t3.small`, no la instancia actual.

## Fuentes de precios

Consultadas por HTTPS público el 27 de octubre, sin Cost Explorer ni llamadas
privadas de cuenta. Los precios seleccionados y sus unidades se contrastaron
con los catálogos; las fechas siguientes son las de publicación del catálogo:

| Fuente oficial | Publicación | Tarifas usadas |
| --- | --- | --- |
| [EC2 Linux Ohio](https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/ec2-ondemand-without-sec-sel/US%20East%20(Ohio)/Linux/index.json) | 27 oct 2026 | `m7i-flex.large` 0,09576/h, 2 vCPU, 8 GiB; rateCode `NF94DUQA29AU4W9G.JRTCKXETXF.6YS6EN2CT7` |
| [EBS](https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/ebs.json) | 27 oct 2026 | Ohio gp3 0,08/GB-mes |
| [VPC Ohio](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonVPC/current/us-east-2/index.json) | 16 oct 2026 | IPv4 0,005/h |
| [S3 Ohio](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/us-east-2/index.json) | 15 oct 2026 | Standard 0,023/GB-mes; PUT/LIST 0,000005; GET 0,0000004 |
| [CloudFront](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudFront/current/index.json) | 19 oct 2026 | EE. UU. 0,085/GB; HTTPS 0,000001; función 0,0000001 |
| [CloudWatch Ohio](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/current/us-east-2/index.json) | 7 oct 2026 | Ingesta 0,50/GB; almacenamiento 0,03/GB-mes; alarma 0,10/mes |

Los catálogos `current` pueden cambiar: revalidar antes de extender la demo o
modificar capacidad. [Precios públicos IPv4](https://aws.amazon.com/vpc/pricing/)
y [EC2 On-Demand](https://aws.amazon.com/ec2/pricing/on-demand/) explican
unidades y cargos adicionales; no se confunden con gasto de esta cuenta.

## Gasto real del evento y Budget

| Dato de entrega | Estado y fuente |
| --- | --- |
| Gasto real del proyecto durante el evento | **PENDIENTE**: completar importe, período, servicios incluidos y tratamiento de créditos/impuestos desde Billing/Cost Explorer o export confiable |
| Budget confirmado por lectura | **50 USD/mes**, COST/MONTHLY, HEALTHY; `describe-budgets` del 27 de octubre, aproximadamente 19:00 de Ecuador |
| Captura auténtica | **PENDIENTE**: el propietario debe añadir `docs/budget.png` tras ocultar datos sensibles |
| Entrega de alertas | Confirmación del destinatario pendiente; tener configuración no prueba recepción |

La lectura actual de Budgets informa **0,09 USD de gasto mensual de cuenta**,
con última actualización **27 de octubre, 05:36:07 de Ecuador**: el dato llega
con retraso y no corresponde a la hora de consulta. Se encontró un único Budget
de 50 USD, sin filtros de proyecto/servicio, que excluye créditos y reembolsos;
no devuelve pronóstico. **No es gasto atribuible al evento/proyecto** y no se
traslada al campo pendiente. No se consultó Cost Explorer ni destinatarios de
notificación y no se cambió configuración. La captura y recepción de alertas
siguen pendientes del propietario.

Un dato histórico de AWS Budgets mostró **0,00 USD el 26 de octubre** con una
actualización anterior al despliegue. Era gasto mensual de cuenta, con retraso,
sin atribución exclusiva al proyecto; **no se usa como gasto real final del
hackathon**. Su fuente y alcance permanecen en el
[registro histórico](../deploy/cost-estimate-phase3a2.json).

El Budget de 50 USD **no detiene cargos** y el mes modelado supera ese importe.
Detener EC2 conserva cargos de EBS/IPv4; buckets/versiones y recursos retenidos
siguen consumiendo. Revisar la [retirada prevista](despliegue.md#infraestructura-nueva-y-retirada),
conservar los datos necesarios y no extender la operación sin revisar el costo.

La captura está ignorada en Git por precaución. Tras revisarla, añadirla
explícitamente con `git add -f docs/budget.png` y activar esta línea en el README:

```markdown
![AWS Budget con alerta configurada](docs/budget.png)
```

No se creó una imagen ficticia ni se afirma que la captura esté publicada.
