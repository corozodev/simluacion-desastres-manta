# Contrato HTTP compartido

[`openapi.yaml`](openapi.yaml), OpenAPI 3.0.3, es la fuente de operaciones y esquemas
para la API Go. Conserva el contrato español de `/paso`, estado/geografía,
sesiones, laboratorio, publicados, incidentes y referencias.

Desde la raíz:

```sh
npm run contracts:validate
npm run contracts:generate
npm run generated:check
```

Se generan tipos TypeScript, JSON Schema draft-07 y los DTO Dart alcanzables por
las operaciones móviles seleccionadas. No edites `generated/` ni los modelos
Dart derivados a mano. El generador no implementa endpoints ni transporte.

[Contratos, autenticación, ejemplos y límites del generador](../../docs/contratos.md).
`examples/` conserva datos sintéticos útiles para documentación y pruebas; no
son mediciones ni geografía oficial de refugios. Las verificaciones HTTP usan Go
real y validan contra los esquemas generados.
