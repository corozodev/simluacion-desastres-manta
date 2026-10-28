# ADR-002: OpenAPI primero y adaptadores tipados

Estado: aceptada. Fecha de la decisión: 2026-10-23.

## Contexto

Duplicar modelos manualmente en TypeScript y Dart puede producir diferencias de nombres, opcionalidad y errores. Los dos clientes deben consumir el mismo servidor real y poder sustituir su URL por un endpoint futuro.

## Decisión

Usar `packages/contracts/openapi.yaml`, OpenAPI 3.0.3, como origen de operaciones y esquemas. Validarlo con Swagger Parser y generar tipos TS con `openapi-typescript` 7. Generar modelos Dart con un script acotado a las formas actuales, que rechaza formas no soportadas. Mantener fetch y Dio como adaptadores manuales tipados, en lugar de introducir un SDK completo y su toolchain.

Fastify carga el mismo contrato para validar solicitudes y respuestas. Los archivos generados llevan advertencia y se comprueban mediante `npm run generated:check`.

## Consecuencias

Los cambios comienzan por el YAML y exigen regenerar ambos lenguajes. Agregar una operación sigue requiriendo implementación de servidor y adaptadores. Los tipos TypeScript desaparecen al ejecutar; el parsing Dart tampoco cubre todas las reglas del esquema. La validación del servidor y las pruebas de transporte siguen siendo necesarias.

Composición, nulabilidad explícita y otras formas nuevas requieren ampliar y probar el generador o adoptar una herramienta compatible. La limitación está documentada; no se anuncia un SDK generado completo ni soporte general de OpenAPI. La secuencia de trabajo y los derivados están en [contratos](../contratos.md#generación-y-cambio-del-contrato).
