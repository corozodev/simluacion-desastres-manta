# Roadmap después de FASE 2

FASE2 añadió fuente urbana, variantes geográficas, orígenes municipales, predicción, reservas, evaluación, mapa y preparación AWS. La evidencia, incluidos resultados negativos, está en [informe-fase2.md](informe-fase2.md).

FASE 3A.2 completó el despliegue autorizado: stack CREATE_COMPLETE, Budget existente verificado, DNS/HTTPS y pruebas externas. Véase [despliegue](despliegue-aws.md). FASE 3B.1 retiró el servidor anterior de ambos clientes y completó el diagnóstico de latencia y la publicación Git. Véase [informe FASE 3B.1](informe-fase3b1.md). No se inició FASE 3B.2.

Pendientes de operación y opciones futuras, sin implementarlas:

1. Seguir el gasto cuando AWS actualice el Budget, confirmar entrega de alertas y obtener una captura auténtica si se necesita. Conservar rollback; la simulación finita requiere un reinicio controlado para otra sesión. El repositorio ya está publicado en el destino configurado por el propietario.
2. Resolver con la organización la tensión entre aproximadamente300intersecciones y conectividad urbana. El ampliado1000es experimental y no se activa automáticamente.
3. Mejorar calibración del predictor con más semillas predeclaradas y validación separada; investigar regresiones de ronda2 y personas vivas sin evacuar.
4. Evaluar asignación global más eficiente y rutas temporales para cruzar cuellos de botella sin violar restricciones.
5. Completar WebSocket con polling de respaldo únicamente tras estabilizar despliegue y motor. Profundizar UX y prueba en dispositivo físico.

No hay servicios generativos en decisiones, flota, microservicios ni Kubernetes. No se habilitan estrategias inexistentes ni se modifica dificultad para inflar puntuaciones.
