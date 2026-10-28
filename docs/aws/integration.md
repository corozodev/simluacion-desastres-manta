# Integración AWS

La guía vigente se consolidó en [Despliegue y operación AWS](../despliegue.md).
El sistema utiliza EC2/Docker/Caddy y S3/CloudFront, con clientes React y Flutter
conectados a Go. Las propuestas antiguas de API Gateway/Lambda para sustituir
el mock no describen esta arquitectura. El [diagrama actual](../arquitectura.md)
identifica los componentes internos y los servicios externos.
