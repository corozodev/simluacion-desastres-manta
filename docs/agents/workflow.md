# Flujo de trabajo para agentes

Lee primero [`AGENTS.md`](../../AGENTS.md) y las instrucciones del módulo afectado. El reto actual es Track A, Escape de Manta Zombie: consulta [arquitectura](../arquitectura.md), [reglas](../reglas-simulacion.md) y [contratos](../contratos.md). FASE 2 está autorizada; conserva comparaciones históricas y no añadas alcance de FASE 3. Cloud requiere cuenta/región autorizadas y acceso verificable. No inicialices Git ni crees commits automáticamente.

## Antes de editar

1. Inspecciona el código y los scripts reales. Revisa si ya hay cambios o procesos activos y conserva el trabajo ajeno.
2. Identifica la fuente de verdad: OpenAPI para HTTP, tokens JSON para diseño, `brand.json` para identidad.
3. Delimita archivos y dependencias. Si varias personas o agentes trabajan a la vez, acuerda ownership exclusivo antes de editar.
4. Presenta un plan breve con comprobaciones concretas; comienza con trabajo que no dependa de decisiones pendientes.

La primera implementación se distribuyó entre contratos/API, web, móvil, tokens/herramientas y documentación/QA. Los roles se ejecutaron según las plazas disponibles; el orquestador conservó integración y validación final. Para futuras tareas, delega módulos independientes cuando el alcance lo justifique y las instrucciones lo autoricen. No describas un supuesto paralelismo como evidencia de ejecución.

## Cambio de API

Modifica `packages/contracts/openapi.yaml`, actualiza ejemplos y ejecuta:

```sh
npm run contracts:validate
npm run contracts:generate
npm run generated:check
```

Después implementa el endpoint y los adaptadores manuales de ambos clientes. Comprueba errores y estados de interfaz además del caso exitoso. El generador no crea rutas Fastify ni métodos fetch/Dio; su alcance está en [contratos](../api/contracts.md).

## Cambio visual

Modifica `tokens.json` o `brand.json` y ejecuta `npm run tokens:generate`. Revisa web y Flutter. Si el cambio introduce un nuevo tipo de token, actualiza el generador; no agregues una segunda paleta en un componente para resolverlo localmente.

## Verificación y entrega

Para cambios integrados utiliza `npm run check`, `npm test`, builds pertinentes y las verificaciones Flutter. Para Track A incorpora pruebas Go con race, importador, contrato HTTP real y mediciones conforme a [pruebas FASE 1](../pruebas.md). La lista previa del starter está en [pruebas](../development/testing.md). Selecciona pruebas proporcionales al cambio, sin reemplazar una prueba real fallida por un mock que evite el problema.

Entrega qué cambió, archivos propios, decisiones, comandos ejecutados y resultados exactos. Distingue un test omitido de uno aprobado y un build de una prueba en dispositivo. Comunica pronto un bloqueo con la causa y un paso reproducible; el orquestador resuelve dependencias e integra los módulos.

Actualiza el documento que describa la decisión o configuración modificada. Conserva cambios localizados cuando sea suficiente. Si una afirmación no se puede verificar, declárala como pendiente en el handoff; no la conviertas en una capacidad implementada.

## Dependencias y seguridad

Conserva lockfiles y compatibilidad con Node y Dart declarados. Verifica la documentación oficial de una biblioteca cuando cambie su API. Evita añadir herramientas para resolver un problema que cubren las existentes.

Las variables de frontend y `--dart-define` son públicas. No escribas credenciales ni datos sensibles en clientes, fixtures o logs. Mantén las simulaciones de errores restringidas a desarrollo y la escucha de red local por defecto. Las fechas fijas de demostración y el 27 de octubre de 2026 pertenecen a la simulación; nunca prueban cuándo se ejecutó una acción.
