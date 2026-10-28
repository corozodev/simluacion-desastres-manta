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

El modo urbano comprueba cuatro zonas de origen, geometrías y coherencia de ocupación/reservas/disponibilidad. El navegador verifica zoom, desplazamiento/reset, selección de ruta, búsqueda, ausencia de llamadas a servicios ajenos al backend configurado y de credenciales, además del viewport móvil. Las cifras de nodos/aristas se leen del grafo recibido; no se fija 325 para la variante urbana.

## Comparación geográfica histórica

`benchmark_multigraph.py` usa `cmd/multigraph-bench` en Docker sin red externa,
con dos CPU, `GOMAXPROCS=2` y 1 GB. Conserva errores/OOM, CPU/RSS y percentiles;
ese entorno no equivale a la EC2 actual. El harness de navegador del antiguo
panel administrativo se retiró al no representar el cliente vigente. Para el
flujo actual usa `test:simulations:browser` y `test:spectators:browser`.

```sh
node tools/scripts/go.mjs build -o ../../.local/multigraph-bench ./cmd/multigraph-bench
python3 tools/qa/benchmark_multigraph.py --binary .local/multigraph-bench \
  --output deploy/evidence-private/benchmark-nuevo --modes competition full
```

[Resultados, regresiones y condiciones originales](../../docs/informe-fase3b2.md).
El maestro sigue siendo experimental y sus costos se informan aparte de los objetivos de BASE.

## Experimento zombie Track A de 36 corridas

El modo explícito `cmd/compare --track-a` reutiliza el simulador y HTTP reales.
Compara BASE (300 nodos) y FULL_MANTA (9.179), R2/R3, tres intensidades y las
tres estrategias alternativas. No incluye el perfil intermedio `expanded`.
Audita primero los grafos, verifica tres turnos acelerados frente a ritmo nominal
y ejecuta las 36 rondas de 150 turnos **secuencialmente**, sin pausas de pared.
Al terminar realiza seis probes HTTP cortos con las colas nativas de 16/32
trabajadores. No inicia servicios públicos, navegador ni operaciones AWS.

```sh
python3 tools/qa/track_a_report.py audit --directory reports/track-a-nuevo/track-a-evidence
GOCACHE=/tmp/corodev-track-a-gocache node tools/scripts/go.mjs build \
  -o /tmp/corodev-track-a-compare ./cmd/compare
(cd services/evacuation && GOMAXPROCS=2 GOMEMLIMIT=7GiB \
  prlimit --as=8589934592 -- taskset -c 0,1 \
  /tmp/corodev-track-a-compare --track-a --output ../../reports/track-a-nuevo/track-a-evidence)
python3 tools/qa/track_a_report.py export --directory reports/track-a-nuevo/track-a-evidence
```

Elegir CPUs permitidas en el host. `prlimit` limita espacio virtual a 8 GiB;
`GOMEMLIMIT` es un objetivo blando de Go. No equivalen a asignar 8 GiB de RAM
física ni acreditan rendimiento EC2. Los sockets son exclusivamente loopback.
La exportación exige 36 resultados completos y seis probes válidos; separa
supervivencia, evacuación, planificación y latencia HTTP. Los campos desconocidos
del CSV quedan vacíos.

Los checkpoints atómicos, configuraciones, seeds y hashes viven en
el directorio elegido. El mismo comando reanuda las corridas pendientes
sin repetir las completas; otra fuente/configuración requiere otro directorio.
Para ello, pasar `--directory` al auditor/exportador y el mismo destino relativo
a `--output` del runner. Los reportes y spawns privados, incluidos dormidos,
permanecen ignorados por Git y no deben publicarse con la aplicación.

La evidencia medida en `reports/track-a-evidence/` conserva el binario y las
fuentes utilizados. `bash reports/track-a-evidence/replay-frozen.sh` los reutiliza
para omitir las corridas completas sin mezclar otra versión del runner. Las
comprobaciones posteriores de recuperación requieren un manifiesto nuevo.
La interpretación en prosa está vinculada a la firma de resultados analizados;
si cambian, se exportan CSV/JSON y se exige revisar esa interpretación.

### Controles R3 sin flota

El modo `--track-a-r3-no-fleet` copia las 18 R3 del manifiesto original y cambia
sólo `RescueFleet`. Verifica la fuente nativa contra el archivo congelado,
configuración, topología, apariciones privadas y recursos. Conserva los originales
y permite comparar el efecto total de activar la flota en cada mundo simulado.

```sh
python3 tools/qa/track_a_fleet_report.py prepare
GOCACHE=/tmp/corodev-track-a-gocache node tools/scripts/go.mjs build \
  -o /tmp/corodev-track-a-no-fleet ./cmd/compare
(cd services/evacuation && GOMAXPROCS=2 GOMEMLIMIT=7GiB \
  prlimit --as=8589934592 -- taskset -c 0,1 \
  /tmp/corodev-track-a-no-fleet --track-a-r3-no-fleet \
  --reference ../../reports/track-a-evidence \
  --output ../../reports/track-a-r3-no-fleet-evidence)
python3 tools/qa/track_a_fleet_report.py
```

`prepare` congela hashes de los archivos originales. Los controles se ejecutan
secuencialmente sin nuevas rondas con flota. El exportador produce 18 filas de
control, 18 pares, 3.600 transiciones individuales y 2.700 puntos de curvas, además
del informe comparativo. Las transiciones no identifican rescates directos por
persona ni constituyen réplicas independientes. Una configuración distinta exige
otro directorio de evidencia y de exportación; `--directory`/`--reference` eligen
los destinos del helper. Los sockets y las mediciones siguen siendo locales.

## Espectadores y mapa ciudadano móvil

`npm run test:spectators:http` construye e inicia ambos Go con directorios temporales. Valida contratos generados, incorporación tardía, pausa/reanudación/final, reemplazo, replay idempotente, reporte ciudadano real pendiente y moderación protegida. Mide 1, 10 y 50 espectadores por escenario en tres oleadas cada dos segundos: latencia HTTP local, payload sin topología, errores, CPU aproximada de proceso y RSS. No es una prueba de capacidad AWS. Guarda `deploy/evidence-private/shared-spectators/report.json`; admite `SPECTATOR_EVIDENCE_DIR`.

`npm run test:spectators:browser` inicia React y Go reales y prueba `/escape`, `/flood-lab` sin login y `/mobile`, con capturas, navegación táctil, rutas/refugios, incorporación avanzada, pausa, desconexión/reconexión y reporte ciudadano. Usa Chromium con perfiles iPhone/Pixel y escritorio; no acredita Safari real. Guarda `deploy/evidence-private/mobile-spectators/`; admite `MOBILE_EVIDENCE_DIR`. Las teselas externas se deshabilitan durante QA.

Flutter prueba los mismos snapshots con `published_http_integration_test.dart`, `RUN_PUBLISHED_HTTP_TESTS=true`, URLs `WORLD_API_BASE_URL`/`FLOOD_API_BASE_URL` e IDs esperados opcionales. Sólo realiza GET; `PUBLISHED_TEST_OUTPUT` permite guardar la observación para compararla con el servidor. El APK por defecto usa el origen HTTPS configurado; las capturas locales requieren un build de QA o `adb reverse`, sin secretos en `--dart-define`.

`FLUTTER_BIN=/ruta/flutter/bin/flutter npm run test:spectators:http -- --flutter` añade las dos integraciones Dart contra esos mismos Go: lectura de IDs publicados y creación/replay/consulta de un reporte ciudadano real. El harness proporciona coordenadas y una calle del maestro verificado; comprueba que el reporte no cambia el escenario pausado.

`FLUTTER_BIN=/ruta/flutter/bin/flutter npm run test:spectators:browser -- --flutter` comprueba las tres partes juntas: React escritorio crea las ejecuciones reales, el visor móvil las observa y Dart recibe exactamente esos mismos IDs y el paso de inundación pausada. Guarda la comparación sin credenciales en `flutter-shared-with-react.json` dentro de la evidencia de navegador.

## Alcance de los harnesses conservados

Se retiraron los checkers de los antiguos paneles administrativos, de aplicación
visual de reportes y de fuentes/eventos desplegables: exigían controles eliminados
del producto. Las verificaciones actuales de espectadores HTTP/navegador y Flutter
conservan recepción/replay de reportes y aislamiento; Go mantiene las regresiones
de persistencia/reinicio, asociación, aplicación protegida y referencia offline.
No se ejecutaron E2E durante esta limpieza ni se atribuye cobertura nueva.

Ajv y `ajv-formats` son dependencias directas de QA en raíz. El runtime Go no
depende de ellas. `tsx` ya no es una dependencia directa del proyecto; npm puede
conservarlo como peer opcional de Vite. No elimines dependencias transitivas por
su nombre sin comprobar el lockfile.
