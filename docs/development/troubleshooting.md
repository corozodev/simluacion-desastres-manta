# Solución de problemas

| Síntoma | Comprobación y corrección |
| --- | --- |
| `EBADENGINE`, Vite o ESLint no arrancan | Comprueba `node --version` y `npm --version`; usa Node `>=22.12` y npm `>=10`, luego instala desde la raíz. |
| `EADDRINUSE` en 3001/5173 | Detén el proceso que usa ese puerto. Playwright requiere ambos libres porque inicia sus servidores. Si cambias el puerto manualmente, actualiza URL y origen CORS. |
| El navegador muestra API no disponible | Ejecuta `curl -i http://localhost:3001/health`. Si curl falla, revisa servidor y URL; si funciona, revisa CORS y la consola del navegador. |
| Error CORS | Añade el origen exacto, incluido puerto, a `CORS_ORIGINS` antes de iniciar la API. `localhost` y `127.0.0.1` son orígenes diferentes. No uses comodín para esconder un error de configuración. |
| Cambiar `.env` no afecta la API | No hay carga automática de dotenv en el servidor. Exporta las variables del proceso y reinicia. |
| Cambiar configuración no afecta la web | El archivo debe ser `apps/web/.env.local` y usar prefijo `VITE_`. Reinicia Vite o recompila el build. |
| Android no conecta con `localhost` | Usa `10.0.2.2` en emulador estándar o la IP LAN del host en equipo físico; escucha con `HOST=0.0.0.0`, revisa red y firewall. |
| Flutter ignora una variable exportada | Usa `--dart-define=API_BASE_URL=...` al ejecutar/compilar. Los exports del shell no se convierten automáticamente en constantes Dart. |
| Diagnóstico indica URL inválida | La URL debe usar HTTP(S), sin usuario, contraseña, query ni fragmento. Un prefijo `/dev` es válido. Revisa también modo y timeout. |
| `generated:check` falla | Edita el origen correcto y ejecuta `contracts:generate` o `tokens:generate`; repite el check. No edites derivados manualmente. |
| Generación Dart rechaza un esquema | La generación es deliberadamente acotada. Extiende el generador con una prueba o adopta uno compatible antes de introducir composición/nulabilidad nueva. |
| `flutter` no encontrado en script npm | Añade `flutter/bin` al `PATH` o configura `FLUTTER_BIN` con el ejecutable absoluto. |
| Android build falla por Java o SDK | Ejecuta `flutter doctor -v`; configura Java 17, SDK Android y licencias. Revisa `local.properties` local, sin versionar rutas del equipo. |
| Playwright no encuentra Chromium | Ejecuta `npx playwright install chromium` o configura `PLAYWRIGHT_CHROMIUM_EXECUTABLE` con una ruta válida. |
| La prueba HTTP Flutter queda omitida | Ejecuta `npm run mobile:integration` con la API arrancada; el test necesita `RUN_HTTP_TESTS=true`. |
| `x-demo-fail` o retardo no actúan | Requieren `NODE_ENV=development` y `ENABLE_DEV_CONTROLS=true`. Reinicia el servidor tras cambiar variables. |
| El envío no aparece en Items | Es el comportamiento implementado: `202` confirma la demo sin almacenar datos ni cambiar fixtures. |
| La API compilada no encuentra el contrato | Conserva `packages/contracts/openapi.yaml` junto al árbol del monorepo; `dist` depende de ese archivo en ejecución. |

Para investigar un HTTP 400/404/500, conserva el estado, el código de error y el `requestId`; busca ese identificador en el log del servidor. El log de Dio en depuración solo muestra método, estado y duración. Evita pegar cuerpos, credenciales o tokens en incidencias.

Si cambias una URL de API Gateway y solo funciona `/health` sin stage, revisa el prefijo: una base `https://<api-id>.execute-api.<region>.amazonaws.com/dev` debe generar `/dev/health` y `/dev/v1/demo/items`. Ambos adaptadores conservan ese prefijo. Consulta [integración AWS](../aws/integration.md).
