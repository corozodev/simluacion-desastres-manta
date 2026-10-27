# Informe FASE 3B.2 — simulación multigrafo

Entrega local validada el 26 de octubre de 2026, Ecuador. Competición conserva el comportamiento anterior; React incorpora previsualización y control de rondas autenticado. La URL pública y el backend AWS permanecen en la versión previa: la candidata está preparada y requiere autorización para el rollout que reinicia el proceso. [Operación](operacion-multigrafo.md), [evidencia resumida](../deploy/validation-phase3b2.json) y [revisión concreta del rollout](revision-rollout-fase3b2.md).

## Alcance y criterio

El propietario aclaró que no busca forzar al maestro a rendir como el preset de 300 intersecciones. Competición es la referencia del Track A; el mapa completo es un experimento de compatibilidad, geografía y costo. Los umbrales p95 ≤150 ms y llamada <500 ms se muestran como referencia diagnóstica del estrés, sin atribuir al reto una exigencia oficial sobre 9.179 nodos. No se infiere por qué la organización eligió 300.

El catálogo valida checksums, conectividad utilizable, geometrías, cuatro zonas de aparición y cuatro refugios. Competición usa 300/383, completo 9.179/13.452 y ampliado 1.000/1.599. No se modificaron datos, escenarios, motores de decisión/coordinación, reglas zombie ni reportes FASE 2. La operación OpenAPI completa de `/paso` y ambos esquemas conservan igualdad semántica exacta con el original.

React distingue vista previa de activación, sincroniza grafo/estado por ID de ejecución y limpia selección/rutas/coordenadas al cambiar. El mapa memoriza calles estáticas y calcula extremos sin expandir grandes arrays como argumentos. Las visitas públicas sólo observan. El inicio administrativo exige credencial independiente de 256 bits, cookie HttpOnly/Secure/SameSite, origen aprobado y CSRF de sesión; no usa la clave de movimiento, VITE ni almacenamiento del navegador. Sólo inicia entre rondas; un segundo inicio activo devuelve 409. Cada ejecución crea estado y cachés propios; conserva diez finales observables en RAM.

## Rondas y resultados

Semillas 20261026/27/28; 150 turnos y concurrencia HTTP interna 16. El maestro ejecutó las tres rondas a intervalos nominales de 2 s: aproximadamente 301 s por ronda. Competición y ampliado se ejecutaron acelerados a intervalo 0 para comprobar desenlaces; sus tiempos y CPU media no son comparaciones de rondas pausadas. Los tres presets terminaron sin solicitudes inválidas ni timeouts en estas rondas.

| Modalidad | Ronda | Evacuados | Mordidos | Activos al 150 | Turno medio evacuación | Sin ruta¹ | Inmovilidad¹ |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Competición | 20 | 20 | 0 | 0 | 24.75 | 23 | 22 |
| Competición | 80 | 60 | 0 | 20 | 11.77 | 3004 | 1541 |
| Competición | 200 | 132 | 41 | 27 | 13.04 | 3340 | 4586 |
| Ampliado | 20 | 20 | 0 | 0 | 15.75 | 0 | 0 |
| Ampliado | 80 | 80 | 0 | 0 | 43.17 | 386 | 386 |
| Ampliado | 200 | 189 | 11 | 0 | 30.92 | 205 | 800 |
| Completo | 20 | 20 | 0 | 0 | 30.20 | 0 | 0 |
| Completo | 80 | 80 | 0 | 0 | 32.15 | 0 | 0 |
| Completo | 200 | 175 | 0 | 25 | 72.94 | 0 | 888 |

¹ Son turnos-persona acumulados, no personas distintas. Turno medio se calcula sólo entre evacuados. Las 25 personas activas del maestro al turno 150 no se cuentan como evacuadas.

Competición reproduce 20/0/0, 60/0/20 y 132/41/27 (evacuados/mordidos/activos). En el maestro, más calles y refugios ubicados en otros nodos cambian distancias y distribución de amenazas. Las semillas se conservan, pero el conjunto de candidatos de aparición es distinto. Los bloqueos se remapean al mismo ID físico de calle. Por tanto, 175/0/25 frente a 132/41/27 no demuestra una mejora algorítmica; compara topologías y condiciones iniciales diferentes.

## Latencias y recursos

Linux local, contenedores limitados a dos CPU y 1 GB, `GOMAXPROCS=2`, sin salida de red externa. No es una EC2 ni una medición HTTPS desde Ecuador. Otros trabajos de validación del host pudieron competir por CPU. RSS es el máximo del proceso y CPU son segundos acumulados de usuario+sistema, incluidos catálogo/inicialización; no incluyen todo el host o Caddy. Cada ventana y el checksum del binario constan en JSON. El benchmark independiente no usa el gestor administrativo ni la previsualización; se compiló antes de normalizar la disponibilidad en esa caché. Sus grafos, escenarios y motores son los mismos; la asignación de memoria al arrancar la candidata puede variar. Docker y Chromium sí verificaron la versión corregida.

| Modalidad | Ronda | HTTP interno p95 / p99 ms | Planificación p95 ms | CPU s | RSS máxima MiB |
| --- | --- | ---: | ---: | ---: | ---: |
| Competición | 20 | 1.59 / 1.92 | 2.44 | 0.68 | 39.9 |
| Competición | 80 | 2.27 / 2.90 | 6.13 | 1.57 | 46.2 |
| Competición | 200 | 2.78 / 3.61 | 14.53 | 2.47 | 44.7 |
| Ampliado | 20 | 5.04 / 5.89 | 10.55 | 1.58 | 43.0 |
| Ampliado | 80 | 7.48 / 9.80 | 24.88 | 5.37 | 42.5 |
| Ampliado | 200 | 9.61 / 12.98 | 54.31 | 8.11 | 40.8 |
| Completo | 20 | 48.67 / 59.88 | 99.09 | 18.72 | 131.4 |
| Completo | 80 | 76.17 / 134.89 | 219.06 | 33.77 | 147.1 |
| Completo | 200 | 64.35 / 84.67 | 439.31 | 122.47 | 146.8 |

El maestro de 200 tuvo planificación p50/p95/p99 de 249,97/439,31/489,74 ms y trabajo total por turno p95/p99 de 904,61/1018,76 ms. Su CPU media fue 40,72% de un núcleo durante la ronda pausada; no significa 40,72% de una EC2 completa. El p95 HTTP de 64,35 ms mide decisiones sobre un plan ya preparado y no incluye el costo completo del turno.

El estrés separado mantuvo un snapshot inicial estable, calentó el motor y envió 1.000 intentos autenticados con 200 clientes simultáneos, conexiones persistentes y deadline de 500 ms. Percentiles nearest-rank sobre **todos** los intentos, incluidos timeouts:

| Modalidad | p50 ms | p95 ms | p99 ms | Máximo ms | Correctas / timeouts | RSS MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Competición | 28.95 | 131.72 | 138.77 | 159.24 | 1000 / 0 | 54.2 |
| Completo | 388.18 | 657.01 | 774.09 | 1053.48 | 761 / 239 | 200.0 |
| Ampliado | 45.87 | 126.19 | 162.02 | 179.11 | 1000 / 0 | 55.4 |

El maestro registra 23,9% de timeouts bajo saturación de 200 clientes, mientras sus rondas con concurrencia interna 16 no tuvieron timeouts. No son la misma carga. Bajo saturación, la goroutine cliente puede recuperar control después del deadline: los tiempos de retorno superiores a 500 ms se conservan en lugar de truncarlos. Los recibos Docker no registraron OOM.

La lectura del store copia el grafo completo y la planificación trabaja sobre una red mayor. Ese trabajo aumenta con el grafo, además de influencias de GC, concurrencia y contención; no se presupone una relación lineal ni se presenta un perfil de CPU inexistente. Se conserva el maestro y se informa su costo. La activación experimental queda deshabilitada por defecto en la candidata; cualquier ensayo público requiere una decisión explícita de operación, sin ampliar EC2 automáticamente.

Dos series preliminares usaron GOMAXPROCS=12 heredado del host pese a la cuota de dos CPU: hubo timeouts incluso en Competición. Se conservaron esos intentos y dos rondas preliminares interrumpidas, separados de la serie completa con dos hilos. No se mezclaron sus muestras ni se eligieron percentiles entre series.

## React, seguridad y verificaciones

Go real + Chromium renderizó 13.452 calles: carga/representación de vista previa 1087,62 ms; zoom/restablecer 678,20 ms; heap JS observado 83.799.292 bytes y 27.113 nodos DOM. Son una corrida local de desarrollo, no un SLA o benchmark de teléfono. Se comprobó ancho 390 px, previsualización sin marcadores anteriores, acceso público sin mutación, login, inicio real del maestro, bloqueo de segunda ronda, 150 turnos acelerados explícitamente a 10 ms, retención de final y logout. Hubo cero errores JavaScript y cero solicitudes del navegador con `x-api-key`. No se hizo una prueba física móvil.

El primer ensayo real detectó disponibilidad estática de refugios sin normalizar en la caché de previsualización; se corrigió con la misma normalización inmutable del grafo y se añadió regresión. Una prueba jsdom de 27.000 nodos agotó inicialmente su límite de 5 s durante compilaciones paralelas; su límite quedó en 15 s. La latencia visual se mide aparte en Chromium, no se deriva de ese timeout.

Pruebas ejecutadas: Go unitarias y race en todos los paquetes; race adicional de control para preparación fallida, ronda obsoleta, semilla ausente, CSRF ligado a sesión y credenciales independientes; vet/build; OpenAPI y generación TypeScript/Dart; TypeScript/ESLint; 22 pruebas React y 40 del servicio histórico; 8 Chromium existentes; integración real Go/React; 10 pruebas geográficas sin regenerar datos; Docker endurecido con 200 decisiones HTTP reales; Flutter analyze, 13 pruebas y un skip condicional, integración Go/Dart ejecutada aparte y APK debug compilada. El maestro pasó las tres rondas; el estrés conserva su resultado desfavorable sin convertirlo en una exigencia oficial del mapa experimental.

El nuevo binario registra inicio/final con timestamp, operador, ID, grafo, semilla y configuración, sin cuerpos o credenciales. Se reutilizará el destino awslogs existente cuando se autorice el despliegue. No se añadió infraestructura de observabilidad, IAM, DNS ni recursos facturables.

## Git, AWS y pendientes

Commits auténticos, sin alterar fechas ni reescribir historial:

- `d6d8d21`: catálogo, contrato y administración autenticada.
- `c3c311e`: selector React, sincronización y pruebas reales de navegador.
- `e0d7417`: herramienta y evidencia de rondas/saturación.

El repositorio conserva el remoto aprobado `main`, `corozodev/simluacion-desastres-manta`. Se revisó el contenido explícito de cada commit, incluidos patrones AWS, claves privadas y comparación con secretos reales locales; sin hallazgos. Evidencias privadas, códigos/verificadores, snapshots previos, APK, bundles y builds quedan fuera de Git. Los tres commits anteriores ya se enviaron al remoto aprobado mediante avance normal, sin force push. Esta documentación se registra después en un commit separado y se comprueba nuevamente el HEAD remoto al cerrar.

A las 20:48 de Ecuador se consultaron por HTTPS verificado frontend, health y estado públicos: 200; producción seguía en Competición, turno 150, versión 301, 132/41/27, sin reinicio. Se guardó su snapshot observable privado. La imagen candidata y el frontend están empaquetados localmente con hashes en la revisión de rollout. El control nuevo aún no está disponible en AWS.

Pendientes: autorización para el rollout que detiene el backend y reinicia una ronda, validación externa de esa candidata después del despliegue, prueba física móvil y decisión separada si se desea ensayar el maestro públicamente. El historial es RAM y un rollback restaura imagen, no estado. No se inicia otra fase.
