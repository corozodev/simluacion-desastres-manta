# Estado actual FASE 2

Leer [informe-fase2.md](../informe-fase2.md), [README](../../README.md) y [diagnóstico geográfico](../diagnostico-geografico.md). El servidor actual usa `manta-v2` y escenarios urbanos por defecto; el motor histórico solo se reproduce mediante el evaluador. Las notas siguientes conservan el historial de FASE1/starter y no sustituyen ese estado actual. No iniciar FASE3 automáticamente.

# Handoff del starter y Track A

El estado actual de FASE 1 está en [informe-fase1.md](../informe-fase1.md). Backend Go, simulador, grafo OSM real y clientes Escape amplían el starter descrito debajo. El reto ya está definido: prevalecen [README](../../README.md), [reglas](../reglas-simulacion.md), [contratos](../contratos.md) y [decisiones](../decisiones.md). Las secciones siguientes conservan el contexto previo; sus pendientes de assignment/autenticación no describen el nuevo backend.

El siguiente agente puede trabajar sobre un monorepo con web React, cliente Flutter Android y mock Fastify. Ambos clientes usan HTTP y modelos provenientes de `packages/contracts/openapi.yaml`; no hay backend AWS desplegado. La evidencia de comandos, versiones y limitaciones de esta iteración está en [validation.md](../development/validation.md).

## Puntos de entrada

| Necesidad | Archivos |
| --- | --- |
| Cambiar operaciones/modelos HTTP | `packages/contracts/openapi.yaml`, `tools/codegen/contracts.mjs` |
| Implementar API | `services/mock-api/src/app.ts`, `contract.ts`, `fixtures.ts` |
| Configurar API web | `apps/web/src/lib/config.ts` y `.env.local` local |
| Consultas y errores web | `apps/web/src/services/api.ts`, `queries.ts` |
| Navegación web | `apps/web/src/app/App.tsx` |
| Configurar API Flutter | `apps/mobile/lib/core/config/api_config.dart` y `--dart-define` |
| Consultas y errores Flutter | `apps/mobile/lib/core/api`, `lib/core/providers.dart` |
| Navegación Flutter | `apps/mobile/lib/app/app.dart` |
| Cambiar identidad | `packages/design-tokens/brand.json`, `tokens.json`, `tools/codegen/tokens.mjs` |

Lee los `AGENTS.md` antes de modificar un módulo. Las rutas generadas se enumeran en [contratos](../api/contracts.md) y [design system](../design/design-system.md). No las edites manualmente.

## Comprobación rápida

Desde la raíz inicia `npm run dev:api` y `npm run dev:web` en terminales separadas. Abre `http://localhost:5173`. Recorre Resumen, Items, detalle, Formulario demo y Diagnóstico. Busca `no-coincidencia-zzzz` para vacío y abre un ID inexistente para 404.

En Android usa la URL `http://10.0.2.2:3001` en emulador o la IP LAN del host en dispositivo físico; inicia la API con `HOST=0.0.0.0` en una red de confianza. Las instrucciones completas están en [desarrollo local](../development/local-setup.md).

El formulario debe producir una confirmación `202` sin cambiar los 12 registros de demostración. El envío no se conserva, ni siquiera como una colección en memoria. Las fechas de fixture son fijas. El modo `remote` mantiene HTTP y cambia la identificación del entorno; no aporta por sí mismo autenticación o un despliegue.

## Límites conocidos y decisiones pendientes

- No hay assignment ni usuarios de negocio definidos; evita derivarlos del vocabulario de los fixtures.
- No hay autenticación, persistencia, endpoint para consultar envíos ni garantía de idempotencia.
- Los modelos Dart se generan con un subconjunto explícito; el transporte es manual y la validación semántica completa permanece en la API.
- La plataforma nativa preparada es Android. Un APK compilado no demuestra una sesión en un dispositivo; revisa la evidencia antes de afirmar esa cobertura. iOS no está configurado ni validado.
- El mock compilado depende de la ruta del YAML del contrato en el monorepo.
- No se creó infraestructura, configuración de cuenta ni despliegue AWS. La elección de servicios y autenticación se realizará con el reto.
- No se inicializó Git ni se crearon commits. El responsable decidirá cuándo hacerlo.

Cuando se revele el assignment, identifica primero los flujos mínimos de la demo de 48 horas. Actualiza contrato, vocabulario y marca antes de introducir dependencias cloud. Conserva el camino HTTP compartido y reemplaza solo las capacidades necesarias. Registra decisiones nuevas en ADR y la integración concreta en [AWS](../aws/integration.md).
