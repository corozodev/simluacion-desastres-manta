# ADR-001: monorepo con npm workspaces y Flutter independiente

Estado: aceptada. Fecha de la decisión: 2026-10-23.

## Contexto

Web y móvil deben consumir el mismo contrato y la misma identidad durante un hackathon de 48 horas. Mantenerlos en repositorios separados obligaría a coordinar versiones y distribución de paquetes antes de conocer el assignment.

## Decisión

Conservar `apps/web`, `apps/mobile`, `services/mock-api`, `packages/contracts`, `packages/design-tokens` y herramientas en un único árbol. npm workspaces administra los paquetes JavaScript; Flutter mantiene sus propias dependencias y lockfile. Scripts Node en la raíz ejecutan Flutter desde su directorio mediante `PATH` o `FLUTTER_BIN`.

No añadir una herramienta adicional de orquestación, publicación de paquetes ni infraestructura cloud. No inicializar Git automáticamente.

## Consecuencias

Un cambio de contrato puede actualizar API y ambos clientes de forma atómica en el árbol local. La generación y los checks parten de la raíz. La instalación JavaScript no instala Flutter ni el SDK Android; esas herramientas se comprueban por separado. La API compilada conserva una dependencia de ruta hacia el YAML del monorepo, que debe incluirse al empaquetarla.

Si en el futuro los ciclos de release se separan, evaluar publicación y versionado de contratos con requisitos reales; no resolver esa distribución por adelantado.
