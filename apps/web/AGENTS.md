# Cliente web

Lee primero el `AGENTS.md` raíz. Ejecuta comandos desde la raíz con `npm run … --workspace @corodev/web`.

- React con TypeScript estricto; las rutas viven en `src/app` y los flujos en `src/features`.
- `src/services/api.ts` es el único adaptador HTTP. Usa los tipos generados de `@corodev/contracts`, conserva el request ID y traduce timeout, red y errores HTTP.
- TanStack Query administra consultas y mutaciones; no introduzcas repositorios de fixtures en componentes.
- Importa identidad y CSS de `@corodev/design-tokens`. Cambia las fuentes compartidas y regenera para modificar colores o marca.
- `VITE_` es público. Nunca agregues secretos, credenciales ni tokens en estas variables o diagnósticos.
- Mantén navegación por teclado, foco visible, etiquetas y estados de carga, vacío y error. Usa español para la interfaz.
- Pruebas de interacción en `src/tests`; `npm run test --workspace @corodev/web`, `npm run typecheck --workspace @corodev/web`, `npm run build --workspace @corodev/web`.

FASE 5 usa `/v1/simulations/capabilities` y `/grafo?mode=competition|full` para exploración sin iniciar ni observar un mundo global. Sólo el formulario explícito crea una sesión mediante `POST /v1/simulations`, con `Idempotency-Key`. `/escape` es la entrada del ejecutor independiente; el laboratorio existente conserva `/flood-lab` y el enlace legado `/escape?scenario=urban_flood`. `VITE_WORLD_API_BASE_URL` selecciona la instancia Go, con HTTPS de producción por defecto. Nunca llamar `/paso` desde el cliente ni introducir fuentes de datos de ejemplo en runtime; los dobles HTTP sólo pertenecen a pruebas.

Las consultas y controles privados usan `Authorization: Bearer` con una credencial opaca por simulación. Sólo ID, token y endpoint se conservan en `sessionStorage` para actualizar la página; ésta es la excepción deliberada para credenciales de simulación propias. Nunca guardar tokens administrativos, usar `localStorage`, query strings, logs o variables VITE para secretos. Al recuperar una sesión sólo consultar `/state`; no crear ni reiniciar automáticamente. `404/410` o credencial inválida limpian la recuperación; los fallos de red conservan el último snapshot. TanStack Query consulta sin solapamiento cada 2 segundos y aplica backoff hasta 30 segundos. Los controles obedecen el estado del servidor; reiniciar sólo estados terminales produce otra ID.

`WorldMap.tsx` conserva geometrías reales, zonas de aparición y envolvente de referencia urbana. No afirmar cobertura vial completa ni límites municipales oficiales. Mostrar sólo la ruta seleccionada y amenazas publicadas. AppShell comparte la caché de Escape sin otro temporizador de polling.

Los perfiles se previsualizan con `/grafo?mode=…` sin activación. La topología estática se comparte por perfil y la versión del snapshot debe coincidir antes de representar entidades. Los estados privados usan `simulation_id` en su clave de caché, sin tokens; desmontar selección y rutas al cambiar de ejecución. No combinar marcadores de un mundo con otra geografía. Mantener capas de lluvia/exposición sintética, reportes ciudadanos y referencia oficial separadas: las dos últimas son observaciones visuales independientes y no alteran una ejecución histórica.


FASE 6A conserva SVG nativo. `features/visualization` es una capa observadora sin
HTTP, escritura del motor ni temporizadores por entidad. El catálogo portable
está en `packages/visualization/catalog.json`; colores nuevos provienen de tokens.
Sólo interpolar ticks consecutivos del mismo ID/grafo/escenario, con polilíneas
comprobadas; pares de nodos con geometrías paralelas diferentes son ambiguos.
Ante pausa, terminales, desconexión, ocultación o movimiento reducido, resolver al
último punto real y limpiar el reloj. Nunca contar integrantes de hordas ni usar
rutas futuras para inventar movimientos. Las bandas azules son índices sintéticos,
no clases hidrológicas. Probar `npm run test:visualization:browser` para evidencia
local BASE/FULL_MANTA; no afirmar FPS de pintura a partir de intervalos RAF.
