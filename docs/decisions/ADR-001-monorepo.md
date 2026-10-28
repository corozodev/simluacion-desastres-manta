# ADR-001: monorepo con npm workspaces y Flutter independiente

Estado: aceptada. Fecha de la decisión original: 2026-10-23.

## Contexto

React y Flutter comparten contrato e identidad. Mantener las fuentes juntas
permite revisar cambios de API y ambos clientes en el mismo árbol.

## Decisión

Conservar `apps/web`, `apps/mobile`, `services/evacuation`, `packages` y herramientas
en un monorepo. npm workspaces administra web, contratos y tokens; Flutter y Go
mantienen sus dependencias y lockfiles propios. Make reutiliza scripts Node de raíz.
El servidor starter fue sustituido por Go y ya no forma parte del workspace.

## Consecuencias

Los cambios de contrato se generan y comprueban desde la raíz. Instalar JavaScript
no instala Flutter/Android ni Go. La API Go se compila independientemente y no
necesita cargar el YAML en producción; las verificaciones HTTP sí usan sus esquemas.
No se añade otra herramienta de orquestación o distribución de paquetes.
