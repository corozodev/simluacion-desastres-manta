# Latencia — FASE 3B.1

Diagnóstico del 26 de octubre de 2026, hora de Ecuador. Se conserva el motor, los cuatro endpoints y el contrato español de `/paso`. No se añadió OpenTelemetry ni un agente: los hooks de medición existentes, `httptrace` de Go y los tiempos nativos de Caddy permiten separar primero los componentes sin dependencias de producción.

Las mediciones sitúan el mayor costo en el trayecto Ecuador–Ohio y el establecimiento de conexiones: POST externo p50 **361,494 ms** con TCP/TLS nuevos y **112,529 ms** reutilizándolos, frente a un handler Go aislado en esa EC2 con **p95 0,549 ms** sobre el mismo mundo final. La reducción del cliente de diagnóstico no se presenta como una mejora nueva del navegador, que ya reutiliza conexiones.

## Qué mide cada capa

| Medición | Alcance y límite |
| --- | --- |
| `httpapi.Options.Observe` | Adquisición/copia de snapshot, `engine.NextStep` y handler Go. El callback ya existía; el diagnóstico lo conecta en un proceso aislado, sin cambiar el servidor desplegado. |
| `Simulator.Diagnostics().Timings` | Preparación/planificación, publicación y turno. Planificación incluye validación de rutas y reconciliación de reservas; turno incluye HTTP interno y diagnósticos. |
| `/estado.metrics.http_*_ms` | HTTP loopback del simulador, incluidas conexión/reutilización, codificación y recepción. Acumula solicitudes de esa ejecución; no mide Ecuador ni exclusivamente CPU de Go. |
| Caddy `duration` | Duración de la solicitud dentro de Caddy, en **segundos**. No incluye toda la negociación TLS previa a la solicitud. |
| Caddy `upstream_latency_ms` | Tiempo hasta las cabeceras del upstream, en milisegundos; incluye transporte Docker/espera/Go, no exclusivamente CPU del handler. |
| Caddy `upstream_duration_ms` | Tiempo del intercambio con el upstream hasta completar la respuesta, en milisegundos. |
| Cliente `httptrace` | DNS, intentos TCP, TLS, primer byte y recepción completa, usando reloj monotónico. Incluye la ubicación real del cliente. |

`NextStep` calcula/comprueba la clave de caché y selecciona el plan coherente. Su medida no representa únicamente una lectura de mapa. `Store.Load` clona el snapshot observable y su grafo local para proteger la autoridad del simulador; no se cambió este comportamiento.

Los percentiles de dos series no se restan para atribuir tiempo a una capa. Incluso la diferencia por solicitud entre Caddy y upstream incluye escritura hacia el cliente, compresión y otros trabajos: no es una medida exacta de CPU del proxy.

## Herramientas reproducibles

Desde `services/evacuation`, compilar sin dependencias externas:

```sh
CGO_ENABLED=0 go build -trimpath -o /RUTA_PRIVADA/corodev-latency ./cmd/latency
CGO_ENABLED=0 go build -trimpath -o /RUTA_PRIVADA/corodev-diagnose ./cmd/diagnose
```

El diagnóstico interno crea su propio proceso/puerto loopback con clave efímera. No reinicia el servicio público. Utilizar los mismos archivos de grafo/escenario y semilla al comparar máquinas; ejecutar secuencialmente, sin otro benchmark concurrente:

```sh
/RUTA_PRIVADA/corodev-diagnose -requests 1000 -concurrency 1 -turns 150 \
  -output /RUTA_PRIVADA/internal-c1.json
```

Para comparar con producción ya terminada al turno 150, usar una sola corrida previa y seleccionar después los sobrevivientes que siguen activos:

```sh
GOMAXPROCS=2 /RUTA_PRIVADA/corodev-diagnose \
  -requests 1000 -concurrency 1 -simulation-concurrency 16 \
  -stable-after-turns 150 -output /RUTA_PRIVADA/internal-final-ec2.json
```

`-stable-after-turns` y `-turns` son incompatibles: no se ejecutan dos corridas completas por accidente. El primero mide el snapshot final; el segundo conserva la modalidad de snapshot inicial seguido de simulación dinámica. La concurrencia HTTP estable y la concurrencia del simulador son parámetros distintos y se reportan por separado. El JSON de ronda 3 usa 32 trabajadores si no se sobrescribe; producción usa 16. En la imagen existente los archivos están bajo `/app/data` y `/app/scenarios`; copiar sólo el grafo y escenario necesarios al directorio privado de diagnóstico, conservando sus hashes.

Las mediciones directas de snapshot y decisión, las de HTTP real y la simulación dinámica se ejecutan en fases distintas. Una solicitud de calentamiento por sobreviviente precede al HTTP estable. La planificación incluye la preparación inicial: 151 medidas para una corrida de 150 turnos; publicación incluye la inicial y las dos publicaciones de cada turno. Se exportan solamente tiempos, contadores y configuración general; las posiciones privadas iniciales y sleepers dormidos del reporte de diagnóstico no se escriben.

El probe de transporte recibe `API_KEY` únicamente por entorno privado. No usar la clave como argumento, no imprimirla y no incorporarla a React/Flutter. Su JSON se crea con modo 600 y omite cuerpos, cabeceras, IDs y rutas arbitrarias:

```sh
/RUTA_PRIVADA/corodev-latency \
  -base-url https://api.sistemamanta.lexinnovate.com \
  -endpoint /paso -samples 100 -connection-mode both -interval 100ms \
  -vantage Ecuador -output /RUTA_PRIVADA/external-paso.json
```

En EC2 se utiliza el mismo binario, con 200 operaciones por modo y un worker, comparando `http://127.0.0.1:8080` con el origen HTTPS público. La ubicación se declara explícitamente mediante `-vantage`; la URL no prueba por sí sola desde dónde se ejecutó. Los endpoints públicos `/healthz` y `/estado` también están permitidos; no necesitan clave. El modo HTTP sin TLS se limita a direcciones loopback literales.

Se fija HTTP/1.1 en ambos modos para aislar la reutilización TCP/TLS; no se presenta como una medición de multiplexación HTTP/2 del navegador. `new` desactiva keep-alive y `reuse` conserva un transporte por lote. Se rechazan redirecciones y certificados inválidos; no se utiliza un proxy heredado del entorno. `-connect-ip` sólo se usa si el operador necesita un diagnóstico explícito: evita DNS, conserva SNI/verificación TLS y queda registrado en el reporte.

La negociación ALPN se fija también a `http/1.1` y se registra cuando ocurre. Una primera corrida inválida del instrumento negoció HTTP/2 con un transporte HTTP/1: se conserva como `external-instrument-invalid-alpn.json`, excluida de resultados del producto. La corrección se probó contra un servidor TLS que ofrece HTTP/2 y HTTP/1.1, con su CA validada, y contra `/healthz` público. Si falla el setup, el probe finaliza ese lote con cero operaciones intentadas y cero muestras de latencia; no fabrica tiempos cercanos a cero para operaciones que nunca se enviaron.

El setup obtiene `/grafo` una vez por modo; los GET reciben un calentamiento inicial. Estos registros quedan en `setup_excluded_from_statistics`, fuera de las muestras. `/estado` no publica el campo Go local `Graph`: el probe vuelve a asociar el grafo en memoria y comprueba su versión para validar el vecino transitable o espera. Se prueban tanto un vecino permitido como una arista bloqueada.

`dns_ms`, `tcp_ms` y `tls_ms` quedan en `null` si no hubo evento, algo esperado en conexiones reutilizadas. TTFB se cuenta desde el inicio de la solicitud. Los tiempos de intentos TCP paralelos se agregan y pueden solaparse con otros eventos; las columnas no forman necesariamente una suma exacta del total. El reporte registra adquisiciones de conexión e intentos TCP/TLS para hacer visibles reconexiones del transporte.

## Solicitudes, operaciones y 409

Una operación `/paso` comprende obtener `/estado` y enviar una decisión con `sobrevivienteId`, `nodoActual` y `turno` de ese snapshot. Un 409 conserva su tiempo y estado en la serie de intentos. Sólo el 409 permite un nuevo intento lógico, obteniendo antes un snapshot nuevo; un error de red POST no se reintenta automáticamente.

`attempt_availability` cuenta únicamente decisiones válidas 200 sobre todos los intentos, incluidos conflictos y fallos. `operation_availability` cuenta operaciones completadas tras los reintentos limitados. El tiempo de operación incluye GET, POST y todos los reintentos, sin el descanso entre operaciones. Una respuesta 200 con movimiento inválido se registra como fallo de contrato y no como éxito.

La API compara el turno y nodo enviados, además del estado activo del sobreviviente, contra su snapshot publicado. El mundo puede avanzar durante el transporte Ecuador–Ohio y producir un 409 legítimo sin modificar el contrato. Los once 409 históricos no permiten distinguir retrospectivamente cuál de esas condiciones cambió en cada intento.

Para conservar disponibilidad no se reinicia el mundo Go en esta iteración. El lote comparable utiliza el turno final 150 con 27 sobrevivientes todavía activos; cero conflictos en ese lote no demuestra ausencia de conflictos durante una simulación dinámica. La reproducción controlada envía un turno desfasado en una petición separada, conserva la respuesta 409 como comprobación del contrato y no la mezcla con disponibilidad o percentiles del benchmark. El tratamiento de reintentos se comprueba también por HTTP en los tests del instrumento. El proceso aislado de diagnóstico sí puede ejecutar sus propios 150 turnos sin alterar el mundo público.

La reproducción real `controlled-409-reproduction.json` obtuvo **200 → 409 CONFLICT → 200** al enviar primero el estado actual, después un turno desfasado y finalmente el estado actual otra vez. El turno público permaneció 150, el request ID del error coincidió con su cabecera y el reporte no contiene la clave. Es una inyección controlada fuera del benchmark, no una caída de disponibilidad observada espontáneamente.

El timeout de transporte predeterminado del diagnóstico es 10 segundos, independiente del objetivo de 500 ms. Se registran por separado timeouts reales y solicitudes que superan 500 ms; no se descartan éxitos lentos ni conflictos. El cliente interno del simulador conserva su límite de 500 ms.

La medición anterior FASE 3A.2 tenía 30 éxitos sobre **41 intentos**, con **11 conflictos**: el éxito por intento fue 73,17%, aunque las 30 operaciones terminaron. Sus p50/p95/p99 de 364,43/384,72/524,49 ms se calcularon sobre éxitos mediante otro cliente. No constituyen un antes/después equivalente al nuevo probe; las comparaciones controladas deben usar este mismo binario, ubicación, protocolo, pacing y estado del mundo.

## Caddy opcional y sanitizado

El candidato es `tools/qa/Caddyfile.latency`; no se activa por compilar herramientas. Conserva `admin off`, HTTPS, compresión y cabeceras del proxy existente. Usa exclusivamente módulos core de la imagen Caddy 2.11.7 fijada por digest.

El encoder `filter` elimina **todo** `request`, `resp_headers` y `user_id` en los logs de acceso y en el logger global. Así se retiran también URI/query, IP, cookies, `Authorization`, `x-api-key` y cabeceras de respuesta. No se confía en la redacción predeterminada de cabeceras, que no incluye una cabecera personalizada `x-api-key`. Los manejadores automáticos de Caddy pueden generar registros sin `route`; el agregador debe contarlos explícitamente como no clasificados y excluirlos de la serie `/paso`, manteniendo intactas las comprobaciones de privacidad.

El archivo `/data/diagnostics/access.json` utiliza el volumen privado existente, modo 600, rotación de 5 MiB, tres archivos históricos y retención configurada de históricos de 24 horas. Esto no elimina automáticamente el archivo activo al cumplirse 24 horas; al cerrar el diagnóstico se conserva sólo la evidencia autorizada. No se añade un agente, grupo de logs, permiso IAM o gasto recurrente de ingestión. Conserva `duration`, `status`, `size`, timestamp/logger y los dos tiempos de upstream. La clasificación `route` permite sólo `/healthz`, `/grafo`, `/estado`, `/paso` u `other`, mediante un mapa de coincidencias exactas; no conserva un path suministrado por el cliente. No registra IDs de sobrevivientes ni turnos como dimensiones.

La validación local reproducible es:

```sh
python3 tools/qa/verify_caddy_latency.py --output /RUTA_PRIVADA/caddy-check.json
```

Se ejecutaron 20 comprobaciones: validación con imagen fijada; solicitudes 200 y 502 real de upstream inaccesible; canarios de path/cabeceras/cookie/query y cookie de respuesta ausentes en ambos logs; tiempos upstream observados; rutas clasificadas exclusivamente mediante la lista estática; modo 600; recarga SIGUSR1 con configuración nueva, PID y `StartedAt` iguales, solicitud en vuelo completada y 30 GET completados con reconexión segura. La salida contiene únicamente estados booleanos; no imprime canarios. La prueba modifica sólo su contenedor y archivos temporales locales.

**SIGUSR1 puede cerrar conexiones TCP ociosas.** El test registró esa reconexión; no afirma conservar la misma TCP. Sólo el GET de prueba permite una reconexión explícita. El uso productivo debe hacerse en una ventana coordinada entre lotes de medición, sin POST de prueba en vuelo, y mantener sus resultados fuera de las distribuciones de latencia.

Antes de aplicar, conservar el archivo anterior y su hash, comprobar que Caddy se inició con `run --config` sin `--resume` ni cambios por API, escribir en el mismo inodo usado por el bind mount y enviar SIGUSR1. Comprobar salud, configuración, PID y `StartedAt`. Rollback: restaurar el contenido anterior en ese mismo inodo, enviar SIGUSR1 y repetir las comprobaciones; no reiniciar la simulación. Los certificados y claves del volumen `/data` permanecen privados y nunca se incluyen en los artefactos.

Referencias oficiales verificadas: [logs y filtros Caddy](https://caddyserver.com/docs/caddyfile/directives/log), [tiempos upstream mediante log_append](https://caddyserver.com/docs/caddyfile/directives/log_append), [clasificación mediante map](https://caddyserver.com/docs/caddyfile/directives/map) y [condiciones de recarga por señales](https://caddyserver.com/docs/command-line#signals). Las capacidades del candidato se comprobaron además con la imagen exacta, sin asumir que la documentación de otra versión representa el runtime instalado.

## Evidencia interna local

Única ejecución aislada: Go 1.26.1, Linux amd64, GOMAXPROCS 12, urbano v2 300 nodos/383 aristas, ronda 3/semilla 20261028, 200 sobrevivientes iniciales, HTTP estable con un trabajador y simulador con los 32 trabajadores del escenario original. Esta concurrencia dinámica difiere de los 16 de producción y la comparación principal de EC2 debe utilizar el override explícito indicado arriba. No se repitieron los experimentos geográficos. Evidencia privada: `deploy/evidence-private/phase3b1-20261026/latency/internal-local-c1.json`.

| Medición local | Muestras | p50 ms | p95 ms | p99 ms |
| --- | ---: | ---: | ---: | ---: |
| Snapshot directo | 1000 | 0,092 | 0,536 | 0,689 |
| `NextStep` directo | 1000 | 0,153 | 0,280 | 0,322 |
| Snapshot dentro del handler | 1000 | 0,111 | 0,607 | 0,867 |
| `NextStep` dentro del handler | 1000 | 0,295 | 0,446 | 0,603 |
| Handler Go | 1000 | 0,473 | 1,173 | 1,445 |
| HTTP loopback, concurrencia 1 | 1000 | 0,852 | 1,619 | 1,942 |
| Planificación dinámica | 151 | 19,111 | 49,331 | 69,245 |
| Publicación dinámica | 302 | 1,075 | 1,623 | 2,244 |
| Turno dinámico | 150 | 32,812 | 95,948 | 134,472 |

La corrida dinámica mantuvo 6113 solicitudes internas correctas, cero inválidas y cero timeouts. No son cifras de EC2 ni de la API pública. Las diferencias de concurrencia, CPU y actividad de la máquina impiden atribuir variaciones respecto a informes locales anteriores a un cambio del algoritmo; el algoritmo no se modificó.

## Ecuador: conexiones nuevas y persistentes

El lote real `external-before-paso.json`, ejecutado desde Ecuador contra la API pública, terminó correctamente: mismo binario con ALPN corregido, HTTP/1.1, un trabajador, descanso de 100 ms entre operaciones y snapshot final estable al turno 150 en ambos modos. Hubo **100 decisiones y 100 GET de snapshot por modo**, además del setup separado. No hubo 409, errores ni timeouts en este lote. Éxito por intento y por operación: 100% dentro de esta muestra.

| Ecuador, `POST /paso` | Muestras | p50 ms | p95 ms | p99 ms | Máximo ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| TCP/TLS nuevos | 100 | 361,494 | 371,411 | 386,220 | 390,243 |
| TCP/TLS reutilizados | 100 | 112,529 | 117,324 | 121,243 | 123,293 |
| Operación GET snapshot + POST, conexiones nuevas | 100 | 726,113 | 742,895 | 754,634 | 1087,585 |
| Operación GET snapshot + POST, reutilización | 100 | 230,632 | 239,508 | 242,429 | 246,279 |

En los POST con conexión nueva se observaron DNS p50 4,940 ms, TCP p50 113,469 ms, TLS p50 126,312 ms y TTFB p50 361,263 ms. Las 100 decisiones persistentes reutilizaron conexión; DNS/TCP/TLS no se repitieron y quedan en `null`, con TTFB p50 112,417 ms. Es evidencia de que el establecimiento TCP/TLS y el trayecto de red dominan esta comparación del cliente. No se obtiene un presupuesto exacto sumando sus percentiles.

La mediana del POST cae aproximadamente 69% al reutilizar conexión **en este cliente de diagnóstico**, con el backend idéntico. No es una optimización recién desplegada de Go ni del navegador: los navegadores ya reutilizan conexiones y pueden usar HTTP/2. La medición anterior de 30 muestras con otro cliente queda como antecedente, no como el grupo de control de esta comparación.

El tiempo de una operación completa puede superar 500 ms aunque cada POST cumpla ese objetivo, porque incluye otra petición GET y su transporte. El máximo de operación 1087,585 ms no se reclasifica como timeout Go. Las capas de EC2 y Caddy se presentan con sus propios recibos; no se reemplazan por cifras de esta estación.

## EC2: loopback frente a HTTPS público

El recibo real `near-before.result.json` terminó `Success`: mismo binario y mundo final 150, un trabajador, 100 ms entre operaciones, **200 POST por modalidad**. Estas cuatro series tuvieron 800 decisiones correctas, sin 409, errores ni timeouts; cada decisión obtuvo antes su snapshot. El cliente HTTPS está en la misma EC2 y consume el dominio público con TLS verificado; no representa el trayecto desde Ecuador.

| Cliente en EC2, `POST /paso` | Muestras | p50 ms | p95 ms | p99 ms | Máximo ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| Loopback Go, TCP nuevo | 200 | 1,040 | 1,564 | 2,100 | 2,632 |
| Loopback Go, TCP reutilizado | 200 | 0,702 | 1,831 | 9,660 | 13,851 |
| HTTPS público, TCP/TLS nuevos | 200 | 8,778 | 12,590 | 15,597 | 21,313 |
| HTTPS público, reutilización | 200 | 1,241 | 2,383 | 8,847 | 16,750 |

El establecimiento TLS medido cerca de EC2 tuvo p50 6,330 ms, frente a 126,312 ms desde Ecuador; TCP tuvo p50 0,330 ms frente a 113,469 ms. La diferencia entre ubicaciones respalda el efecto del trayecto de red. Las colas altas del lote loopback reutilizado también recuerdan que un p99 puntual depende de planificación/GC y ruido de la máquina; no implica que todas las solicitudes reutilizadas sean más lentas que las nuevas.

## Go interno: proceso aislado en la EC2 real

`internal-aws.result.json` terminó `Success` con binario y datos verificados, GOMAXPROCS 2, concurrencia del simulador 16, misma ronda 3/semilla 20261028 y una sola ejecución de 150 turnos. El benchmark estable se hizo **después**: turno 150, world version 301, 200 DTOs de sobrevivientes de los cuales 27 seguían activos. Sólo esos 27 recibieron solicitudes `/paso` del benchmark. El proceso de producción conservó turno 150 y sus contadores internos sin cambios.

| Proceso aislado en EC2, snapshot final | Muestras | p50 ms | p95 ms | p99 ms |
| --- | ---: | ---: | ---: | ---: |
| Snapshot directo | 1000 | 0,046 | 0,388 | 0,593 |
| `NextStep` directo | 1000 | 0,077 | 0,078 | 0,093 |
| Snapshot dentro del handler | 1000 | 0,065 | 0,387 | 0,556 |
| `NextStep` dentro del handler | 1000 | 0,084 | 0,108 | 0,221 |
| Handler Go | 1000 | 0,185 | 0,549 | 0,806 |
| HTTP loopback del proceso aislado, concurrencia 1 | 1000 | 0,308 | 0,930 | 1,274 |

No hubo errores entre las 1000 solicitudes estables. La corrida dinámica aislada mantuvo 6113 decisiones internas correctas, cero inválidas y cero timeouts:

| Fase dinámica aislada en EC2 | Muestras | p50 ms | p95 ms | p99 ms |
| --- | ---: | ---: | ---: | ---: |
| Planificación | 151 | 7,922 | 23,598 | 32,145 |
| Publicación | 302 | 0,560 | 1,168 | 3,561 |
| Turno | 150 | 20,426 | 66,311 | 97,099 |
| Handler Go durante la corrida | 6113 | 0,267 | 1,355 | 3,281 |
| HTTP loopback del simulador, concurrencia 16 | 6113 | 4,159 | 8,397 | 10,109 |

La planificación sucede antes de publicar el estado consultado por HTTP. Sus tiempos no se añaden a cada POST como si el algoritmo se ejecutara completo de nuevo. Esta medición interna pertenece al proceso auxiliar en la EC2; la tabla cercana anterior corresponde al backend productivo y su listener real. Comparten escenario/configuración final, pero tienen procesos, límites de memoria y condiciones de ejecución que deben mantenerse identificados.

## Instrumentación temporal de Caddy en producción

El recibo `caddy-enable.result.json` confirma la aplicación del candidato por SIGUSR1 con ocho comprobaciones correctas: validación, PID idéntico, `StartedAt` idéntico, contador de reinicios idéntico, mismo inodo del bind mount, confirmación de recarga, monitor de salud íntegramente 200 y mundo Go sin reiniciar. `admin off` se mantuvo.

La activación se hizo entre lotes y sus peticiones de salud no se incorporan a la serie anterior. La instrumentación temporal no significa un cambio de imagen ni un despliegue nuevo de Go. La comparación posterior debe conservar el mismo binario, protocolo, ubicación, pacing y snapshot final, y retirar el candidato tras recoger sus datos mediante la misma recarga controlada.

## Comparación equivalente con logging temporal

`external-after-paso.json` y `near-after.result.json` completaron las mismas cantidades, binario, HTTP/1.1, un trabajador, pacing de 100 ms y mundo final 150. La diferencia de configuración fue el logging temporal de Caddy; los lotes fueron secuenciales y la red no es una variable controlada. Todos los POST respondieron 200, sin 409, errores de transporte ni timeouts.

| `POST /paso`, después de activar logging | Muestras | p50 ms | p95 ms | p99 ms | Máximo ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| Ecuador, TCP/TLS nuevos | 100 | 361,387 | 367,755 | 370,966 | 375,273 |
| Ecuador, reutilización | 100 | 114,783 | 205,059 | 206,146 | **606,390** |
| EC2 loopback Go, TCP nuevo | 200 | 1,032 | 1,925 | 2,245 | 3,049 |
| EC2 loopback Go, reutilización | 200 | 0,706 | 1,344 | 1,628 | 1,752 |
| EC2 HTTPS público, TCP/TLS nuevos | 200 | 8,944 | 12,531 | 23,473 | 43,134 |
| EC2 HTTPS público, reutilización | 200 | 1,309 | 2,088 | 2,652 | 3,518 |

El lote externo reutilizado conserva un outlier real de **606,390 ms** y otras 30 solicitudes entre 150 y 250 ms. **31/100 superaron 150 ms y 1/100 superó 500 ms**. Esta muestra no cumple p95 ≤150 ms ni máximo <500 ms. Su éxito HTTP de 100% no equivale al cumplimiento del objetivo temporal; no se repitió para seleccionar una cola más favorable.

El intento de 606,390 ms reutilizó una conexión existente, sin DNS, intento TCP ni nuevo handshake TLS. Su TTFB fue 606,284 ms y la recepción posterior del cuerpo fue breve. Eso localiza la espera antes del primer byte observado por el cliente; por sí solo no distingue tránsito de ida/vuelta, planificación del cliente o servidor. No se atribuye a pérdida de paquetes, RTT específico o a Go sin evidencia adicional.

Las medianas cercanas de HTTPS persistente fueron 1,241 ms antes y 1,309 ms después; sus p95 fueron 2,383 y 2,088 ms. Esta pequeña diferencia entre lotes no permite estimar un costo causal exacto del logging ni declarar una mejora. La cola externa aumentó mientras el lote cercano se mantuvo en pocos milisegundos; se contrasta además con los tiempos reales del proxy, conservando las limitaciones de correlación de las series.

## Tiempos reales de Caddy y estado final

`caddy-aggregate.result.json` finalizó `Success`. La ventana temporal contiene **600 POST `/paso` con estado 200**: mezcla las conexiones nuevas/persistentes del cliente cercano y de Ecuador. No representa una serie exclusiva de una ubicación o modalidad.

| Dentro de Caddy, POST 200 | Muestras | p50 ms | p95 ms | p99 ms | Máximo ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| Duración de solicitud Caddy | 600 | 0,872 | 1,729 | 2,980 | 11,063 |
| Intercambio con upstream | 600 | 0,775 | 1,618 | 2,702 | 10,642 |
| Diferencia calculada por solicitud | 600 | 0,093 | 0,133 | 0,243 | 1,025 |

La última fila se obtiene restando **dentro de cada registro**, antes de calcular percentiles; no se restan p95 entre series. Incluye trabajos normales del proxy y escritura hacia el cliente; no mide aisladamente CPU ni overhead de logging.

Ningún POST de esa ventana superó 11,064 ms dentro del tramo temporizado por Caddy, mientras el cliente externo registró un TTFB de 606,284 ms. Esto acota la cola externa a tiempo fuera de ese tramo: no hay evidencia de una decisión Go o de un procesamiento interno Caddy de 606 ms. No identifica por sí solo el mecanismo de red o planificación del cliente y no justifica cambiar región, instancia ni algoritmo.

Se inspeccionaron **1237 registros / 305218 bytes**: 30 `/healthz`, 4 `/grafo`, 600 `/estado`, 600 `/paso`, 2 `other` y **una redirección automática 308 sin clasificación**. El primer agregador se detuvo por exigir `route` en ese 308; se conservó el fallo, se verificaron por separado los invariantes de privacidad y se contó el registro como no clasificado. No se relajó el control de secretos: cero campos `request`, `resp_headers` o `user_id`, y la clave API real ausente en todos los bytes.

La configuración original se restauró mediante SIGUSR1 al cerrar la ventana. El recibo `caddy-restore.result.json` conserva ocho controles correctos, **26/26 health 200**, PID/inodo/`StartedAt` iguales, cero reinicios de Caddy y mundo Go en turno 150 sin reiniciar. Su primera salida global fue fallida por el agregador, mientras la restauración ejecutada en `finally` terminó correctamente; el recibo posterior de agregación resolvió exclusivamente la lectura/análisis del archivo.

El estado final mantiene el logging temporal de acceso **desactivado**, la imagen Go y la infraestructura originales y los logs de backend existentes en CloudWatch. Quedan disponibles el candidato opt-in, el archivo privado sanitizado y los recibos para reproducir el diagnóstico. No se introdujeron agentes, nuevas políticas IAM, recursos o exportación OTel.

Los once archivos completos de EC2 —1,56 MB— se recuperaron mediante la sesión SSM autorizada, sin ampliar IAM, en `deploy/evidence-private/phase3b1-20261026/remote/`: lotes `near-before/after-loopback/https.json`, `internal-aws-final-c1.json`, `caddy-duration-summary.json`, `caddy-access-sanitized.jsonl` y recibos de activación/restauración/metadatos. Se verificó la ausencia de la clave real antes de exportarlos. Permanecen fuera de Git; los agregados de este documento omiten credenciales, identificadores privados y detalles del host.

## CloudWatch existente

El coordinador verificó la siguiente consulta sobre el grupo del backend; utiliza el intervalo real de la ejecución y devuelve sus resúmenes JSON existentes:

```text
fields @timestamp, msg, metrics.requests_success, metrics.requests_invalid,
       metrics.requests_timeout, metrics.http_p50_ms, metrics.http_p95_ms,
       metrics.http_p99_ms
| filter msg = "simulation finished; final snapshot remains available"
| sort @timestamp desc
| limit 10
```

El resultado consultado fue de dos resúmenes, 1237 bytes examinados. Estas métricas proceden del mismo cliente loopback del simulador: CloudWatch las conserva, sin convertirlas en otra medición independiente de latencia Go. Los logs HTTP por solicitud estaban en nivel DEBUG y no se activaron globalmente; no se afirma que el grupo ya contenga contadores HTTP o histogramas OTel inexistentes.

Los logs sanitizados de Caddy permanecen en archivo privado durante el diagnóstico. No se presentan consultas Logs Insights para ese archivo como si estuviera ingerido en CloudWatch. CPU y créditos de EC2 se consultan por las métricas existentes; la memoria observada procede de inspección autorizada del host/contenedores, sin instalar un agente.
