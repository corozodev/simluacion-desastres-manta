# React — Escape de Manta

Cliente de observación de la API Go. `/` y los enlaces anteriores redirigen a `/escape`. La interfaz conserva el mapa, búsqueda de sobrevivientes, selección de rutas, refugios y estado de conexión de evacuación.

La URL predeterminada es `https://api.sistemamanta.lexinnovate.com`. `VITE_WORLD_API_BASE_URL` permite seleccionar explícitamente otra instancia Go; nunca contiene credenciales. Para desarrollo, iniciar Go con CORS para el origen de Vite:

```sh
VITE_WORLD_API_BASE_URL=http://localhost:8080 npm run dev:web
npm run test -w @corodev/web
npm run typecheck -w @corodev/web
npm run test:e2e
VITE_WORLD_API_BASE_URL=https://api.sistemamanta.lexinnovate.com npm run build:web
```

El adaptador sólo consulta `/healthz`, `/grafo` y `/estado`. `/paso` y su credencial pertenecen al simulador, nunca al navegador. El polling de dos segundos pertenece a Escape; AppShell observa la misma caché sin iniciar otro temporizador.

Las pruebas de componentes y Chromium usan respuestas HTTP controladas exclusivamente en pruebas. La integración contra Go real permanece en `tools/qa/check_http_contracts.mjs --urban --browser`. El cliente no incorpora repositorios de ejemplos ni servidores alternativos.

Las calles mantienen geometría OSM. La envolvente de referencia no equivale a límite oficial ni cobertura vial completa; los refugios son ficticios. Al terminar los turnos la API conserva el estado final, por lo que un mapa inmóvil no implica desconexión.
