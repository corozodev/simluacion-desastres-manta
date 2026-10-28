# Documentación de entrega

La descripción vigente parte del [README](../README.md). La arquitectura y los
manuales siguientes corresponden al código actual; los informes de fases
conservan evidencia histórica y no prueban que una versión esté desplegada.
Entrega prevista: **28 de octubre de 2026, 10:00 de Ecuador**; pitch el **30 de
Octubre en ULEAM**. No se generaron diapositivas en esta consolidación. La publicación Git/AWS
autorizada del commit `47f51fa` está en el [registro de entrega](../deploy/deployment-delivery-20261027.json).

## Guías actuales

| Tema | Fuente principal |
| --- | --- |
| Ejecutar localmente y detener sin borrar datos | [Desarrollo local](development/local-setup.md) y `make help` |
| Componentes, datos y flujo por turno | [Arquitectura](arquitectura.md), [diagrama SVG](arquitectura.svg), [fuente editable](arquitectura.mmd) |
| Predicción, refugios y flota; demostración | [Nivel PRO](nivel-pro.md) |
| Requisitos BASE/PRO, pruebas y metodología de medición | [Pruebas](pruebas.md) |
| API y generación | [Contratos](contratos.md); autoridad: [OpenAPI](../packages/contracts/openapi.yaml) |
| Preparar release, operar AWS y recuperar | [Despliegue](despliegue.md) |
| Proyección, gasto pendiente y captura Budget | [Costos](costos.md) |
| Riesgos, alcance y pendientes del propietario | [Limitaciones](limitaciones.md) |
| Convenciones para agentes | [AGENTS raíz](../AGENTS.md) y los AGENTS de cada componente |

## Referencias técnicas e históricas

Estas referencias se conservan por trazabilidad. Las secciones de una fase
anterior describen aquella implementación: prevalecen las guías actuales y el
contrato/código vigente al evaluar el producto.

| Clasificación | Documentos y motivo |
| --- | --- |
| KEEP: decisiones | [ADR monorepo](decisions/ADR-001-monorepo.md), [contract first](decisions/ADR-002-contract-first.md), [mock histórico](decisions/ADR-003-mock-api.md), [persistencia ciudadana](decisions/ADR-004-incidentes-persistencia.md), [decisiones iniciales](decisiones.md) |
| KEEP: geografía y reglas | [Grafo urbano FASE 2](grafo-fase2.md), [fuentes y diagnóstico](diagnostico-geografico.md), [refugios simulados](refugios-fase2.md), [reglas](reglas-simulacion.md); [grafo FASE 1](grafo.md) conservado para comparación |
| KEEP: algoritmos y evidencia | [Routing FASE 2](algoritmo-fase2.md), [routing FASE 1](algoritmo.md), [supervivencia](diagnostico-supervivencia.md), [comparación geográfica inicial](comparacion-geografica-inicial.md), [auditoría inicial](auditoria.md), [latencia AWS histórica](latencia-aws-fase3b1.md) |
| KEEP: referencias de extensiones por fase | [Laboratorio](laboratorio-inundaciones.md), [modelo de inundación anterior](urban-flood.md), [modelo hidráulico actual y resultados](informe-fase8.md), [incidentes](incidentes-ciudadanos.md), [fuentes oficiales](datos-oficiales-y-demo.md), [diseño compartido](design/design-system.md); los cambios FASE 8 reemplazan reglas hidráulicas anteriores |
| ARCHIVE lógico: informes | [FASE 1](informe-fase1.md), [FASE 2](informe-fase2.md), [3B.1](informe-fase3b1.md), [3B.2](informe-fase3b2.md), [4A](informe-fase4a.md), [4B](informe-fase4b.md), [4C](informe-fase4c.md), [4D](informe-fase4d.md), [5](informe-fase5.md), [6A](informe-fase6a.md), [7](informe-fase7.md), [móvil](informe-fase7-movil.md), [UX](informe-mantasim-ux.md), [map first](informe-map-first.md), [refinamiento reportes](refinamiento-controles-reportes.md); sin moverlos para conservar referencias |
| ARCHIVE lógico: operación previa | [Despliegue inicial](despliegue-aws.md), [caducidad vigente registrada](despliegue-fase5-y-caducidad.md), [publicación FASE 7](despliegue-fase7.md), [publicación reportes](despliegue-controles-reportes.md), [operación multigrafo previa](operacion-multigrafo.md), [revisión rollout](revision-rollout-fase3b2.md), [seguridad inicial](revision-seguridad-fase3a2.md), [preflight](aws-preflight-permisos.md), [pendientes futuros](roadmap.md), [validación starter](development/validation.md) |
| MERGE: navegación compatible | Las antiguas guías de arquitectura y AWS apuntan ahora a [arquitectura](arquitectura.md) y [despliegue](despliegue.md), sin repetir manuales |

Se eliminaron cinco guías duplicadas u obsoletas: `docs/agents/{handoff,workflow}.md`, `docs/development/{testing,troubleshooting}.md` y `docs/api/contracts.md`. Su contenido vigente se integra en AGENTS, desarrollo local, contratos y pruebas; se preserva la validación histórica del starter.

El archivo de informes se conserva en su ubicación original y se identifica
por fase/fecha; no se eliminan resultados negativos ni el evaluador congelado.
Los JSON públicos de `deploy/validation*.json`, `deployment-report*.json` y
[FASE 8](fase8-resultados.json) registran mediciones con su alcance. El directorio
`deploy/evidence-private/` está excluido de Git y no forma parte de la entrega pública.

## Recorrido de pitch de cinco minutos

1. **0:00–0:40:** problema, mapa real de muestra, cuatro refugios simulados y
   distinción entre BASE y la extensión de inundaciones.
2. **0:40–1:40:** `/escape`, iniciar explícitamente una ronda BASE; seleccionar
   un sobreviviente y observar su ruta y amenazas visibles.
3. **1:40–3:10:** demostrar PRO con la configuración reproducible de
   [Nivel PRO](nivel-pro.md): pronóstico estimado, ocupación/reservas y flota.
   Identificar que la flota es experimental y dos aristas no prueban doble m/s.
4. **3:10–4:10:** mostrar el visor ciudadano y la tormenta existente; separar
   profundidades sintéticas, susceptibilidad histórica y reportes pendientes.
5. **4:10–5:00:** diagrama, matriz de pruebas, mediciones reales y costos.
   Usar evidencia conservada para escenarios que no terminen durante el pitch;
   no acelerar silenciosamente las reglas oficiales.

Antes de presentar, comprobar URL y vigencia de la demo, añadir la captura
Budget auténtica, declarar gasto real y revisar la presentación PDF/PPT/PPTX
máximo 20 MB. La lista de [pendientes](limitaciones.md) distingue lo comprobado
de lo que todavía requiere al propietario.
