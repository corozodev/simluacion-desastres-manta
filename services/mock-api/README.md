# Mock API

API local con Fastify 5, Node 22 y TypeScript estricto. Lee las rutas y esquemas de `packages/contracts/openapi.yaml`. Ajv valida tanto entradas como respuestas **antes** de que la serialización pueda ocultar propiedades inválidas. Los tipos se importan de `@corodev/contracts`.

```sh
# Desde la raíz, después de npm install y de generar contratos
npm run dev --workspace=@corodev/mock-api
npm run typecheck --workspace=@corodev/mock-api
npm run test --workspace=@corodev/mock-api
npm run build --workspace=@corodev/mock-api
npm run start --workspace=@corodev/mock-api
```

El servidor escucha por defecto en `http://127.0.0.1:3001`. `PORT` cambia el puerto y `HOST` la interfaz. El arranque de producción sigue necesitando el contrato en su ubicación del monorepo; distribuye `packages/contracts/openapi.yaml` junto con `services/mock-api/dist/`. Para emuladores o dispositivos, inicia con `HOST=0.0.0.0` en una red local de confianza y configura la URL del cliente.

`CORS_ORIGINS` contiene orígenes exactos separados por comas (por defecto `http://localhost:5173`). No se aceptan comodines ni coincidencias por prefijo. La ausencia del encabezado CORS para un origen ajeno impide su acceso desde el navegador; los clientes nativos no aplican CORS. `x-request-id` se genera en el servidor, se devuelve en cada respuesta y es accesible para el navegador.

Los 12 elementos de demostración tienen IDs `item-001` a `item-012` y fechas fijas de fixture. El filtro busca en título y descripción. El formulario devuelve `202` sin modificar estos datos ni persistir envíos. Consulta operaciones y ejemplos en `packages/contracts/README.md`.

## Simular estados

Las simulaciones requieren **ambas** condiciones: `NODE_ENV=development` y `ENABLE_DEV_CONTROLS=true`. Sin ellas se ignoran todos los encabezados de simulación. En producción se ignoran aunque la variable de habilitación esté activa.

```sh
NODE_ENV=development ENABLE_DEV_CONTROLS=true npm run dev --workspace=@corodev/mock-api
curl -i http://localhost:3001/v1/demo/items -H 'x-demo-delay-ms: 800'
curl -i http://localhost:3001/v1/demo/items -H 'x-demo-fail: true'
```

`x-demo-delay-ms` acepta enteros entre 0 y 2000; otros valores devuelven `400`. `x-demo-fail: true` fuerza `500` con el sobre común. Una búsqueda `q=no-coincidencia-zzzz` demuestra el estado vacío sin encabezados especiales.

Las pruebas usan `Fastify.inject`, sin puertos ni servicios externos: paginación, búsqueda, validación de consultas y cuerpos, espacios en blanco, errores JSON, fallos de contrato en respuestas, CORS exacto, IDs y bloqueo de simulación fuera de desarrollo.

## Observación Track A

`GET /estado`, `GET /grafo` y `GET /healthz` conservan el flujo Mock/HTTP de ambos
clientes. Los datos son fixtures **sintéticas estáticas** de cuatro nodos y dos
sobrevivientes, identificadas en `source` y en un evento `synthetic_fixture`.
No representan coordenadas de Manta ni ejecutan un simulador. El backend Go del
puerto 8080 proporciona la simulación real y `POST /paso`; este mock no implementa
movimientos ni almacena credenciales.

Las fixtures reutilizan `packages/contracts/examples/graph.json` y `world.json`;
distribuye también esos dos archivos con el build del mock. La conversión de
OpenAPI 3.0 a Ajv adapta límites exclusivos booleanos a JSON Schema draft-07 sin
duplicar definiciones del contrato.
