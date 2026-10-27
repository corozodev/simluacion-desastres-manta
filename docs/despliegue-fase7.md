# Publicación FASE 7

El 27 de octubre de 2026 se publicó FASE 7 en
[GitHub](https://github.com/corozodev/simluacion-desastres-manta) y se sustituyó
el backend de la EC2 existente de Ohio (`us-east-2`), sin cambiar instancia,
credenciales, cuotas, datos ciudadanos ni la caducidad AWS programada.

- [Abrir Escape](https://sistemamanta.lexinnovate.com/escape).
- [Laboratorio de inundaciones](https://sistemamanta.lexinnovate.com/flood-lab).
- [Disponibilidad de la API](https://api.sistemamanta.lexinnovate.com/healthz).
- [Registro de despliegue](../deploy/validation-phase7-deployment.json).

Por instrucción del propietario, **no se ejecutaron tests, benchmarks ni builds
en esta operación**. Se reutilizaron el ejecutable Go y `apps/web/dist` compilados
en la fase local anterior. El ejecutable, SHA-256
`2c3e4627fdc38fc7898d4271e36fb353c09432e8f62425bd006dd4c03fc094f4`,
se monta como archivo de sólo lectura en la imagen Debian ya instalada; no se
creó otra imagen. El laboratorio reutiliza su ejecutable y almacenamiento.

Se mantuvieron 4 GiB/2 CPU para el backend, los controles de seguridad del
contenedor y `SIM_AUTOSTART=false`. La sustitución recreó el laboratorio para
vincularlo al nuevo namespace de red. API y catálogo respondieron HTTP 200;
el hash del HTML público coincide con el artefacto local. Son comprobaciones
de disponibilidad e integridad del despliegue, no una nueva validación funcional.

Después de activar la nueva versión se eliminaron los cuatro contenedores
anteriores retenidos y los archivos web obsoletos del bucket. La imagen base
compartida permanece porque los servicios activos la necesitan. CloudFront
recibió invalidaciones para sustituir el frontend y retirar archivos anteriores.
Los reportes históricos y los datos persistentes de inundaciones se conservan.

La validación funcional y los límites medidos de FASE 7 permanecen documentados en
[el informe local](informe-fase7.md); este despliegue no amplía sus garantías.
