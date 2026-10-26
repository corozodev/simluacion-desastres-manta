# ADR-003: mock HTTP compartido y determinístico

Estado: aceptada. Fecha de la decisión: 2026-10-23.

## Contexto

Fixtures dentro de componentes no comprueban red, serialización, CORS, timeout ni compatibilidad entre React y Flutter. No se conoce todavía la persistencia ni los servicios del assignment.

## Decisión

Ejecutar una API Fastify local con 12 registros determinísticos y las cuatro operaciones de OpenAPI. Validar entrada y salida, emitir request IDs y utilizar un sobre común de errores. No conectar base de datos. El formulario responde `202` sin almacenar envíos ni alterar los fixtures.

Escuchar por defecto en `127.0.0.1:3001`, permitir CORS mediante orígenes exactos y habilitar fallos artificiales solo con `NODE_ENV=development` y `ENABLE_DEV_CONTROLS=true`. Limitar el retardo artificial a 2000 ms.

## Consecuencias

Los dos clientes prueban el mismo contrato por HTTP sin depender de AWS. Las lecturas son repetibles y el formulario valida el transporte sin inventar persistencia. La web necesita configuración CORS; Android necesita una dirección accesible distinta de su propio loopback.

Las pruebas de servidor usan `Fastify.inject`, mientras las pruebas de integración usan procesos HTTP reales. Este mock no representa escalado, autorización ni latencia de un backend desplegado. Su sustitución exige implementar el contrato y validar ambos clientes en el entorno nuevo; véase [integración AWS](../aws/integration.md).
