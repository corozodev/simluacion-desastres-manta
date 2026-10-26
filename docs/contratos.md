# Contratos Track A

Fuente: `packages/contracts/openapi.yaml`. Generar con `npm run contracts:generate`; validar con `npm run contracts:validate` y `npm run generated:check`. Los tipos TypeScript, DTOs Dart y JSON Schema draft-07 son derivados. Se conservan las operaciones demo previas en el servicio mock del puerto 3001.

| Método y ruta Go | Autorización | Resultado |
| --- | --- | --- |
| `POST /paso` | `x-api-key` de servidor | Siguiente nodo vecino transitable o el nodo actual |
| `GET /estado` | Pública local | Snapshot observable, contadores, eventos y métricas |
| `GET /grafo` | Pública local | Grafo base versionado, cuatro refugios iniciales |
| `GET /healthz` | Pública | `{status, service, version}` |

`/ws/estado` no está implementado. Los clientes usan polling. Los bloqueos dinámicos y la ocupación actual se leen de `/estado`, no del grafo base. CORS permite únicamente los orígenes configurados. No hay operaciones administrativas HTTP.

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

`GET /grafo` describe el grafo base y refugios iniciales; la ocupación/reserva viva se toma de `/estado`. Las respuestas no incluyen diagnósticos privados, PRNG, eventos futuros ni sleepers dormidos. No se añadió un endpoint administrativo ni un selector de IA.

La simulación publica el plan después de actualizar zombies; cada solicitud del turno usa ese snapshot. Preparar otro turno no toma el mutex del simulador desde HTTP. El deadline de450ms cubre lectura/snapshot/decisión y el cliente mantiene500ms para HTTP completo.
