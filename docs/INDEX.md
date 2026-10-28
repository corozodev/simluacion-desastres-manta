# Referencias técnicas y evidencia

La entrada general es el [README](../README.md#documentación-y-estructura):
allí están arquitectura, desarrollo/AWS, contratos, pruebas, costos y Nivel PRO.
Esta página reúne referencias que necesitan más detalle o conservan comparaciones.

| Tema | Fuente y propósito |
| --- | --- |
| Reglas de simulación | [Reglas y supuestos](reglas-simulacion.md); distingue el reto de las configuraciones editables del proyecto |
| Geografía operativa | [Grafo urbano](grafo-fase2.md), fuentes OSM/GeoManta, reducción y reproducción offline |
| Línea base geográfica | [Grafo original](grafo.md), [diagnóstico](diagnostico-geografico.md), [supervivencia](diagnostico-supervivencia.md), [comparación sólo geográfica](comparacion-geografica-inicial.md) |
| Routing | [Motor original](algoritmo.md) y [routing/predicción FASE 2](algoritmo-fase2.md); implementación y límites |
| Inundaciones | [Uso del laboratorio](laboratorio-inundaciones.md), [hidrología y evidencia](informe-fase8.md) |
| Datos y ciudadanía | [Procedencia y atribución](datos-oficiales-y-demo.md), [incidentes](incidentes-ciudadanos.md) |
| Recursos compartidos | [Tokens e identidad](../packages/design-tokens/README.md), [catálogo visual](../packages/visualization/README.md) |
| Decisiones | [Monorepo](decisions/ADR-001-monorepo.md), [contrato primero](decisions/ADR-002-contract-first.md), [persistencia ciudadana](decisions/ADR-004-incidentes-persistencia.md) |
| Comparaciones conservadas | [FASE 1](informe-fase1.md), [FASE 2](informe-fase2.md), [multigrafo 3B.2](informe-fase3b2.md), [políticas/PRO 7](informe-fase7.md), [hidrología 8](informe-fase8.md) |
| Latencia AWS histórica | [Medición 3B.1](latencia-aws-fase3b1.md): otra versión/host; no acredita el rendimiento actual |
| QA especializado | [Flags, harnesses HTTP/Flutter y evidencia privada](../tools/qa/README.md) |
| Retirada AWS | [Programación y cancelación del auxiliar](../deploy/autokill/README.md) |

Los informes conservados justifican comparaciones, resultados adversos y límites
metodológicos; no son manuales actuales. El evaluador zombie FASE 1 y los grafos
originales se mantienen. Los JSON de `deploy/validation*.json`, `deployment*.json`
y [resultados hidráulicos](fase8-resultados.json) conservan evidencia con su fecha,
versión y alcance. Las versiones documentales sustituidas están en el historial Git.

`deploy/evidence-private/`, `.local/` y los reportes de ejecución no se publican;
los nombres de esas rutas en los informes no son enlaces de descarga.
