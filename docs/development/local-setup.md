# Desarrollo local

La demo web funciona sin AWS, Docker ni Flutter. Se requieren Node ≥22.12, npm ≥10, Go ≥1.23 (`services/evacuation/go.mod`), Python 3 y GNU Make. `GO_BIN` y `FLUTTER_BIN` admiten ejecutables fuera de PATH.

## Arranque y cierre

Desde la raíz:

```sh
make help
make setup
make dev
```

`setup` comprueba herramientas, ejecuta `npm install` con lockfile, genera contratos/tokens y crea `.env` y `apps/web/.env.local` sólo si faltan. La clave local se genera aleatoriamente y no se imprime. No sobreescribe valores existentes ni solicita credenciales AWS. Para una instalación CI estricta puede usarse `npm ci`.

`dev` reutiliza `tools/scripts/dev_lab.mjs`: compila Go temporalmente e inicia la API de sesiones en `127.0.0.1:8080`, laboratorio en `127.0.0.1:8082` y Vite en `127.0.0.1:5173`. Comprueba puertos y readiness, y configura los tres adaptadores web hacia loopback; no apunta a producción por defecto. Abrir `/escape`, `/flood-lab` o `/mobile`. El inicio de cada simulación es explícito.

Ctrl+C detiene los tres hijos; `make stop` desde otra terminal solicita el mismo cierre autenticado por loopback. El registro privado `.local/dev.json` sólo identifica este lanzador y se elimina al cerrar. Ningún comando borra reportes, volúmenes ni datos persistentes. Un segundo `make dev` falla sin afectar el primero.

```sh
# Con make dev activo, desde otra terminal
make smoke
make stop
```

Smoke comprueba web, health, capacidades, publicados, laboratorio y `/paso` 401/200 con respuesta vecina válida; no crea sesiones ni avanza turnos. `/estado` permanece inactivo aunque haya sesiones públicas ejecutándose.

## Configuración

`make dev` carga `.env` de raíz; variables ya exportadas tienen prioridad. Go directo no carga dotenv. `apps/web/.env.local` contiene sólo configuración pública. Nunca guardar secretos en `VITE_*` ni `--dart-define`.

| Variable | Uso local |
| --- | --- |
| `LAB_WEB_PORT`, `LAB_WORLD_PORT`, `LAB_FLOOD_PORT` | 5173, 8080, 8082; tres puertos distintos, 1024–65535 |
| `LAB_INCIDENT_DIR` | `services/evacuation/private/incidents`, conserva novedades entre arranques |
| `LAB_REFERENCE_CACHE` | `services/evacuation/private/reference.json` |
| `LAB_REFERENCE_ONLINE` | `false`; copia SNGR versionada disponible sin Internet |
| `LAB_OSM_TILES_ENABLED` | `false`; geometría OSM local sigue visible, `true` solicita teselas externas |
| `API_KEY` | Sólo backend/smoke local; sin valor se crea una clave efímera privada |
| `SIM_MAX_*`, `SIM_*_TTL` | Cupos/retención del ejecutor; consultar [contratos](../contratos.md) |

El lanzador mantiene BASE y deshabilita FULL/expanded; no habilita administrador ni autostart. Para un servidor configurado expresamente, exportar `API_KEY`, `SIM_AUTOSTART=false` y ejecutar `npm run dev:backend`; FULL requiere `ENABLE_FULL_MODE=true`. `npm run dev:api` sigue siendo alias Go, no mock. Los scripts originales se conservan.

## Verificación

`make test` ejecuta JavaScript y Go. `make verify` ejecuta documentos, contratos/derivados/lint, Go/race, geografía, contratos HTTP/sesiones/flood, espectadores HTTP y builds. No requiere servicios previos, AWS ni Flutter. [Pruebas, navegador, benchmarks y evidencia actual](../pruebas.md).

No hay Docker Compose en este repositorio: se conserva el Dockerfile de backend y el despliegue existente, sin añadir otra infraestructura local. [AWS se opera por separado](../despliegue.md).

## Flutter Android complementario

No controla motores. Observa las ejecuciones publicadas y permite reportar novedades. [Guía del cliente](../../apps/mobile/README.md).

```sh
npm run mobile:check
npm run mobile:test
npm run mobile:build
# Harness efímero con Go real: publicados y reporte ciudadano idempotente
npm run test:spectators:http -- --flutter
```

Añadir Flutter a PATH o definir `FLUTTER_BIN` antes. APK debug en `apps/mobile/build/app/outputs/flutter-apk/app-debug.apk`; web en `apps/web/dist`, ambos ignorados. No compilar Flutter Web. Un APK construido no prueba dispositivo físico.

Para conectar Android vía ADB, conservar servicios loopback y usar `adb reverse` en los puertos del backend y laboratorio, configurando WORLD/FLOOD/INCIDENTS_API_BASE_URL mediante `--dart-define`. No debilitar validación Host del laboratorio para conectar un emulador. La consola React debe iniciar las ejecuciones antes de observarlas.

## Recuperación

| Síntoma | Acción |
| --- | --- |
| Puerto ocupado | Detener su propietario o cambiar los tres `LAB_*`; el lanzador no mata procesos ajenos. |
| Registro local antiguo | `make stop` retira registro si el PID terminó. Si aún vive, usar Ctrl+C en su terminal; no se envían señales por PID desde make stop. |
| SDK ausente | Configurar PATH/`GO_BIN`/`FLUTTER_BIN`; `flutter doctor -v` para Android/Java17/licencias. |
| Contratos desincronizados | Editar YAML y `npm run contracts:generate`; tokens desde JSON y `npm run tokens:generate`. |
| Configuración no cambia | Reiniciar Vite/Go. Usar el archivo y prefijo correctos; Go directo sólo lee exports. |
| HTTP/CORS/Host | Usar `127.0.0.1` consistentemente y el origen/puerto configurado; conservar requestId y código, nunca tokens/cuerpos privados. |
| Simulación final/expirada | Crear otra ejecución explícitamente; recargar sólo recupera la sesión existente. |
| Chromium ausente | `npx playwright install chromium` o `PLAYWRIGHT_CHROMIUM_EXECUTABLE` con ejecutable real. |

No ejecutar `docker system prune`, `down -v` ni limpiezas de `private` como solución de arranque.
