# Reportes ciudadanos y moderación

[Laboratorio](laboratorio-inundaciones.md) · [Contrato](contratos.md) · [Persistencia](decisions/ADR-004-incidentes-persistencia.md)

React `/mobile` y Flutter Android permiten declarar una novedad sobre una calle.
La API Go la valida y persiste antes de confirmar recepción. Un reporte recibido
no es un hecho verificado ni una recomendación de navegación; nace `citizen/pending`
y no modifica automáticamente una simulación.

## Registrar y consultar

Con el [entorno local](despliegue.md#desarrollo-local) activo, abre **Reportar novedad**
en el visor. Coloca un marcador manual o solicita GPS opcional en Android, elige
tipo, descripción y observaciones declaradas. Revisa la asociación vial y confirma.
Si hay varias calles candidatas, elige explícitamente una; Go vuelve a validarla.
El permiso GPS denegado permite continuar manualmente.

Flutter conserva borrador, cuerpo e `Idempotency-Key` en memoria durante la sesión.
Ante recepción incierta, reintenta exactamente el mismo envío; no hay cola offline
ni recuperación del borrador al cerrar la aplicación. La configuración Android
local y `adb reverse` están en [su guía](../apps/mobile/README.md).

| Operación | Acceso y comportamiento |
| --- | --- |
| `GET /v1/incidents/config` | Área, límites y aviso; sin fotografías |
| `POST /v1/incidents/resolve` | Asociación a polilíneas OSM, candidatas y ambigüedad |
| `POST /v1/incidents` | Público, `Idempotency-Key`; 201 nuevo, 200 replay/duplicado |
| `GET /v1/incidents` y `/{incident_id}` | Lectura pública con filtros y DTO aproximado |
| `GET /lab/incidents/permissions` | Permisos de moderación derivados del operador existente |
| `POST /lab/incidents/{incident_id}/status` | Revisión con `expected_updated_at`, cookie, Origin y CSRF |
| `POST /lab/incidents/{incident_id}/status` con `map_withdrawn` | Retirada del mapa, independiente de verificación |
| `POST /lab/incidents/{incident_id}/status` con `official_source` y `official_ack` | Registra respaldo HTTPS y declaración de revisión del operador |

Tipos existentes: `flooded_road`, `road_closed`, `landslide`, `fallen_tree`,
`bridge_damage`, `other`. Fuente (`citizen|synthetic|official`) y verificación
(`pending|corroborated|verified|rejected|expired`) son independientes. Verificar o
registrar respaldo oficial no convierte una fuente ciudadana en una fuente oficial.
El sistema no comprueba por sí mismo la autenticidad del documento externo.

Los mapas activos excluyen rechazados, caducados y retirados; el mapa ciudadano
excluye además fuentes sintéticas. Los pendientes conservan su señal explícita.
El filtro `map_visibility` permite separar revisión y presentación. Los snapshots
de una tormenta no se presentan como cierres reales en el mapa ciudadano.

## Validación y privacidad

Se valida JSON cerrado de hasta 8 KiB, descripción de 5–500 caracteres, enums,
área y fecha declarada (hasta siete días atrás o cinco minutos adelante).
No se aceptan fuente, verificación, identidad ni aristas arbitrarias del cliente.
No hay subida de archivos. Las posiciones públicas se aproximan; originales y
hashes de idempotencia quedan privados. El texto libre no tiene detección semántica
de datos personales ni garantiza anonimato.

Registro: diez solicitudes/minuto por hash efímero de IP, cien globales y hasta
1.024 ventanas. No se confía en `X-Forwarded-For`. El replay exacto conserva el
registro; la deduplicación espacial/temporal no acredita corroboración entre personas.
Fechas declarada, recibida y actualizada permanecen separadas en el DTO versionado.

## Persistencia y autorización

El almacén usa un escritor, `flock`, snapshot JSON versionado, permisos 0700/0600,
archivo temporal, `fsync` y reemplazo atómico. Un fallo de guardado no devuelve éxito;
un archivo corrupto impide arrancar el almacén. Límites: 10.000 reportes,
20.000 hashes de replay y 10.000 recibos. Los reportes caducan a las 24 horas y
se purgan a siete días; la deduplicación no es perpetua.

Las revisiones conservan hasta 32 entradas privadas por reporte y persisten antes
del ACK. Un conflicto de `expected_updated_at` impide sobrescribir una revisión
más reciente. La sesión local automática no concede moderación: se necesita el
operador privilegiado existente, cookie HttpOnly, Origin y CSRF.

La API técnica conserva aplicación experimental protegida y creación sintética
identificada para compatibilidad/pruebas; la interfaz pública retiró esas acciones.
Crear, verificar, retirar o documentar un reporte no cambia por sí solo el motor
ni reescribe ejecuciones anteriores. No se elimina esa funcionalidad interna en
esta limpieza.

El directorio persiste fuera de la imagen (`/var/lib/corodev/flood` en EC2;
`services/evacuation/private/incidents` local). Sobrevivir a un reinicio no equivale
a respaldo o alta disponibilidad: perder el volumen pierde los datos.
[Operación y copias](despliegue.md).

## Evidencia

Las pruebas conservan integración Flutter → Go → disco → reinicio → consulta,
publicados y autorización/moderación. Consulta [la matriz ejecutada](pruebas.md)
y [QA especializado](../tools/qa/README.md). Los JSON históricos de
`deploy/validation-phase4c.json` y `validation-phase7-mobile.json` describen sus
versiones; esta limpieza no ejecutó suites ni una nueva prueba física GPS.
