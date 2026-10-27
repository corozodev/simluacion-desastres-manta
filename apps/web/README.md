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

El comando configura `VITE_WORLD_API_BASE_URL`, `VITE_FLOOD_API_BASE_URL` y `VITE_INCIDENTS_API_BASE_URL` con el mismo hostname para evitar diferencias de CORS/cookies. El controlador del laboratorio escucha únicamente en loopback, puerto 8082. El servidor de lectura 4A en 8081 se conserva por separado. La [guía 4B](../../docs/laboratorio-inundaciones.md) explica ejecución manual, capas, candidatos, A/B y límites.

FASE 4C añade una capa independiente de novedades y un panel con filtros de tipo, estado y antigüedad, detalle aproximado y procedencia. Consulta `/v1/incidents` cada cinco segundos mediante TanStack Query; `api.ts` sigue siendo el único adaptador HTTP. Rechazados/caducados requieren filtro explícito de revisión. La aplicación experimental exige dos pasos, aceptación del alcance, sesión/Origin/CSRF y `run_id` actual; invalida el estado observado sin marcar el reporte como verificado. Una respuesta tardía de otra ejecución no sustituye el mundo actual.

`npm run test:incidents:e2e` prueba Flutter real, persistencia tras reinicio y aplicación desde Chromium. [Guía 4C y límites](../../docs/incidentes-ciudadanos.md). La cookie autoriza un laboratorio local compartido; no implementa identidad remota ni un mundo por visitante.

FASE 4D añade la novena capa, **Susceptibilidad oficial a inundaciones**, servida desde una copia validada en Go. Sus 59 paths SVG se memoizan por versión/geografía y se distinguen de la exposición sintética. El panel muestra atribución CONAGE 2024, fechas originales, CRS y límites; los eventos de 2025 se consultan como históricos y no cierran calles.

El toggle de visualización no modifica la simulación. La opción separada **Usar susceptibilidad geográfica como referencia** fija versión y peso adimensional al iniciar. TanStack consulta disponibilidad cada 30 segundos y reutiliza los polígonos por versión con `staleTime:Infinity`; el polling del mundo no vuelve a descargarlos. La lectura HTTP funciona offline. `LAB_REFERENCE_ONLINE=true npm run dev:lab` permite una actualización asíncrona explícita. [Demos A–E y observabilidad](../../docs/datos-oficiales-y-demo.md), `npm run test:references:e2e`.

**SIMULACIÓN — DATOS SINTÉTICOS.** Los escenarios de inundación emplean parámetros sintéticos y no constituyen pronósticos hidrológicos ni recomendaciones oficiales de evacuación.

FASE 7 añade políticas y funciones PRO a **Configuración avanzada** de `/escape`.
Cada selector viaja en `config` al crear una sesión Go; durante la ejecución sólo
se permite pausar, reanudar o cancelar. El modo oficial fija BASE, población de la
ronda, refugios originales y 150 turnos de 2 segundos. Las políticas correlacionada
y adaptativa y la flota de cinco camionetas pertenecen al modo experimental.
Las camionetas se dibujan en su último nodo publicado, con pasajeros/capacidad;
los pasajeros siguen activos hasta su entrega. La capa opcional de predicción
muestra hasta 64 nodos del pronóstico observable del turno, con probabilidades de
un modelo no calibrado; no extrapola movimientos ni revela sleepers.

**Laboratorio comparativo** inicia explícitamente dos sesiones independientes y
secuenciales con iguales condiciones, variando sólo el planificador. Conserva las
credenciales en memoria y nunca las exporta. La tabla y JSON/CSV muestran medidas
de POST `/paso` real, resultados parciales/finales y analítica publicada por Go.
Repetir conserva las configuraciones y semillas originales. Abrir o actualizar la
página no crea ejecuciones. Cerrar la página pierde la observación de la pareja;
las sesiones caducan según los límites del servidor. Las pruebas aceleradas usan
la herramienta local de comparación y no equivalen a rondas HTTP en tiempo real.

### Visor ciudadano `/mobile`

La ruta abre directamente una interfaz táctil con Brote zombi e Inundaciones.
En escritorio se presenta dentro de un contenedor de teléfono; en pantallas
estrechas ocupa la pantalla. No utiliza Flutter Web, emulación iOS ni datos de
muestra. La consola se carga por separado y no forma parte del paquete inicial
del visor.

El visor sólo consulta ejecuciones existentes: `GET
/v1/simulations/published/zombie_outbreak` y `GET /lab/published`. Nunca crea ni
controla simulaciones, no conserva credenciales y no necesita visitar la
consola. Usa el snapshot actual al incorporarse, polling de 2 s mientras corre,
consulta de descubrimiento de 15 s en pausa/final/sin ejecución, backoff hasta
30 s ante errores y suspende consultas al ocultarse. Al regresar obtiene el
snapshot actual, sin reproducir turnos perdidos. Las geografías tienen claves de
caché independientes y deben coincidir con la versión del snapshot antes de
representar agentes. Se reutilizan respuestas públicas mediante ETag/304.

Inundaciones separa el mapa ciudadano de la tormenta experimental. El primero
muestra reportes ciudadanos/fuentes oficiales y refugios propuestos, excluye
reportes sintéticos y no aplica bloqueos de la tormenta. Permite seleccionar una
ubicación manual en mapa, completar tipo/descripción/transitabilidad/severidad,
revisar y enviar un reporte mediante la API real de novedades. La clave de
idempotencia y el cuerpo completo se conservan para reintentar una respuesta
incierta. No se requiere GPS ni login. La referencia oficial disponible se carga
sólo al activar su capa. Los reportes pendientes no se presentan como vías
verificadas ni modifican el motor.

`/flood-lab` inicia, pausa, continúa, reinicia, repite y compara tormentas sin
operador, cookies o CSRF. Conserva validación, ejecución explícita y el guard de
solicitud pendiente. La sesión protegida opcional sólo se consulta al desplegar
herramientas de moderación o referencia; sus credenciales no condicionan las
operaciones de tormenta y sus protecciones continúan en el servidor.

`VITE_ANDROID_APK_URL` admite una URL HTTPS real de distribución. Sin una URL
válida, no se muestra un enlace de descarga. `/mobile` es el enlace para iPhone;
la separación de URLs no implementa autorización.

La comprobación automatizada usa Vitest y navegador Chromium local. Safari real
en iPhone y Chrome en un Android físico requieren dispositivos disponibles; no
se declara esa compatibilidad comprobada sólo a partir de un viewport móvil.
