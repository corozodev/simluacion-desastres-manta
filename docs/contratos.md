# Contratos HTTP y sesiones de simulación

La fuente de verdad es [`openapi.yaml`](../packages/contracts/openapi.yaml), OpenAPI 3.0.3. TypeScript, JSON Schema y los DTO Dart se generan; los adaptadores HTTP de clientes son manuales y tipados. El contrato histórico de `/paso` no cambia.

| Operación | Autorización y entrada | Respuesta |
| --- | --- | --- |
| `GET /v1/simulations/capabilities` | Pública, sin cuerpo | Escenarios reales, grafos disponibles, valores iniciales y límites del proceso |
| `POST /v1/simulations` | `Idempotency-Key`, JSON cerrado | `201 SimulationCreated`: metadatos y `access_token` |
| `GET /v1/simulations/{id}` | `Authorization: Bearer …` | Metadatos, configuración efectiva y caducidad |
| `GET /v1/simulations/{id}/state` | Bearer; `If-None-Match` opcional | Metadatos, `snapshot: WorldSnapshot`, `scenario_state` en inundaciones; `ETag` o `304` |
| `GET /v1/simulations/{id}/results` | Bearer; estado terminal | Estado final y métricas comparables |
| `POST /v1/simulations/{id}/pause` | Bearer | Metadatos `PAUSED` |
| `POST /v1/simulations/{id}/resume` | Bearer | Metadatos `RUNNING`, mismo turno |
| `POST /v1/simulations/{id}/cancel` | Bearer | Metadatos `CANCELLED`; libera el motor |
| `POST /v1/simulations/{id}/restart` | Bearer, `Idempotency-Key`; estado terminal | `201`, nuevo ID/token, misma configuración y semilla |
| `GET /metrics` | Pública, sólo lectura | Texto Prometheus agregado sin tokens ni IDs de simulación |

Los GET no crean ni avanzan ejecuciones. El manager Go es dueño del reloj. El navegador observa aproximadamente cada dos segundos y nunca invoca `/paso` para avanzar su sesión. El grafo se solicita aparte, una vez por versión/perfil; no se incluye en cada snapshot.

El servidor público conserva los DTO de `/estado` y `/paso` sobre su mundo legacy inactivo. `SIM_AUTOSTART=true` se rechaza y el inicio legacy de `/admin/runs` devuelve `409` tras autenticación/validación. Las ejecuciones públicas pasan por el manager para respetar los mismos límites globales; las CLI y el laboratorio conservan su ejecución explícita separada.

La configuración usa `scenario: zombie_outbreak | urban_flood`, `graph_profile: BASE | FULL_MANTA`, `seed`, `max_ticks`, `tick_interval_ms` y `config`. Este último acepta los campos definidos en `SimulationConfigInput`, incluidos población, ronda, refugios, modo, políticas y opciones experimentales. Los límites personalizados son 30–3.000 turnos, 1.000–5.000 ms por turno, 1–200 agentes y semilla entera representable exactamente por JavaScript. `round` admite `round1`, `round2` y `round3`; proporciona los parámetros de amenaza originales. Los valores omitidos se resuelven con los defaults publicados. El modo `official` exige 150 turnos y 2.000 ms, además de sus condiciones oficiales; no admite alterar el horizonte.

`refuge_ids` vacío o ausente selecciona los refugios predeterminados del grafo. Una lista explícita contiene hasta cuatro IDs existentes y distintos. La respuesta conserva los IDs efectivos ordenados; los refugios de otras topologías o desconocidos producen `400`. Cambiar refugios conserva los nodos de aparición iniciales para comparar la misma población. `rainfall_intensity` sólo aplica a inundaciones: índice de escenario 0–1, sin valor meteorológico observado ni oficial. En el motor hidráulico equivale a 0–120 mm/h de escenario, sin calibración.

`BASE` utiliza 300 nodos / 383 aristas, versión `manta-v2-0ab03290b16a`. `FULL_MANTA` utiliza 9.179 / 13.452, versión `manta-master-57caa90f3aa7`; es experimental y sólo aparece habilitado con `ENABLE_FULL_MODE=true`. Consultar capacidades antes de ofrecerlo. El catálogo histórico mantiene los perfiles intermedios.

Las respuestas privadas contienen ID, estado, turno/límite, versión de estado, escenario, perfil y versión del grafo, semilla, intervalo, configuración efectiva y timestamps UTC. `ended_at` aparece al finalizar. `access_token` sólo aparece al crear, reiniciar o repetir esas respuestas idempotentes. Una clave aleatoria de 16–128 caracteres debe reutilizarse en los reintentos de la misma solicitud; un cuerpo distinto con la misma clave produce `409`. La clave también permite recuperar el token en su ámbito de creación y debe tratarse como información privada. No se garantiza replay después de caducar o reiniciar el proceso.

Los resultados incluyen `initial_survivors`, `evacuated`, `bitten`, `active`, `survival_rate` y `refuges_used`. `survival_rate = (initial_survivors - bitten) / initial_survivors`; los agentes todavía activos cuentan como supervivientes y no como evacuados. El snapshot conserva refugios, ocupación, rutas y métricas existentes; `scenario_state.evacuation_metrics` añade los indicadores reales del motor de inundaciones. Comparar sólo configuraciones, grafo/versiones y semillas equivalentes, identificando la variable que se cambia.

`pause` repetido en pausa, `resume` repetido en ejecución y `cancel` repetido tras cancelación no duplican el trabajo. Las restantes transiciones incompatibles producen `409`. Reiniciar exige una sesión terminal y reserva los mismos cupos que una creación nueva. El resultado anterior permanece hasta su TTL.

| HTTP | Significado |
| --- | --- |
| `400` | JSON, parámetros, claves, refugios o configuración inválidos |
| `401` | Bearer ausente o incorrecto para una sesión existente |
| `404` | ID desconocido o ya retirado de la memoria |
| `409` | Transición inválida, resultados prematuros o conflicto idempotente |
| `410` | Sesión expirada reconocida; sólo se revela con su token correcto |
| `429` | Límite de solicitudes; respetar `Retry-After` |
| `503` | Cupos, sesiones retenidas o reserva de memoria agotados |

El sobre común es `{error:{code,message,requestId,details}}`; `details` siempre es un arreglo y `requestId` coincide con `X-Request-ID`. Se añaden `EXPIRED` y `RATE_LIMITED` a los códigos existentes. La autorización se comprueba antes de devolver un `304`. CORS sólo habilita los orígenes configurados; las IP reenviadas no se usan para eludir el límite de la conexión remota.

Ejemplo local desde una terminal privada, con el servidor ya arrancado y sin imprimir credenciales:

```sh
export SIM_API=http://127.0.0.1:8080
umask 077
SIM_TMP=$(mktemp -d)
SIM_REQUEST_KEY=$(python3 -c 'import secrets; print(secrets.token_urlsafe(24))')
curl --fail-with-body --silent "$SIM_API/v1/simulations/capabilities"
curl --fail-with-body --silent -X POST "$SIM_API/v1/simulations" \
  -H 'Content-Type: application/json' -H "Idempotency-Key: $SIM_REQUEST_KEY" \
  -d '{"scenario":"zombie_outbreak","graph_profile":"BASE","seed":20261026,"max_ticks":150,"tick_interval_ms":2000,"config":{"survivors":20,"round":"round1","refuge_ids":[]}}' \
  -o "$SIM_TMP/created.json"
SIM_ID=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["simulation_id"])' "$SIM_TMP/created.json")
SIM_TOKEN=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["access_token"])' "$SIM_TMP/created.json")
curl --fail-with-body --silent "$SIM_API/v1/simulations/$SIM_ID/state" \
  -H "Authorization: Bearer $SIM_TOKEN"
curl --fail-with-body --silent -X POST "$SIM_API/v1/simulations/$SIM_ID/pause" \
  -H "Authorization: Bearer $SIM_TOKEN"
curl --fail-with-body --silent -X POST "$SIM_API/v1/simulations/$SIM_ID/resume" \
  -H "Authorization: Bearer $SIM_TOKEN"
curl --fail-with-body --silent -X POST "$SIM_API/v1/simulations/$SIM_ID/cancel" \
  -H "Authorization: Bearer $SIM_TOKEN"
curl --fail-with-body --silent "$SIM_API/v1/simulations/$SIM_ID/results" \
  -H "Authorization: Bearer $SIM_TOKEN"
rm -rf "$SIM_TMP"
unset SIM_TOKEN SIM_REQUEST_KEY SIM_ID SIM_TMP
```

El token no se coloca en URLs, capturas, logs o variables `VITE_*`. React lo guarda en `sessionStorage` por pestaña para recuperar una sesión; sigue estando expuesto al JavaScript de esa pestaña. Tras `404/410` elimina la credencial y permite iniciar otra ejecución explícitamente. Las sesiones son privadas y locales a un único proceso; perder el proceso pierde los resultados.

Para cambiar contratos: editar YAML, ejecutar `npm run contracts:validate` y `npm run contracts:generate`; nunca editar los modelos generados a mano. La validación contra Go real se ejecuta con `npm run test:contracts:simulations`.


## Referencia histórica Track A

Se conserva a continuación la descripción FASE 1/2. Sus afirmaciones sobre ausencia de controles administrativos y composición de cuatro refugios corresponden a esa entrega; para las sesiones FASE 5 y sus subconjuntos de refugios rige la sección anterior.

### Contratos Track A

Fuente: `packages/contracts/openapi.yaml`. Generar con `npm run contracts:generate`; validar con `npm run contracts:validate` y `npm run generated:check`. Los tipos TypeScript, DTOs Dart y JSON Schema draft-07 son derivados. Se conservan las operaciones demo previas en el servicio mock del puerto 3001.

| Método y ruta Go | Autorización | Resultado |
| --- | --- | --- |
| `POST /paso` | `x-api-key` de servidor | Siguiente nodo vecino transitable o el nodo actual |
| `GET /estado` | Pública local | Snapshot observable, contadores, eventos y métricas |
| `GET /grafo` | Pública local | Grafo base versionado, cuatro refugios iniciales |
| `GET /healthz` | Pública | `{status, service, version}` |

`/ws/estado` no está implementado. Los clientes usan polling. Los bloqueos dinámicos y la ocupación actual se leen de `/estado`, no del grafo base. CORS permite únicamente los orígenes configurados. El control administrativo histórico existe separado; `cmd/server` impide iniciar su runtime para no eludir los cupos públicos.

Solicitud obligatoria:

```json
{"sobrevivienteId":"S-0089","nodoActual":"N-0117","turno":142}
```

Respuesta exitosa, sin campos adicionales:

```json
{"siguienteNodo":"N-0118"}
```

Los identificadores del grafo real son IDs de OSM; los `N-...` anteriores ilustran el contrato. El servidor exige los tres campos, tipos correctos, sobreviviente activo, nodo existente y coherencia con el turno/nodo publicados. Rechaza propiedades desconocidas, documentos JSON concatenados y cuerpos de más de 4096 bytes. Verifica también la arista de la decisión antes de responder. Las solicitudes simultáneas no reservan plazas ni mutan sobrevivientes.

Errores con sobre compartido y `x-request-id` generado por el servidor:

```json
{"error":{"code":"CONFLICT","message":"La solicitud no corresponde al estado actual.","requestId":"...","details":[]}}
```

Estados relevantes: 400 entrada inválida; 401 credencial incorrecta; 404 recurso ausente; 405 método; 409 turno/nodo/estado incoherente; 503 snapshot no disponible; 504 contexto agotado. El presupuesto de 450 ms del servidor incluye lectura del cuerpo, adquisición del snapshot y cálculo; la lectura de red tiene un deadline explícito. El cliente del simulador impone un máximo de 500 ms incluyendo transporte/decodificación. Un fallo o exceso de plazo deja al sobreviviente quieto, con métricas y evento observable. El simulador siempre revalida la respuesta antes de aplicarla.

La composición HTTP exige cuatro refugios, conforme al esquema de la competición. Las bibliotecas internas de grafo admiten fixtures menores para pruebas unitarias.

Los sleepers dormidos y datos privados del simulador nunca se incluyen en `WorldSnapshot`. `graph` es un puntero interno omitido del JSON; el DTO transporta `graph_version` para relacionarlo con `/grafo`. Los clientes consultan únicamente observaciones y no reciben la API key.

`npm run test:contracts:http` arranca un binario Go temporal, envía peticiones reales y valida las respuestas contra JSON Schema generado. Las pruebas unitarias e integración Go cubren además errores, concurrencia y coherencia de movimientos.


## Campos compatibles FASE 2

El contrato de `/paso` no cambia. Los campos nuevos de observación son opcionales para conservar fixtures y clientes históricos:

- `GraphEdge.geometry`: puntos `{lat,lng}` de la calle real; `bridge`: etiqueta de puente físico OSM.
- `Graph.spawn_zones`: ID, nombre, fuente, polígono, IDs candidatos y peso de cada origen. Son zonas de aparición, no fronteras de rutas.
- `Graph.coverage`: envolvente visual de referencia de la fuente urbana; no es el límite administrativo exacto ni una afirmación de cobertura completa de calles.
- `Survivor.spawn_zone_id`: zona inicial. `target_shelter_id` y `planned_route` existentes ahora contienen el plan coherente; la ruta incluye nodo actual y siguiente paso.
- `Shelter.reserved` y `available`: reservas activas y disponibilidad derivada. Debe cumplirse `occupancy + reserved + available = capacity`.

`GET /grafo` describe el grafo base y refugios iniciales; la ocupación/reserva de ese runtime histórico se toma de `/estado`; los clientes actuales usan `/v1/simulations/{id}/state` o publicados. Las respuestas no incluyen diagnósticos privados, PRNG, eventos futuros ni sleepers dormidos. Estos campos FASE 2 no añadieron un selector de IA; los controles y políticas posteriores están definidos en el OpenAPI vigente.

La simulación publica el plan después de actualizar zombies; cada solicitud del turno usa ese snapshot. Preparar otro turno no toma el mutex del simulador desde HTTP. El deadline de450ms cubre lectura/snapshot/decisión y el cliente mantiene500ms para HTTP completo.

## FASE 8: laboratorio hidráulico

`LabRunConfig` conserva perfiles y comportamientos e incorpora `hydraulic_model`
y `hydrology`; `simulation_duration` cuenta turnos enteros 30–3.000. Sólo existen
`rainfall_runoff_2d` y `compound_flood_2d`, sin runtime radial. El catálogo publica
`duration_limits`. `ScenarioSnapshot.hydraulic` entrega profundidades, descriptor
compacto de malla y balance de masa, separados de la geografía vial. `depth_m`
expone el máximo vial muestreado. `cancel` conserva un final `cancelled`.
Ver [ecuaciones, tiempos, limitaciones y validación](informe-fase8.md).


## Publicados y laboratorio actual

| Operación | Uso y autorización |
| --- | --- |
| `GET /v1/simulations/published/{scenario}` | Espectador anónimo, snapshot compacto/ETag; no renueva lease ni devuelve token |
| `GET /lab/published` | Última tormenta, sin timeline histórico ni control de motor |
| `GET /lab/graph?mode=…&run_id=…` | Geografía separada coherente con la tormenta |
| `POST /lab/runs`, `/lab/actions`, `/lab/candidates/validate`, `/lab/comparisons` | Públicas, Origin/Host, cuotas, validación estricta y `expected_run_id` |
| `/v1/incidents` | Creación pública idempotente; nuevos reportes pendientes, persistencia privada |
| Moderación de incidentes/actualización de referencias | Autorización independiente; no introducir claves en el frontend |

Las políticas y flota se fijan al crear una ejecución. `official` exige BASE,
classic, población/refugios originales y 150/2000 ms sin flota. La flota PRO es
experimental. [Detalles PRO](nivel-pro.md) y [visores compartidos](informe-fase7-movil.md).

## Probar /paso y entregar la clave al jurado

El propietario provisiona la clave del endpoint de evaluación por un canal
privado acordado con el jurado, fuera del repositorio, frontend, capturas y
presentación. La clave de `/paso` no es una credencial de operador ni un token
Bearer de sesión. La demo pública no la solicita. Para comprobar el entorno local
sin copiarla, usar `make smoke` con `make dev` activo.

Ejemplo Bash con la clave obtenida privadamente. La entrada se toma del estado
del mismo runtime; los IDs OSM reales no se sustituyen por los IDs ilustrativos:

```sh
export EVAL_API_BASE=http://127.0.0.1:8080
# Introducir la clave local/evaluación sin eco y pulsar Enter:
read -r -s EVAL_API_KEY
EVAL_STEP=$(python3 - <<'PY_REQUEST'
import json, os, urllib.request
with urllib.request.urlopen(os.environ['EVAL_API_BASE'] + '/estado', timeout=5) as response:
    state = json.load(response)
survivor = next(s for s in state['survivors'] if s['status'] == 'active')
print(json.dumps({'sobrevivienteId': survivor['id'], 'nodoActual': survivor['current_node'], 'turno': state['turn']}))
PY_REQUEST
)
curl --fail-with-body --silent --show-error "$EVAL_API_BASE/paso" \
  -H 'Content-Type: application/json' -H "x-api-key: $EVAL_API_KEY" \
  --data "$EVAL_STEP"
unset EVAL_API_KEY EVAL_STEP EVAL_API_BASE
```

El endpoint público `/paso` de `cmd/server` consulta el runtime `/estado`
inactivo, no la sesión mostrada en React. La evaluación de rondas ejecuta HTTP
real contra el runtime de la CLI (`npm run simulate`); las sesiones poseen su
servidor loopback privado. No mezclar nodos/turnos entre esos ámbitos.

## Generación y cambio del contrato

```sh
npm run contracts:validate
npm run contracts:generate
npm run generated:check
```

Editar primero `packages/contracts/openapi.yaml`, después adaptadores, interfaz
y pruebas. El generador produce `packages/contracts/generated/api.d.ts`,
`schemas.json` y `apps/mobile/lib/core/api/generated/models.dart`; no editar esos
archivos a mano. `generated:check` compara sin escribir. No genera endpoints ni
un SDK de transporte: fetch/Dio, timeouts y traducción de errores son manuales.

Dart admite objetos nombrados, referencias, escalares y listas; opcionales
anulables y enums como String. No valida toda la semántica OpenAPI. Composición
oneOf/anyOf/allOf y formas nuevas requieren ampliar/probar el generador; nunca
omitir campos silenciosamente. Los ejemplos en `packages/contracts/examples`
no sustituyen integración real. El mock starter conserva sus operaciones en
`services/mock-api` y depende del YAML relativo al distribuir su build; ya no
alimenta clientes públicos.
