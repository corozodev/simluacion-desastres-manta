# API local

Las validaciones HTTP se derivan de `packages/contracts/openapi.yaml`; no dupliques esquemas. Importa modelos solamente desde `@corodev/contracts`. Valida entradas y salidas con Ajv, conserva request IDs y usa el sobre de error compartido incluso para rutas inexistentes. Los fixtures son deterministas. Las simulaciones requieren habilitación explícita y deben estar desactivadas en producción. Cambios de rutas necesitan pruebas de contrato, casos inválidos y documentación. Ejecuta `npm run test --workspace=@corodev/mock-api` y su comprobación de tipos desde la raíz.
