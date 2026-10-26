# Contrato HTTP y generación

La fuente de verdad es [`packages/contracts/openapi.yaml`](../../packages/contracts/openapi.yaml), OpenAPI 3.0.3. Los ejemplos en `packages/contracts/examples/` ilustran cuerpos; no sustituyen las pruebas HTTP ni documentan una ejecución real.

| Operación | Entrada | Respuesta |
| --- | --- | --- |
| `GET /health` | Sin cuerpo | 200: `status`, `service`, `version` |
| `GET /v1/demo/items` | `page >= 1`, `pageSize` 1–100, `q` opcional hasta 200 caracteres | 200: `data`, `pagination` |
| `GET /v1/demo/items/{id}` | ID de 1–100 caracteres | 200: registro; 404: error |
| `POST /v1/demo/submit` | `title` requerido, 1–100 caracteres y contenido no blanco; `description` opcional hasta 1000 | 202: confirmación sin persistencia |

El servidor recorta los extremos del título. Rechaza propiedades adicionales y tipos JSON incorrectos. Los parámetros de consulta desconocidos también se rechazan. Las cadenas `active`, `pending` y `completed` son estados de ejemplo; no representan un proceso de negocio.

## Error común

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Revisa los datos enviados.",
    "requestId": "identificador-de-ejemplo",
    "details": [{ "field": "title", "message": "Dato inválido" }]
  }
}
```

`details` siempre es un arreglo; puede estar vacío. Los códigos del servidor son `VALIDATION_ERROR`, `NOT_FOUND` e `INTERNAL_ERROR`. Los clientes añaden errores locales de configuración, red, timeout o parsing; esos códigos locales no se reciben de los endpoints. `x-request-id` está expuesto por CORS para poder correlacionar una respuesta desde el navegador.

## Cambiar y sincronizar

Desde la raíz:

```sh
# Editar primero packages/contracts/openapi.yaml
npm run contracts:validate
npm run contracts:generate
npm run generated:check
npm run check
npm test
```

Después actualiza adaptadores, pantallas y pruebas que dependan del cambio. Ejecuta también las verificaciones Flutter de [testing.md](../development/testing.md). Cambiar una ruta en OpenAPI no crea automáticamente la implementación del endpoint ni su método de transporte.

| Archivo | Cómo se mantiene |
| --- | --- |
| `packages/contracts/openapi.yaml` | Edición manual, origen de esquemas y operaciones |
| `packages/contracts/examples/*.json` | Edición manual; mantener coherencia con el contrato |
| `packages/contracts/generated/api.d.ts` | Generado con `openapi-typescript` 7; no editar |
| `apps/mobile/lib/core/api/generated/models.dart` | Generado con `tools/codegen/contracts.mjs`; no editar |
| `apps/web/src/services/api.ts` | Adaptador fetch manual y tipado |
| `apps/mobile/lib/core/api/demo_repository.dart` | Repositorio Dio manual y tipado |
| `services/mock-api/src/contract.ts` | Carga del YAML y validación Ajv de entradas/salidas |

`npm run generated:check` compara el contenido esperado de modelos y tokens sin escribir archivos. Si falla, regenera desde el origen; no ajustes el archivo derivado para silenciar la diferencia.

## Alcance del generador

No se genera un SDK completo. TypeScript incluye tipos de operaciones y alias de esquemas; Dart incluye modelos con `fromJson` y `toJson`. El transporte, la cancelación, los tiempos de espera y la traducción de errores son adaptadores manuales.

El generador Dart admite objetos nombrados, referencias a esos objetos, campos escalares y listas. Los campos opcionales se representan como anulables. Falla ante esquemas no soportados, como composición `oneOf`/`anyOf`/`allOf`, nulabilidad explícita o formas de objeto no contempladas. Las enumeraciones Dart se representan como `String`; los modelos no implementan toda la validación semántica de OpenAPI. Antes de extender el contrato con una forma nueva, amplía y prueba el generador o adopta una herramienta compatible. No omitas silenciosamente campos.

## Probar el servidor

```sh
curl -i http://localhost:3001/health
curl -i 'http://localhost:3001/v1/demo/items?page=1&pageSize=6&q=portal'
curl -i http://localhost:3001/v1/demo/items/item-001
curl -i http://localhost:3001/v1/demo/items/no-existe
curl -i -X POST http://localhost:3001/v1/demo/submit \
  -H 'Content-Type: application/json' \
  -d '{"title":"Prueba compartida","description":"Solo demostración"}'
```

El mock compilado sigue leyendo el YAML: al distribuir `services/mock-api/dist`, incluye `packages/contracts/openapi.yaml` conservando su ruta relativa del monorepo. No es un artefacto autónomo que pueda copiarse sin el contrato.
