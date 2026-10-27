# Desarrollo local

Ejecutar npm desde `corodev-spooky`. Se requieren Node ≥22.12, npm ≥10, Go compatible con `services/evacuation/go.mod` y Python 3 para las herramientas geográficas. Flutter y un SDK Android se necesitan sólo para móvil. `GO_BIN` y `FLUTTER_BIN` permiten indicar instalaciones fuera de PATH.

```sh
npm install
npm run contracts:validate
npm run contracts:generate
npm run tokens:generate
```

## Go y React

Terminal A:

```sh
export API_KEY="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
export SIM_AUTOSTART=false
npm run dev:backend
```

Terminal B:

```sh
VITE_WORLD_API_BASE_URL=http://127.0.0.1:8080 npm run dev:web
```

Abrir `http://localhost:5173/escape`, configurar y pulsar **Iniciar simulación**. Go espera solicitudes al arrancar; `SIM_AUTOSTART=true` se rechaza. `npm run dev:api` es un alias del servidor Go. La API local escucha en `127.0.0.1:8080`. Los orígenes localhost y 127.0.0.1 del puerto 5173 están permitidos por defecto.

Go lee variables exportadas y no carga `.env` por sí solo. `.env.example` y `deploy/backend.env.example` son referencias sin secretos. FULL_MANTA requiere `ENABLE_FULL_MODE=true`, continúa experimental y tiene un cupo propio.

Vite acepta `apps/web/.env.local` con `VITE_WORLD_API_BASE_URL=http://127.0.0.1:8080`; reiniciarlo tras cambiar variables. Toda variable `VITE_*` es pública: nunca introducir claves de Go, credenciales administrativas ni tokens de sesión. La credencial de la simulación se entrega al crearla y vive únicamente en `sessionStorage` para recuperar la misma ejecución al recargar.

Para arrancar también el laboratorio y sus servicios ciudadanos:

```sh
npm run dev:lab
```

El ejecutor está en `/escape` y el laboratorio avanzado en `/flood-lab`. Los reportes del laboratorio se conservan en `services/evacuation/private/incidents`, excluido de Git. Las sesiones del nuevo ejecutor viven en RAM y se pierden al reiniciar Go.

## Flutter y Android

```sh
export FLUTTER_BIN="$HOME/Android/flutter/bin/flutter"
cd apps/mobile
flutter pub get
flutter run --dart-define=WORLD_API_BASE_URL=http://10.0.2.2:8080
```

El ejemplo presupone Flutter en PATH para los comandos directos; los scripts npm aceptan `FLUTTER_BIN`. Para el emulador Android, iniciar Go con `LISTEN_ADDR=0.0.0.0:8080` en una red local de confianza. Un dispositivo físico necesita la IP LAN del host y acceso al puerto. `localhost` dentro de Android designa el propio dispositivo. Sin override, móvil y web utilizan la API HTTPS de AWS.

Flutter conserva el flujo anterior de observación y reportes. No crea sesiones FASE 5 ni recibe credenciales de `/paso`. Android permite HTTP local en debug; producción usa HTTPS. Un APK compilado no acredita una prueba física y no se ha preparado iOS.

## Verificación y artefactos

```sh
npm run check
npm test
npm run test:backend
npm run test:race
npm run test:contracts:http
npm run test:contracts:simulations
npm run build:web
npm run build:backend
npm run mobile:check
npm run mobile:test
npm run mobile:build
```

Web: `apps/web/dist`. APK: `apps/mobile/build/app/outputs/flutter-apk/app-debug.apk`. Ambos están excluidos de Git. `npm run test:e2e` ejecuta Chromium con dobles HTTP; la integración de sesiones usa Go real. Consultar [informe FASE 5](../informe-fase5.md) para resultados, endpoints, límites y riesgos. No se publica ni despliega automáticamente.
