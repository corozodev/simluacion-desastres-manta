# Cliente React — Escape de Manta

Desde la raíz: `VITE_WORLD_API_BASE_URL=http://localhost:8080 npm run dev:web` y abrir `/escape`. La URL es pública; no contiene credenciales. Sin override se conserva el mock HTTP local del starter.

FASE 2 añade controles de zoom/desplazamiento/reset y navegación por teclado al SVG existente. Las calles utilizan su geometría OSM cuando está disponible; el mapa mantiene visible cualquier nodo del grafo, incluso fuera de las zonas de aparición. Los polígonos de origen y la envolvente de referencia urbana tienen estilos distintos. Esa envolvente de visualización no equivale a un límite oficial ni a cobertura vial completa: el grafo operativo contiene una selección de conexiones reales.

Seleccionar un sobreviviente con búsqueda o «Ver ruta» muestra posición, refugio asignado, siguiente nodo y una sola ruta. Los avisos se derivan de bloqueos y zombies realmente observables; no muestran sleepers dormidos ni aparentan predicción no publicada. Los refugios se identifican como ficticios y presentan ocupación, reservas y disponibilidad. La conexión del AppShell en `/escape` consulta el mundo Go y no depende del health de la API demo.

El polling permanece en dos segundos. Si cambia la versión geográfica, actualizar el grafo mediante el control disponible. Las otras pantallas, tema y formularios conservan su comportamiento previo.

```sh
npm run test -w @corodev/web
npm run typecheck -w @corodev/web
npm run build:web
FLUTTER_BIN=/ruta/flutter/bin/flutter npm run test:contracts:http -- --urban --browser --flutter
```
