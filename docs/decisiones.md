# Decisiones FASE 1

1. Se conserva el monorepo y sus frameworks, navegación, formularios, tokens y API demo Fastify. El reto ya conocido incorpora un servicio Go en `services/evacuation`; no se inicializa Git porque la copia recibida no contiene metadatos.
2. Monolito modular con biblioteca estándar Go y estado autoritativo en memoria. No hay base de datos, Redis, Lambda, microservicios ni servicios de IA. El proceso es persistente y puede empaquetarse para EC2 en una fase posterior; no se desplegó nada.
3. OpenAPI 3.0.3 mantiene demo y nuevos endpoints. Se amplía el generador existente para JSON Schema y campos Dart camelCase que conservan JSON snake_case. El contrato de `/paso` mantiene exactamente el español solicitado.
4. Se copia el snapshot al publicar/leer. La sencillez e independencia frente a mutaciones prima antes de optimizar copias. La detección de carreras y el benchmark con 200 sobrevivientes comprueban su costo real en esta máquina.
5. La simulación consulta su propia API por TCP/HTTP con una credencial exclusivamente de servidor. El CLI acelerado genera una clave efímera en memoria. `POST /paso` es de lectura; la aplicación de movimientos se mantiene en el simulador.
6. Dijkstra inverso multiorigen comparte un plan por snapshot. Riesgo visible primero, luego costo de turnos/distancia/velocidad; caché de un único plan con fingerprint de entradas y versiones. No se predicen reglas ocultas ni se accede a sleepers dormidos. Ver [algoritmo](algoritmo.md).
7. Grafo peatonal real de 300 nodos, 325 aristas y cuatro refugios ficticios. La reducción conserva corredores conectados y procedencia de cada recorrido; no representa todas las calles de la ciudad. La direccionalidad de vehículos no restringe peatones en esta extracción. Ver [datos](grafo.md).
8. Polling cada dos segundos para la primera visualización; WebSocket pendiente. Estado y grafo observables son públicos para desarrollo local. No existen endpoints administrativos: semillas, rondas y credenciales se cambian al arrancar. Una futura API administrativa necesita una credencial separada.
9. Las cantidades y posiciones de zombies son supuestos de escenarios editables, no reglas oficiales adicionales. La ronda 2 simula el colapso de un puente identificado por OSM; no describe un evento real.
10. Las mediciones locales son evidencia de esta ejecución y no un SLA en AWS. El alcance termina aquí; la siguiente fase requiere nueva autorización.


## Decisiones FASE 2

La auditoría cuantitativa precedió a la activación del nuevo motor. Se conservaron mapa, escenarios, informe y motor de FASE1 para regresión. La red maestra urbana usa OSM y polígonos públicos GeoManta;300nodos no permiten representar toda su vialidad sin omitir cruces, de modo que el operativo se declara muestra representativa y el ampliado permanece experimental. Se retienen también límites y resultados negativos de cortes adversariales.

Las comparaciones separan mapa con refugios históricos remapeados, nuevo protocolo de aparición y algoritmo sobre idénticas condiciones. Las semillas `historical,7,42` se fijaron antes de comparar y se publican regresiones. La configuración global con predicción/reservas se conserva por su resultado agregado de supervivencia; no domina cada semilla o ronda. Los borradores previos a correcciones semánticas se archivan y no sustituyen el resultado final.

AWS se prepara con imagen no-root/readonly, despliegue y rollback reproducibles y plantilla que crea Budget antes de recursos de consumo. Sin cuenta/región/autorización de acceso verificadas no se ejecutaron operaciones cloud ni se inventó gasto o captura. FASE3 requiere otro pedido.
