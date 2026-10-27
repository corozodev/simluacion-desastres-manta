# Cliente web

Lee primero el `AGENTS.md` raíz. Ejecuta comandos desde la raíz con `npm run … --workspace @corodev/web`.

- React con TypeScript estricto; las rutas viven en `src/app` y los flujos en `src/features`.
- `src/services/api.ts` es el único adaptador HTTP. Usa los tipos generados de `@corodev/contracts`, conserva el request ID y traduce timeout, red y errores HTTP.
- TanStack Query administra consultas y mutaciones; no introduzcas repositorios de fixtures en componentes.
- Importa identidad y CSS de `@corodev/design-tokens`. Cambia las fuentes compartidas y regenera para modificar colores o marca.
- `VITE_` es público. Nunca agregues secretos, credenciales ni tokens en estas variables o diagnósticos.
- Mantén navegación por teclado, foco visible, etiquetas y estados de carga, vacío y error. Usa español para la interfaz.
- Pruebas de interacción en `src/tests`; `npm run test --workspace @corodev/web`, `npm run typecheck --workspace @corodev/web`, `npm run build --workspace @corodev/web`.

El cliente sólo observa la API Go mediante `/healthz`, `/grafo` y `/estado`; no incorpora credenciales ni llama `/paso`. `/escape` es la entrada y única pantalla. `VITE_WORLD_API_BASE_URL` selecciona explícitamente la instancia Go, con HTTPS de producción por defecto. No introducir fuentes de datos de ejemplo en runtime; los dobles HTTP sólo pertenecen a pruebas.

`WorldMap.tsx` conserva geometrías reales, zonas de aparición y envolvente de referencia urbana. No afirmar cobertura vial completa ni límites municipales oficiales. Mostrar sólo la ruta seleccionada y amenazas publicadas. AppShell comparte la caché de Escape sin otro temporizador de polling.
