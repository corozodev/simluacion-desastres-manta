# React — Escape de Manta

Cliente de la API Go. `/` y los enlaces anteriores redirigen a `/escape`. El escenario zombie conserva el mapa, búsqueda de sobrevivientes, selección de rutas, refugios y conexión. El selector de escenarios añade un laboratorio experimental de inundación con controles reales del backend.

La URL predeterminada es `https://api.sistemamanta.lexinnovate.com`. `VITE_WORLD_API_BASE_URL` permite seleccionar explícitamente otra instancia Go; nunca contiene credenciales. Para desarrollo, iniciar Go con CORS para el origen de Vite:

```sh
VITE_WORLD_API_BASE_URL=http://localhost:8080 npm run dev:web
npm run test -w @corodev/web
npm run typecheck -w @corodev/web
npm run test:e2e
VITE_WORLD_API_BASE_URL=https://api.sistemamanta.lexinnovate.com npm run build:web
```

Zombie mantiene sus consultas Go y controles administrativos existentes. `/paso` y su credencial pertenecen al simulador, nunca al navegador. El polling de dos segundos pertenece a Escape; AppShell observa la misma caché sin iniciar otro temporizador. Inundación utiliza `/lab/*`, un polling independiente de 500 ms y una sesión local HttpOnly/CSRF en memoria.

Las pruebas de componentes y Chromium usan respuestas HTTP controladas exclusivamente en pruebas. La integración zombie contra Go real permanece en `tools/qa/check_http_contracts.mjs --urban --browser`; el laboratorio tiene `npm run test:lab:flood`. Ningún componente incorpora repositorios de ejemplos ni ejecuta un modelo de amenaza en React.

Las calles mantienen geometría OSM. La envolvente de referencia no equivale a límite oficial ni cobertura vial completa; los refugios son ficticios. Al terminar los turnos la API conserva el estado final, por lo que un mapa inmóvil no implica desconexión.

Para abrir ambos escenarios sin modificar código:

```sh
npm run dev:lab
# http://127.0.0.1:5173/escape
```

El comando configura `VITE_WORLD_API_BASE_URL` y `VITE_FLOOD_API_BASE_URL` con el mismo hostname para evitar diferencias de CORS/cookies. El controlador del laboratorio escucha únicamente en loopback, puerto 8082. El servidor de lectura 4A en 8081 se conserva por separado. La [guía 4B](../../docs/laboratorio-inundaciones.md) explica ejecución manual, capas, candidatos, A/B y límites.

**SIMULACIÓN — DATOS SINTÉTICOS.** Los escenarios de inundación emplean parámetros sintéticos y no constituyen pronósticos hidrológicos ni recomendaciones oficiales de evacuación.
