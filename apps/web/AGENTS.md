# Cliente web

Lee primero el `AGENTS.md` raíz. Ejecuta comandos desde la raíz con `npm run … --workspace @corodev/web`.

- React con TypeScript estricto; las rutas viven en `src/app` y los flujos en `src/features`.
- `src/services/api.ts` es el único adaptador HTTP. Usa los tipos generados de `@corodev/contracts`, conserva el request ID y traduce timeout, red y errores HTTP.
- TanStack Query administra consultas y mutaciones; no introduzcas repositorios de fixtures en componentes.
- Importa identidad y CSS de `@corodev/design-tokens`. Cambia las fuentes compartidas y regenera para modificar colores o marca.
- `VITE_` es público. Nunca agregues secretos, credenciales ni tokens en estas variables o diagnósticos.
- Mantén navegación por teclado, foco visible, etiquetas y estados de carga, vacío y error. Usa español para la interfaz.
- Pruebas de interacción en `src/tests`; `npm run test --workspace @corodev/web`, `npm run typecheck --workspace @corodev/web`, `npm run build --workspace @corodev/web`.

El formulario confirma envíos HTTP; no afirma persistencia permanente. Las fechas de los elementos son fixtures de demostración.

Track A: `/escape` utiliza `api.world`/`api.graph`, modelos generados y polling con TanStack Query. `VITE_WORLD_API_BASE_URL` es una URL pública de observación; por defecto reutiliza la URL de la API demo. Usa `http://localhost:8080` para el backend Go. Los endpoints de movimiento y sus credenciales permanecen exclusivamente en Go. Conserva la atribución de OSM y diferencia el fixture sintético del mock.

FASE 2: `WorldMap.tsx` conserva geometrías reales, zonas de aparición y envolvente urbana de referencia. No describir esa envolvente como límite oficial ni afirmar que el grafo operativo cubre todas las calles. Mostrar solo una ruta seleccionada y amenazas publicadas. `/escape` usa su propio estado de conexión; conservar separada la salud del mock demo. Los nuevos campos de reservas/geometrías son opcionales para mantener compatibilidad con fixtures anteriores.
