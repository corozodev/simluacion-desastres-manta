# Contrato compartido

`openapi.yaml` (OpenAPI 3.0.3) define la API de demostración, versión `0.1.0`. Los tipos TypeScript y modelos Dart se generan desde este archivo; los clientes consumen exactamente las mismas operaciones.

Desde la raíz:

```sh
npm run contracts:validate
npm run contracts:generate
```

No edites archivos en `generated/`. Para cambiar una respuesta o validación, modifica el YAML, regenera y actualiza consumidores y pruebas.

| Operación | Respuesta |
| --- | --- |
| `GET /health` | `200 HealthResponse` |
| `GET /v1/demo/items?page=1&pageSize=10&q=portal` | `200 ItemListResponse` |
| `GET /v1/demo/items/{id}` | `200 DemoItem` o `404 ErrorResponse` |
| `POST /v1/demo/submit` | `202 SubmitResponse` |

`page` comienza en 1; `pageSize` acepta 1–100 y `q` hasta 200 caracteres. La búsqueda compara título y descripción sin distinguir mayúsculas. `pagination.total` es el total filtrado antes de paginar; una página fuera del rango devuelve `data: []`. Los parámetros desconocidos se rechazan.

El formulario requiere `title` de 1–100 caracteres con al menos un carácter no blanco; se recortan sus extremos. `description` es opcional y acepta hasta 1000 caracteres. Los tipos JSON son estrictos y no se aceptan propiedades desconocidas. La respuesta `202` confirma aceptación de una demo sin almacenamiento.

Todas las respuestas de error usan `{ "error": { "code", "message", "requestId", "details" } }`; `details` siempre es un arreglo. Los códigos son `VALIDATION_ERROR`, `NOT_FOUND` e `INTERNAL_ERROR`. El encabezado `x-request-id` permite correlacionar la respuesta y los registros sin enviar detalles internos al cliente.

Los archivos de `examples/` son ejemplos ilustrativos. Fechas e identificadores fijos son datos de muestra, no evidencia de ejecución. Para ejecutar solicitudes reales:

```sh
curl -s http://localhost:3001/health
curl -s 'http://localhost:3001/v1/demo/items?page=2&pageSize=5&q=idea'
curl -s http://localhost:3001/v1/demo/items/item-001
curl -s -X POST http://localhost:3001/v1/demo/submit \
  -H 'Content-Type: application/json' \
  -d '{"title":"Mi primera idea","description":"Una prueba compartida"}'
```

## Track A — evacuación

El contrato añade `POST /paso` autenticado por `x-api-key`, y observaciones públicas `GET /estado`, `GET /grafo`, `GET /healthz`. Los endpoints demo se conservan. El grafo se publica separado del snapshot y las coordenadas usan `lat`/`lng`; el estado usa snake_case. La solicitud y respuesta de `/paso` respetan exactamente `sobrevivienteId`, `nodoActual`, `turno` y `siguienteNodo`.

`generated/schemas.json` exporta las definiciones como JSON Schema draft-07. Los archivos `world.schema.json`, `graph.schema.json`, `paso-request.schema.json` y `paso-response.schema.json` referencian ese documento y se generan desde OpenAPI. El generador transforma límites exclusivos de OpenAPI 3.0 y nombres snake_case a campos camelCase en Dart sin modificar el JSON de transporte.

Los sleepers dormidos se excluyen de los snapshots y nunca se envían a clientes o decisiones. El WebSocket queda pendiente; el cliente debe consultar `/estado` mediante polling. No incluir API keys en clientes ni ejemplos versionados.
