# Ampliación FASE 2

Se conserva el monolito modular. La fuente urbana OSM se separa en maestro (`manta-master`), operativo representativo (`manta-v2`,300/383) y experimental (`manta-expanded`,1000/1599). Los cuatro polígonos municipales de aparición no son fronteras de navegación; el área visual es una envolvente de referencia. Ver [geografía](grafo-fase2.md) y [diagnóstico](diagnostico-geografico.md).

`internal/coordination` prepara asignaciones globales antes de publicar el snapshot de decisión. Las reservas se derivan del conjunto activo completo y el simulador acepta solo destino/ruta, conservando posiciones, estados, capacidades y ocupación como autoridad. Admisiones convierten reservas en ocupación; muerte, cambio de destino o ruta inviable las libera. `/paso` solo lee el plan coherente, incluida espera o salida sin reserva.

`internal/decision` incorpora predicción observable de runners a uno/dos turnos, riesgos estimados finitos y búsquedas inversas por refugio. Sus cachés se publican de forma inmutable y distinguen cambios de amenazas de cambios de objetivos del pronóstico. Las predicciones son estimaciones, no prohibiciones ni garantías.

`internal/diagnostics` conserva mediciones privadas separadas de `WorldSnapshot`; sus archivos pueden incluir sleepers iniciales y no se publican. `internal/evaluation` ejecuta comparaciones por HTTP real con el motor histórico congelado, hashes de condiciones iniciales y remapeos geográficos.

La preparación AWS está en [despliegue](despliegue-aws.md) y [diagrama SVG](arquitectura.svg). La imagen final funciona localmente con200sobrevivientes; no hubo despliegue cloud por falta de acceso y región/cuenta autorizadas. Polling permanece cada dos segundos; WebSocket se pospone. La descripción modular original sigue debajo.

# Arquitectura de evacuación

Monolito modular Go en `services/evacuation`, separado de la API demo TypeScript existente. Runtime sin base de datos ni consultas externas de decisión. OpenAPI continúa como fuente de verdad de los contratos compartidos; TypeScript, Dart y JSON Schema se generan con `npm run contracts:generate`.

`internal/world` contiene el vocabulario común, la interfaz `DecisionEngine` y el almacén de snapshots. `internal/graph` carga y valida el archivo geográfico versionado. Los módulos de simulación, rutas y HTTP dependen del modelo común; el motor de rutas recibe exclusivamente un snapshot observable y un sobreviviente. El bootstrap y la composición pertenecen a `cmd`.

El simulador mantiene en privado PRNG, programación de eventos y zombies dormidos. Publica observaciones después de actualizar zombies y antes de consultar movimientos HTTP; publica el resultado al terminar el turno. `world.Store` copia los datos al publicar y al leer, incluidos grafo y rutas, para impedir mutaciones accidentales entre consultas concurrentes. Como defensa adicional, elimina sleepers dormidos de lo publicado. Esta copia deliberadamente simple debe medirse antes de optimizarla.

Un `WorldSnapshot` transporta turno, versión del mundo, versión del grafo, zombies visibles con recorrido, sobrevivientes, refugios, bloqueos, eventos y métricas. El puntero local al grafo tiene `json:"-"`; `GET /grafo` entrega el grafo separado y `GET /estado` entrega el estado observable. El estado publicable y el usado por decisiones comparten únicamente información observable; ningún DTO contiene PRNG o posiciones secretas.

`POST /paso` es una consulta autenticada y no modifica sobrevivientes, refugios ni turno. El simulador conserva la autoridad para validar/aplicar una única arista o espera. Las credenciales del simulador se mantienen en el proceso Go; los clientes consultan exclusivamente endpoints públicos de observación. No se añaden operaciones administrativas HTTP en esta fase.

Los clientes conservan sus rutas y componentes. React utiliza su adaptador HTTP y TanStack Query; Flutter utiliza Dio y repositorios/proveedores. El polling es la alternativa de estado de esta iteración; WebSocket queda pendiente.

La importación OSM se ejecuta fuera del runtime y produce un archivo local. No hay llamadas a OSM por turno. Los datos sintéticos, si se necesitan, deben identificarse como fixtures de prueba y nunca como mapa real de Manta.

# Contratos de módulos

- `DecisionEngine.NextStep(context.Context, WorldSnapshot, Survivor) DecisionResult`; resultado interno con `NextNode`, `TargetShelterID` y `Route`. Solo `siguienteNodo` se publica en la respuesta obligatoria.
- `Store.Publish(WorldSnapshot)` y `Store.Load() (WorldSnapshot, bool)`; el booleano distingue un almacén aún no inicializado.
- Grafo: `version`, `source`, `nodes`, `edges`, `shelters`. Aristas con extremos, distancia en metros, tipo de calle, velocidad en m/s, bloqueo estático y direccionalidad.
- Bloqueos dinámicos del turno residen en `blocked_edges`; no se altera el grafo base compartido.
