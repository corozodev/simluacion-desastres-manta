# Desarrollo local

Todos los comandos npm se ejecutan desde `corodev-spooky`, salvo indicación contraria. Se requiere Node `>=22.12`, npm `>=10`, Flutter con Dart `>=3.11` y un SDK Android para compilar APK. El entorno de implementación dispone de Node 22.18, Flutter 3.41.4 y Dart 3.11.1; las ejecuciones reales se registran en [validation.md](validation.md).

## Dependencias y generación

```sh
npm install
npm run contracts:validate
npm run contracts:generate
npm run tokens:generate
```

Para instalar exactamente el lockfile existente en automatización puede usarse `npm ci`. Conserva `package-lock.json` y `apps/mobile/pubspec.lock`. Flutter administra sus dependencias por separado:

```sh
cd apps/mobile
flutter pub get
flutter doctor -v
```

Si Flutter no está en `PATH`, configura una ruta real a tu instalación. Ejemplo Linux:

```sh
export PATH="$HOME/Android/flutter/bin:$PATH"
export FLUTTER_BIN="$HOME/Android/flutter/bin/flutter"
```

`FLUTTER_BIN` es una alternativa utilizada por los scripts npm; los comandos `flutter` directos necesitan `PATH`. Para Android, configura el SDK de tu equipo, por ejemplo `ANDROID_HOME=$HOME/Android`, y Java 17 para Gradle. `apps/mobile/android/local.properties` es local e ignorado: no publiques rutas personales. Usa `flutter doctor -v` para comprobar SDK, licencias y toolchain.

## Servidor y web

Terminal A:

```sh
npm run dev:api
```

Terminal B:

```sh
npm run dev:web
```

| Componente | Dirección predeterminada |
| --- | --- |
| API | `http://127.0.0.1:3001` |
| Web | `http://localhost:5173` |

El servidor lee variables del proceso. La raíz `.env.example` es una referencia; el servidor no carga automáticamente `.env`. Exporta las variables antes de arrancar o colócalas en el entorno de tu terminal. Ejemplo Bash:

```sh
export HOST=127.0.0.1
export PORT=3001
export CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
npm run dev:api
```

Vite sí lee `apps/web/.env.local`. Crea ese archivo si necesitas cambiar la configuración:

```dotenv
VITE_API_MODE=mock
VITE_API_BASE_URL=http://localhost:3001
VITE_API_TIMEOUT_MS=8000
```

El timeout web acepta 100–120000 ms. Reinicia Vite después de cambiar valores. Toda variable `VITE_*` termina en el cliente y es pública. La URL debe ser HTTP(S), sin credenciales, query ni fragmento; puede contener un prefijo de ruta.

## Android

El mock escucha solo en loopback por defecto. Para emulador o equipo físico, arráncalo con una interfaz accesible, en una red local de confianza:

```sh
HOST=0.0.0.0 npm run dev:api
```

| Cliente | URL de API |
| --- | --- |
| Navegador en el host | `http://localhost:3001` |
| Emulador Android estándar | `http://10.0.2.2:3001` |
| Android físico en la misma red | `http://<HOST_LAN_IP>:3001` |

`localhost` en Android apunta al propio dispositivo. Flutter elige `10.0.2.2` como valor predeterminado en Android; otros entornos usan `localhost`. Para un dispositivo físico debes pasar la IP LAN del host, sin guardarla en el repositorio. Permite el puerto 3001 en el firewall de esa red si hace falta.

```sh
cd apps/mobile
flutter devices
flutter run -d <DEVICE_ID> \
  --dart-define=API_MODE=mock \
  --dart-define=API_BASE_URL=http://10.0.2.2:3001 \
  --dart-define=API_TIMEOUT_MS=10000
```

Sustituye `<DEVICE_ID>` por el identificador que liste Flutter. Para equipo físico cambia la URL. Las variables `--dart-define` son configuración de compilación pública; cambiar un `export API_BASE_URL` del shell no cambia por sí solo la aplicación. Android permite HTTP local en la configuración de depuración; una integración remota debe usar HTTPS. No se ha configurado ni validado una aplicación iOS.

Los clientes nativos no aplican CORS. Si pruebas Flutter web, usa un puerto web fijo y añádelo a `CORS_ORIGINS` del servidor. CORS no sustituye un firewall ni autenticación.

## Artefactos

```sh
npm run build:web
npm run build:api
npm run mobile:build
```

La web queda en `apps/web/dist`, la API en `services/mock-api/dist` y el APK de depuración en `apps/mobile/build/app/outputs/flutter-apk/app-debug.apk`. Para iniciar la API compilada: `npm run start -w @corodev/mock-api`; conserva el YAML del contrato en su ubicación del monorepo.

La URL de API está incorporada al build web y Flutter. Para pasar a AWS cambia modo y URL antes de recompilar; consulta [integración AWS](../aws/integration.md).
