# Controles de inundación y moderación de novedades

Se compactó la barra del laboratorio, con estado, turno y progreso juntos.
Cancelar abre un diálogo y utiliza la operación real existente, con cierre del
HTTP privado del motor y conservación del snapshot final. El menú de acciones
se representa fuera de los contenedores del mapa, se ajusta al viewport y cierra
al elegir una acción, pulsar Escape o hacer clic fuera.

Se retiraron el inspector de vías, la comparación visual A/B y el acordeón
independiente de fuentes oficiales. La comparación del backend se conserva;
la procedencia se resume al final. No se modificaron los motores hidráulico,
zombie, evacuación, configuración de lluvia, duración o refugios.

Las tarjetas muestran tipo, validación, origen, descripción, fecha y severidad.
La selección permite ubicar el marcador. Se retiró la aplicación experimental y
los metadatos técnicos del detalle cotidiano.

La moderación reutiliza el operador existente, cookie HttpOnly, Origin y CSRF:

- Verificar y rechazar actualizan `verification_status` mediante `/status`.
- Retirar añade `map_withdrawn: true`, independiente de la verificación.
- Marcar como oficial registra una fuente HTTPS y la declaración expresa del
  operador que la revisó. Conserva `source_type`, incluido el origen ciudadano;
  no comprueba automáticamente la autenticidad del documento externo.
- `/lab/incidents/permissions` deriva permisos del rol de operador existente.
  Una cookie local de desarrollo no concede permisos de moderación.

Las revisiones usan `expected_updated_at`, persisten antes del ACK y conservan
un historial privado de hasta 32 revisiones por reporte. La retención existente
sigue siendo siete días; no se ejecutaron migraciones ni se editaron registros.
Los rechazados y retirados se excluyen de mapas activos. Polling y versiones,
incluidos nanosegundos, evitan sustituir una revisión confirmada con una respuesta
anterior. La moderación no cambia ejecuciones históricas ni aplica cierres al motor.

OpenAPI incluye campos opcionales y el filtro `map_visibility`. Por prohibición
expresa de codegen, los archivos generados no se tocaron: React añade tipos de
transporte y Flutter lee los campos opcionales en su repositorio. La generación
habitual queda pendiente para una sesión que la autorice. No se añadieron
pantallas ni administración a Flutter ni se recompiló Android.

No se ejecutaron tests, lint, formateadores, typechecks, benchmarks, codegen ni
pruebas de navegador. La revisión de los cambios se limitó a leer el código.
La instrucción posterior de publicar autoriza los commits/push y las compilaciones
de producción necesarias para desplegar el backend y frontend. Compilar no
acredita la funcionalidad de esta modificación; el despliegue se registra aparte.

La auditoría privada identifica la sesión privilegiada mediante una huella
irreversible, sin guardar su cookie ni su token. El rol de operador existente
es el único rol administrativo disponible; no se creó un sistema de cuentas.

## Archivos principales modificados

- React: `features/flood/FloodLab.tsx`, `FloodMap.tsx`, `IncidentPanel.tsx`,
  `ReferencePanel.tsx`, `incidentPresentation.ts`, `flood.css`, nuevos
  `ActionMenu.tsx` y `CancelSimulationDialog.tsx`; `features/mobile/MobileViewer.tsx`.
- HTTP React: `services/api.ts`, `queries.ts`, nuevo `incidentTypes.ts`;
  `components/OperatorAccess.tsx` reutiliza el acceso existente para moderación.
- Contrato: `packages/contracts/openapi.yaml`.
- Backend: `internal/incidents/models.go` y `store.go`;
  `internal/floodlab/incident_http.go`, nuevo `incident_permissions.go` y
  cierre de recursos de cancelación en `manager.go`.
- Flutter: `core/api/incident_repository.dart`,
  `features/escape/escape_screen.dart`, `route_map.dart` y
  `features/incidents/incident_report_screen.dart`.

Los archivos generados permanecen sin modificar. Un binario antiguo que lea
el almacén con campos nuevos puede necesitar una versión compatible para
retroceder; no deben descartarse revisiones nuevas para restaurar un snapshot.
