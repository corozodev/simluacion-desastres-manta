# Novedades ciudadanas — guía FASE 4C

Este MVP académico conecta Flutter, almacenamiento Go, React y el motor `urban_flood`. Una declaración recibida **no es un hecho confirmado ni una recomendación de navegación**. Aplicarla en el laboratorio conserva su procedencia y estado de verificación.

## Arranque y demostración

Desde la raíz:

```sh
npm install
npm run dev:lab
# React: http://127.0.0.1:5173/escape
```

El launcher inicia zombie en 8080, laboratorio en 8082 y Vite en 5173, con un mismo hostname. Los reportes quedan en `services/evacuation/private/incidents`; `LAB_INCIDENT_DIR` permite elegir otro directorio. Se conserva al detener el launcher. No es el directorio temporal de binarios. El servidor 4A de lectura en 8081 se conserva por separado.

En Android conectado mediante ADB, con Flutter instalado:

```sh
adb reverse tcp:8080 tcp:8080
adb reverse tcp:8082 tcp:8082
cd apps/mobile
flutter pub get
flutter run --dart-define=WORLD_API_BASE_URL=http://127.0.0.1:8080 --dart-define=INCIDENTS_API_BASE_URL=http://127.0.0.1:8082
```

Se necesita el túnel: el laboratorio exige loopback y valida Host/Origin. No basta con sustituir la URL por la IP LAN o `10.0.2.2`. HTTP sólo está permitido en builds Android debug. La URL de producción anterior no incorpora esta fase hasta un despliegue posterior autorizado.

1. En React, **Escenarios → Inundaciones urbanas**. Elegir grafo base, semilla 42, 20 agentes, evacuación preventiva y lluvia constante de intensidad 0. Iniciar y pausar antes del final. El laboratorio identifica la ejecución y los datos sintéticos.
2. Seleccionar un agente en movimiento y una calle de su ruta que admita un desvío. En Flutter, **Nueva novedad**, colocar marcador manual sobre esa calle y elegir **Calle cerrada**. Escribir una descripción que identifique la prueba, transitabilidad y fecha declaradas.
3. Pulsar **Revisar reporte**. Go valida el área y busca la calle; si hay ambigüedad, seleccionar explícitamente una candidata. Revisar y **Confirmar envío**. Flutter recibe el ID y muestra **Reporte ciudadano pendiente de verificación**.
4. En React, activar **Novedades georreferenciadas**, filtrar y seleccionar el reporte. La capa consulta cada cinco segundos; puede tardar ese intervalo. Detalle y marcador conservan la procedencia ciudadana y el estado pendiente.
5. Con sesión local autorizada y la misma ejecución activa/pausada, pulsar **Revisar aplicación experimental**, elegir cierre o precaución y duración, aceptar el alcance experimental y **Aplicar incidente a simulación**. No se requiere marcarlo como verificado.
6. Comprobar arista, ruta, replanificaciones y recibo con `run_id`, paso y versión. Aplicar no mueve agentes ni avanza el reloj. Una calle sin rutas dependientes puede no producir desvíos; el checker elige una calle adecuada para demostrarlo.
7. Reiniciar el servicio conserva el reporte y su auditoría; no reanuda la simulación. Iniciar otra ejecución limpia overlays y rechaza acciones con el `run_id` anterior.

Demostración automática reproducible, sin GPS ni AWS:

```sh
FLUTTER_BIN=/ruta/flutter/bin/flutter npm run test:incidents:e2e
```

El checker compila y arranca Go, usa el repositorio Dio real de Flutter para registrar/reintentar, reinicia Go sobre el mismo directorio, abre React en Chromium y aplica desde la UI. Usa una calle de geometría OSM revisada y agentes sintéticos. El envío por el endpoint ciudadano sigue identificado como `citizen`, con una descripción de prueba; el endpoint sintético separado también se prueba en Go. Los procesos/directorios de prueba se eliminan al finalizar. La evidencia y seis capturas quedan en `deploy/evidence-private/phase4c-20261026`, o en `INCIDENTS_LAB_EVIDENCE_DIR`. Las teselas raster se deshabilitan en automatización.

## Contrato y endpoints

Fuente: [`packages/contracts/openapi.yaml`](../packages/contracts/openapi.yaml). Se generan TypeScript, JSON Schema y Dart. `schema_version:1` identifica incidentes; los DTOs separan fecha declarada (`event_time`), recepción (`received_at`), actualización y caducidad.

| Operación | Endpoint | Acceso y resultado |
| --- | --- | --- |
| Capacidades y área | `GET /v1/incidents/config` | Lectura, límites y aviso; fotografías deshabilitadas |
| Asociación vial previa | `POST /v1/incidents/resolve` | Coordenadas y `edge_id_hint` opcional; candidatas/ambigüedad |
| Registro | `POST /v1/incidents` | `Idempotency-Key` obligatorio; 201 nuevo, 200 replay/duplicado |
| Listado | `GET /v1/incidents` | Filtros y paginación, sin identidad de reporteros |
| Detalle | `GET /v1/incidents/{incident_id}` | DTO público aproximado |
| Prueba sintética | `POST /lab/incidents/synthetic` | Sesión + Origin + CSRF + idempotencia; fuente forzada `synthetic` |
| Revisión | `POST /lab/incidents/{incident_id}/status` | Sesión + Origin + CSRF; control optimista `expected_updated_at` |
| Aplicación experimental | `POST /lab/incidents/{incident_id}/apply` | Sesión + Origin + CSRF; ejecución esperada y aceptación explícita |

El registro acepta `incident_type`, `latitude`, `longitude`, `description`, `severity_reported`, `road_passability_reported`, `event_time`, `location_method` y opcionalmente `edge_id_hint`/`evidence_metadata`. No acepta fuente, estado, identidad o aristas arbitrarias del cliente. Evidencias sólo admiten `attachment_count:0, storage_status:not_supported`; no hay subida de archivos.

Tipos: `flooded_road`, `road_closed`, `landslide`, `fallen_tree`, `bridge_damage`, `other`. Severidad y transitabilidad son observaciones declaradas; no se convierten en riesgo hidrológico medido. Todas las fuentes se distinguen de su estado: `citizen`, `synthetic`, `official` frente a `pending`, `corroborated`, `verified`, `rejected`, `expired`. `official` se reserva para una futura integración autenticada y no puede originarse mediante estos endpoints. Una revisión a `verified` sigue teniendo fuente ciudadana o sintética y no acredita una certificación oficial.

Listado: `bbox=minLng,minLat,maxLng,maxLat`, `incident_type`, `verification_status`, `since`/`until` sobre **fecha declarada**, `received_after` sobre **recepción**, `limit` 1–200 y `offset` 0–10.000. Por defecto omite rechazados/caducados; se consultan explícitamente en la vista de revisión del operador. React añade el bbox del grafo y permite tipo/estado/antigüedad de recepción; muestra una lista acotada, avisa si quedan resultados para acotar filtros y ofrece estados de carga/error/vacío. Las fechas se envían en RFC3339.

El cuerpo de aplicación contiene `expected_run_id`, `duration_steps` 1–10.000, `effect:blocked|caution` y `experimental_ack:true`. La UI limita a 1.000 pasos y exige una segunda confirmación. La respuesta incluye incidente, recibo, estado coherente y `already_applied`. Repetir con los mismos parámetros recupera el recibo sin extender duración ni repetir cierres; cambiar parámetros produce 409. Los errores conservan el envelope/request ID del proyecto: 400 validación, 401 privilegios, 403 origen, 404 inexistente, 409 conflicto, 429 frecuencia (`Retry-After:60`) y 503 indisponibilidad.

## Asociación geográfica y privacidad

Go limita la posición a la envolvente del maestro urbano versionado, sin afirmar límites municipales oficiales. Calcula distancia a las polilíneas reales; exige una calle a ≤50 m. Una diferencia menor de 5 m entre las dos candidatas más cercanas exige elección explícita válida. El servidor vuelve a comprobarla al crear. No acepta referencias lejanas. Al aplicar, la misma arista debe existir en el grafo objetivo y conservar proximidad; no se cambia silenciosamente a otra calle. Un reporte sobre una calle exclusiva del maestro no puede aplicarse a competición.

La asociación identifica una calle, **no verifica que la observación ni el GPS sean ciertos**. Las coordenadas públicas se redondean a cuatro decimales. `location_precision_m:20` describe cuantización de presentación, no exactitud del dispositivo ni anonimato garantizado. Los IDs de calle siguen siendo públicos. No se solicita ni persiste identidad de reportero; las posiciones originales y hashes de idempotencia sólo quedan en el archivo privado. No escribir datos personales en el texto libre: existe sanitización estructural, no un detector semántico de identidad.

Validación: JSON de hasta 8 KiB, descripción 5–500 caracteres Unicode, tipos/enums estrictos, texto plano sin `<`, `>` ni controles, fecha no anterior a siete días ni posterior a cinco minutos. Registro limitado a diez solicitudes/minuto por hash efímero de IP y cien globales, con hasta 1.024 ventanas. No se confía en `X-Forwarded-For`; un proxy futuro requerirá revisar esa política. El replay exacto evita consumir cuota otra vez. Duplicados activos de igual fuente/tipo/calle, a ≤30 m y con fechas declaradas a ≤5 minutos, devuelven el mismo incidente sin promoverlo a corroborado. No es un mecanismo de corroboración entre personas.

## Persistencia, autorización y overlay

La [ADR-004](decisions/ADR-004-incidentes-persistencia.md) se escribió antes de incorporar almacenamiento. Un snapshot JSON versionado se guarda con directorio 0700, archivos 0600, un escritor protegido con `flock`, archivo temporal, `fsync`, reemplazo atómico y sincronización del directorio. Un archivo corrupto impide iniciar; un fallo de escritura no devuelve éxito y cierra nuevas operaciones del almacén. No hay base administrada ni recursos AWS nuevos.

Se admiten hasta 10.000 incidentes, 20.000 hashes de replay y 10.000 recibos. El reporte caduca a las 24 horas desde recepción; a siete días se purga junto con sus claves. Los recibos se retienen siete días desde aplicación. Caducidad/purga se evalúan al arrancar, leer o mutar, sin cron. La revisión no revive caducados. El replay conserva su alcance mientras exista su registro; no se promete deduplicación perpetua.

El laboratorio reutiliza la sesión **local** HttpOnly/SameSiteStrict y CSRF de 4B, exige origen permitido y sólo escucha loopback. Obtener una cookie no equivale a identidad remota de operador. La recepción ciudadana es pública dentro de este servicio local; las mutaciones administrativas tienen una allowlist exacta protegida. Sin un Store persistente, incidentes responde 503. Una exposición remota exige autenticación/autorización, TLS, política de proxy y despliegue explícitos; no está habilitada aquí.

`Manager` serializa paso, revisión e inyección. El simulador sigue siendo el único escritor. Primero valida ejecución, estado, tipo/asociación y elegibilidad; persiste el recibo; después actualiza el overlay y prepara/publica rutas. Si falla el guardado, no cambia el mundo. Tras confirmar disco termina la publicación aunque se desconecte el cliente, que puede recuperar el recibo al reintentar. Una pérdida del proceso en ese intervalo conserva el recibo histórico pero no recupera el mundo en RAM.

Sólo `urban_flood` activo/pausado admite aplicación; se impide durante A/B. El overlay combina cierres con OR y precaución con multiplicador mínimo 2, respetando cierres base, lluvia y otros reportes. No inventa puntuación de riesgo. Dura los siguientes N movimientos de simulación y se retira al comienzo del paso `paso_aplicación + N + 1`. La auditoría conserva fuente/estado **al aplicar**. Cambiar después la revisión no borra automáticamente un overlay ya aplicado; éste conserva su expiración experimental.

Una instancia `Manager` tiene una ejecución compartida entre sus cookies locales. El aislamiento probado corresponde a ejecuciones y a Managers independientes, no a un mundo privado por visitante. El grafo base y el proceso zombie permanecen intactos. Reiniciar o crear otra ejecución no restaura overlays.

## Límites operativos

El disco sobrevive al reinicio del proceso; no proporciona alta disponibilidad, respaldo ni recuperación ante destrucción del volumen. La EC2 existente tiene EBS cifrado y `DeleteOnTermination:true`; el contenedor actual es de sólo lectura. Un despliegue futuro necesita montar un directorio persistente escribible y definir copias/retención. No se cambió infraestructura ni se afirma costo AWS cero; espacio, I/O, ampliación o snapshots pueden costar.

Flutter conserva borrador/cuerpo/clave durante la sesión, incluido cierre del formulario y pérdida de red. Un resultado incierto permite reintentar exactamente lo mismo; un 400 confirmado permite editar. No hay cola offline ni recuperación del borrador tras terminar la aplicación. GPS se solicita sólo mediante botón explícito Android, acepta permiso aproximado y tiene timeout de 15 s; selección manual sigue disponible. El canal y permiso denegado están probados con dobles; no se ejecutó una nueva prueba física del diálogo de Android.

Pendientes: identidad/corroboración real, administración remota, respaldos/migración a almacenamiento multiinstancia, revocación explícita de overlays, pruebas GPS físicas y eventual persistencia local de borradores. Fotografías y navegación real de emergencia quedan fuera de esta fase.
