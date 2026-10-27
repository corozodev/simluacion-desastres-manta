# Pruebas de contrato y clientes con Go real

Desde la raíz del monorepo:

```sh
node tools/qa/check_http_contracts.mjs
node tools/qa/check_http_contracts.mjs --browser
FLUTTER_BIN=/ruta/a/flutter/bin/flutter node tools/qa/check_http_contracts.mjs --browser --flutter
```

El script compila Go en un directorio temporal, inicia un puerto local efímero y
crea una credencial aleatoria únicamente en memoria. Valida respuestas reales
con JSON Schema generado, adyacencia del movimiento y errores 400/401/409.
Termina los procesos y elimina el binario temporal incluso cuando falla.

`--browser` inicia Vite en `127.0.0.1:5174` y Chromium de Playwright; verifica
que `/escape` consume el grafo OSM y el estado real, filtra sobrevivientes,
no envía API keys y cabe en un viewport móvil de 390 px. Requiere ese puerto libre
y Chromium disponible; admite `PLAYWRIGHT_CHROMIUM_EXECUTABLE`.

`--flutter` ejecuta `world_http_integration_test.dart` contra ese mismo servidor
Go, sin exponer credenciales al repositorio Dart. Usa `FLUTTER_BIN` o Flutter en PATH.
Las pruebas unitarias normales no necesitan servidores, navegador ni Android.

## Variantes de FASE 2

El modo predeterminado fija explícitamente `data/manta-v1.json` y `scenarios/round1.json`, para mantener la comprobación del grafo histórico aunque cambien los defaults productivos. `--urban` usa `data/manta-v2.json` y `scenarios/urban/round1.json`. Ambos prueban el motor productivo actual; este script no reemplaza los experimentos comparativos del evaluador.

```sh
node tools/qa/check_http_contracts.mjs --urban
FLUTTER_BIN=/ruta/flutter/bin/flutter node tools/qa/check_http_contracts.mjs --urban --browser --flutter
```

El modo urbano comprueba cuatro zonas de origen, geometrías y coherencia de ocupación/reservas/disponibilidad. El navegador verifica zoom, desplazamiento/reset, selección de ruta, búsqueda, ausencia de solicitudes al health demo y de credenciales, además del viewport móvil. Las cifras de nodos/aristas se leen del grafo recibido; no se fija 325 para la variante urbana.

## FASE 3B.2

`check_multigraph.mjs` prueba Go y Chromium reales con credenciales efímeras sólo en memoria, origen/listener loopback, simulación acelerada explícita y ningún acceso AWS. Comprueba previsualización de 13.452 aristas, autorización, bloqueo de otra ronda, logout, retención de finales y ancho móvil. `MULTIGRAPH_EVIDENCE_DIR` guarda capturas y métricas locales privadas.

`benchmark_multigraph.py` ejecuta el binario `cmd/multigraph-bench` en Docker sin red externa, con dos CPU, GOMAXPROCS=2 y 1 GB. Declara aceleraciones y conserva errores/OOM además de percentiles y CPU/RSS. Ver comandos, límites y seguridad en [operación multigrafo](../../docs/operacion-multigrafo.md). `/paso` conserva su contrato exacto; los controles administrativos no pertenecen al cliente móvil.

## Espectadores y mapa ciudadano móvil

`npm run test:spectators:http` construye e inicia ambos Go con directorios temporales. Valida contratos generados, incorporación tardía, pausa/reanudación/final, reemplazo, replay idempotente, reporte ciudadano real pendiente y moderación protegida. Mide 1, 10 y 50 espectadores por escenario en tres oleadas cada dos segundos: latencia HTTP local, payload sin topología, errores, CPU aproximada de proceso y RSS. No es una prueba de capacidad AWS. Guarda `deploy/evidence-private/shared-spectators/report.json`; admite `SPECTATOR_EVIDENCE_DIR`.

`npm run test:spectators:browser` inicia React y Go reales y prueba `/escape`, `/flood-lab` sin login y `/mobile`, con capturas, navegación táctil, rutas/refugios, incorporación avanzada, pausa, desconexión/reconexión y reporte ciudadano. Usa Chromium con perfiles iPhone/Pixel y escritorio; no acredita Safari real. Guarda `deploy/evidence-private/mobile-spectators/`; admite `MOBILE_EVIDENCE_DIR`. Las teselas externas se deshabilitan durante QA.

Flutter prueba los mismos snapshots con `published_http_integration_test.dart`, `RUN_PUBLISHED_HTTP_TESTS=true`, URLs `WORLD_API_BASE_URL`/`FLOOD_API_BASE_URL` e IDs esperados opcionales. Sólo realiza GET; `PUBLISHED_TEST_OUTPUT` permite guardar la observación para compararla con el servidor. El APK por defecto usa el origen HTTPS configurado; las capturas locales requieren un build de QA o `adb reverse`, sin secretos en `--dart-define`.

`FLUTTER_BIN=/ruta/flutter/bin/flutter npm run test:spectators:http -- --flutter` añade las dos integraciones Dart contra esos mismos Go: lectura de IDs publicados y creación/replay/consulta de un reporte ciudadano real. El harness proporciona coordenadas y una calle del maestro verificado; comprueba que el reporte no cambia el escenario pausado.

`FLUTTER_BIN=/ruta/flutter/bin/flutter npm run test:spectators:browser -- --flutter` comprueba las tres partes juntas: React escritorio crea las ejecuciones reales, el visor móvil las observa y Dart recibe exactamente esos mismos IDs y el paso de inundación pausada. Guarda la comparación sin credenciales en `flutter-shared-with-react.json` dentro de la evidencia de navegador.
