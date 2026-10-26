# Auditoría inicial — FASE 1

Revisión del árbol existente el 26 de octubre de 2026. El starter existe en `corodev-spooky`; no hay metadatos Git en el directorio ni sus ancestros, por lo que no se inicializa Git ni se crean commits.

- React 19, Vite 8 y TypeScript estricto; TanStack Query 5, React Router 7 y componentes/estilos compartidos ya funcionan. `src/services/api.ts` concentra transporte y validación. No existe infraestructura de mapas.
- Flutter Material 3, Riverpod 3, Dio 5 y GoRouter 17; configuración por `--dart-define`, repositorio HTTP y pruebas ya existen. Flutter se localizó en `/home/naielik/Android/flutter/bin/flutter`.
- OpenAPI 3.0.3 contiene health y operaciones demo. El generador existente produce tipos TypeScript y DTOs Dart; se conserva y amplía para nombres JSON snake_case y JSON Schema draft-07.
- La API mock TypeScript usa validación derivada del contrato. Se conservan rutas, formularios, navegación y fixtures existentes.
- El diseño reside en `packages/design-tokens`, no en `design/tokens.json`. Se reutiliza su estructura real.
- No hay backend Go, grafo OSM ni simulador previo. Go 1.26.1 está instalado en `/usr/local/go/bin/go`, fuera del PATH inicial.
- Dependencias JavaScript instaladas y lockfiles existentes. Comprobaciones iniciales del coordinador: `npm run check` y `npm test` correctos, 16 pruebas web y 39 mock.

Ajuste incremental: añadir `services/evacuation` con biblioteca estándar Go, ampliar los contratos compartidos y añadir visualización y repositorios de observación en los clientes. No sustituir clientes ni introducir servicios de infraestructura.

Riesgos: acceso externo a OSM, cobertura/conectividad del grafo reducido y límites de rendimiento deben verificarse con datos y mediciones reales; la disponibilidad del SDK Flutter no garantiza que todas las herramientas Android estén configuradas. Las reglas ambiguas se documentan expresamente y los sleepers dormidos permanecen fuera de los snapshots.
