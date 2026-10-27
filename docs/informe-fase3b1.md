# Informe FASE 3B.1 — clientes Go, latencia AWS y Git

26 de octubre de 2026, hora de Ecuador. Frontend verificado: [sistemamanta.lexinnovate.com/escape](https://sistemamanta.lexinnovate.com/escape). API: [api.sistemamanta.lexinnovate.com/healthz](https://api.sistemamanta.lexinnovate.com/healthz). [Resumen de evidencias](../deploy/validation-phase3b1.json) y [método detallado](latencia-aws-fase3b1.md).

**Resultado:** React y Flutter utilizan exclusivamente el servidor Go existente. La corrección web está publicada y comprobada en AWS; el APK debug actualizado está compilado. La latencia externa está dominada por transporte y establecimiento TCP/TLS desde Ecuador hacia Ohio, frente a tiempos inferiores a unos pocos milisegundos en Go/Caddy. No se modificaron algoritmos, contrato, región, tamaño EC2 o infraestructura. No se inició FASE 3B.2.

## 1. Error de conexión y retirada del servidor anterior

La versión publicada intentaba cargar Elementos mediante `http://localhost:3001/v1/demo/items` y comprobar `/health` del mismo servidor. En el equipo visitante no existía ese servicio: Chromium observó ERR_CONNECTION_REFUSED. `/escape` sí consumía el origen HTTPS Go correctamente. No era evidencia de un fallo CORS, DNS o certificado del servidor Go.

La instrucción posterior del propietario sustituyó la propuesta inicial de conservar demos locales: **ambos clientes debían usar sólo Go**. Se retiraron pantallas de elementos/formulario/resumen/diagnóstico del starter, adaptadores, proveedores, modos de ejecución, URLs y fallbacks asociados. Las rutas anteriores y la raíz llevan a `/escape`. Se conservaron mapa, colores, controles y búsqueda de sobrevivientes.

React utiliza sólo `VITE_WORLD_API_BASE_URL`; Flutter, `WORLD_API_BASE_URL`. Ambos apuntan por defecto a `https://api.sistemamanta.lexinnovate.com` y observan `/healthz`, `/grafo` y `/estado`. Ninguno envía `/paso` o recibe su API key. Cuando Go falla, aparece un error real y se permite reintentar. En web Escape posee el único temporizador de polling; el shell observa la misma caché.

La marca compartida pasó a Escape de Manta Zombie mediante su fuente y regeneración. Dart genera únicamente los modelos alcanzables desde las operaciones Go; el OpenAPI compartido permanece intacto. Los dobles HTTP usados en pruebas no forman parte del runtime. El servicio histórico conservado en el repositorio no es una dependencia de los clientes.

## 2. Mediciones y condiciones

Las cifras siguientes son **milisegundos**, con percentiles nearest-rank. Cada fuente tiene un límite de medición distinto: no se restan sus percentiles para obtener componentes.

| Fuente | p50 | p95 | p99 | Muestras | Condición |
| --- | ---: | ---: | ---: | ---: | --- |
| Go interno: manejador `/paso` | 0,185 | 0,549 | 0,806 | 1.000 | Observer existente, proceso aislado en la misma EC2, snapshot final 150 |
| Caddy: duración `/paso` | 0,872 | 1,729 | 2,980 | 600 | Proxy productivo; mezcla de conexiones nuevas/reutilizadas y clientes EC2/Ecuador |
| HTTPS cercano a AWS | 1,241 | 2,383 | 8,847 | 200 | EC2 hacia nombre público HTTPS, conexión reutilizada, antes |
| HTTPS desde Ecuador | 112,529 | 117,324 | 121,243 | 100 | Equipo del propietario, conexión reutilizada, antes |

El proceso interno usó Go 1.26.1, GOMAXPROCS=2, round3 y manta-v2 existentes, concurrencia de simulación 16. Ejecutó una única ronda aislada hasta 150, alcanzando el mismo estado final: 200 sobrevivientes totales y 27 activos. Después midió 1.000 solicitudes con un worker. **No reinició ni alteró el proceso productivo.** La ronda acelerada aislada permite perfilar componentes, pero no representa el ritmo productivo de 2 s ni se suma a los lotes de transporte.

En el snapshot estable, adquisición/clonado observado: p95 **0,387 ms**; `NextStep` observado: **0,108 ms**. Durante los 150 turnos aislados, planificación p95 **23,598 ms**, publicación **1,168 ms** y turno **66,311 ms**. Hubo 6.113 decisiones internas correctas, 0 inválidas y 0 timeouts. La planificación ocurre antes de publicar; `/paso` lee el plan coherente. El tiempo de NextStep incluye preparación de clave/caché y selección, no solamente acceso a un mapa.

El probe de transporte utilizó el mismo binario antes/después, HTTP/1.1 en ambos modos, un worker, 100 ms entre operaciones, timeout 10 s y umbral de observación 500 ms. Se midieron 100 operaciones por modo en Ecuador y 200 por modo desde EC2. El estado productivo se mantuvo en 150; no hubo 409 en estos lotes estables. Se conservaron los 2.000 POST medidos, todos 200 y sin errores de transporte/timeouts. Los GET de snapshot y el setup se registran separados.

## 3. Comparación antes/después y diagnóstico

«Antes» tenía access logs desactivados. «Después» utilizó registros Caddy sanitizados temporales; el código Go y las condiciones del snapshot permanecieron iguales. Son ventanas sucesivas: la variación de red impide atribuir toda diferencia al logging.

| Cliente / conexiones | p50 antes→después | p95 antes→después | p99 antes→después | Máximo antes→después | POST por lote |
| --- | ---: | ---: | ---: | ---: | ---: |
| Ecuador / nuevas | 361,494→361,387 | 371,411→367,755 | 386,220→370,966 | 390,243→375,273 | 100 |
| Ecuador / reutilizadas | 112,529→114,783 | 117,324→205,059 | 121,243→206,146 | 123,293→606,390 | 100 |
| EC2 / HTTPS nuevas | 8,778→8,944 | 12,590→12,531 | 15,597→23,473 | 21,313→43,134 | 200 |
| EC2 / HTTPS reutilizadas | 1,241→1,309 | 2,383→2,088 | 8,847→2,652 | 16,750→3,518 | 200 |
| EC2 / loopback HTTP nuevas | 1,040→1,032 | 1,564→1,925 | 2,100→2,245 | 2,632→3,049 | 200 |
| EC2 / loopback HTTP reutilizadas | 0,702→0,706 | 1,831→1,344 | 9,660→1,628 | 13,851→1,752 | 200 |

En Ecuador/nuevas/antes, medianas observadas: DNS **4,940 ms**, TCP **113,469 ms**, TLS **126,312 ms**, TTFB **361,263 ms**. TTFB es acumulado desde el inicio; no debe sumarse nuevamente a DNS/TCP/TLS. La duración TCP aproxima el costo de establecimiento de ida y vuelta; no se realizó una medición ICMP independiente. TLS incluye red y criptografía. En reutilización no hubo eventos nuevos DNS/TCP/TLS; se representan como ausentes, no como mediciones de cero.

Evitar handshakes repetidos redujo aproximadamente 69% la mediana del **cliente de diagnóstico**. El navegador ya reutilizaba conexiones: la comprobación pública final observó HTTP/2 con una conexión API y ocho respuestas reutilizadas. No se presenta ese cambio de metodología como una aceleración nueva de Go o del navegador.

La cola posterior se conserva: **31/100 POST reutilizados superaron 150 ms y 1/100 superó 500 ms**. El máximo 606,390 ms no fue timeout: respondió 200 y su TTFB fue 606,284 ms, sobre una conexión ya reutilizada. En toda la ventana, Caddy no registró ningún `/paso` por encima de 11,064 ms. Esto sitúa el exceso fuera del tramo temporizado por Caddy; no demuestra por sí solo pérdida de paquetes, mecanismo TCP o causa concreta del ISP. **No se garantiza p95≤150 ms ni máximo≤500 ms externos.**

Una operación lógica incluye GET `/estado` y POST `/paso`, además de reintentos. Antes, sus medianas externas fueron 726,113 ms/nueva y 230,632 ms/reutilizada. Después, 724,327 ms y 234,643 ms; el máximo lógico posterior reutilizado fue 1.213,862 ms. No confundir estos totales con la latencia de una solicitud individual.

La calibración inicial del nuevo instrumento negoció HTTP/2 mientras intentaba leer HTTP/1.1. Falló antes de medir `/paso`; se conservó como prueba inválida del instrumento. Se corrigió ALPN y se validó con un servidor TLS con HTTP/2 habilitado y una consulta HTTPS pública real antes de recoger los lotes comparados. No se seleccionaron repeticiones para ocultar la cola posterior.

## 4. HTTP 409

La API rechaza con 409 un snapshot que ya no coincide en turno, posición o estado activo. Entre GET `/estado` y POST `/paso` puede avanzar la simulación. Los 11 conflictos históricos de FASE 3A equivalen a 30 éxitos/41 intentos (**73,17% de éxito por intento**), aunque las 30 operaciones lógicas acabaron con respuesta válida tras releer el estado. No se guardó la causa individual de cada conflicto y no se atribuyen todos exclusivamente al turno.

La reproducción controlada actual, fuera del benchmark, devolvió **200→409→200** al enviar snapshot vigente, turno anterior y snapshot vigente. El estado productivo siguió en 150 y el request ID coincidió con el sobre de error. Las herramientas informan todos los status, intentos, operaciones y reintentos; sólo reintentan 409 de forma acotada. No se cambió el contrato ni se reinició una ronda para provocar conflictos. Que un snapshot final tenga 0 conflictos no predice la tasa de una ronda activa.

## 5. Observabilidad y overhead

No se añadió OTel: los hooks Observe y diagnósticos existentes midieron snapshot, NextStep, planificación y turno; httptrace separó transporte; Caddy expuso duración y upstream. Esos datos resolvieron el diagnóstico sin dependencias de producción, exportador, agente, nuevas métricas facturables o permisos IAM. No se implementaron trazas masivas ni una plataforma nueva.

El candidato Caddy sanitiza **también el logger global**, eliminando request, resp_headers y user_id. Nunca conserva cabeceras, cookies, query, cuerpo o identidad; la ruta sólo puede ser una de cuatro etiquetas estáticas u other. Los 20 controles locales incluyeron canarios en cabeceras/query/path, respuesta 200 y error 502 real. En producción se comprobaron 1.237 registros/305.218 bytes: la clave real no aparece y los tres campos eliminados están ausentes. Un redirect automático 308 sin clasificación de ruta se contabilizó por separado; los 600 POST 200 forman la muestra de `/paso`.

Caddy upstream: p95 **1,618 ms**; residual por solicitud entre duración total y upstream: p95 **0,133 ms**. Ese residual incluye trabajo normal de proxy y **no mide CPU ni costo puro del logging**. El cambio observado de mediana HTTPS cercana reutilizada fue +0,068 ms y su p95 bajó 0,295 ms; es una estimación ruidosa, insuficiente para atribuir causalmente overhead. Cada registro ocupó aproximadamente 247 bytes en esta ventana.

Los logs temporales usaron el volumen privado existente, modo 0600, rotación 5 MiB y tres copias/24 h mientras estuvo habilitado. Se exportaron evidencias por Session Manager sin añadir PutObject al rol EC2. El Caddyfile original quedó restaurado con SIGUSR1: mismo PID/StartedAt, sin reinicios, 30/30 GET de salud correctos al habilitar y 26/26 al restaurar. Las conexiones ociosas pueden retirarse durante una recarga; no se efectuó un lote POST durante ella. El backend Go mantuvo su StartedAt y turno 150. Tras verificar la exportación privada por SHA-256, se retiró el archivo temporal de access logs del volumen; los certificados no se tocaron.

CloudWatch conserva logs JSON de arranque y resúmenes finales de la simulación. Las métricas estándar EC2 disponibles incluyen CPU, créditos y red; CPU se consultó en promedios de 5 min, no como máximos instantáneos. El último promedio CPU fue 0,575%; el mayor promedio de cinco minutos en la ventana, 2,496%, con saldo de créditos 36,953. No hay serie CloudWatch de memoria ni latencia independiente Go/Caddy. La lectura puntual del host mostró unos 1,48 GB disponibles, Go 7,8 MiB y Caddy 12,3 MiB; no representa una serie temporal.

Consultas Logs Insights ejecutadas contra `/corodev/corodev-phase2/backend`:

```text
fields @timestamp, msg, metrics.requests_success, metrics.requests_invalid,
       metrics.requests_timeout, metrics.http_p50_ms, metrics.http_p95_ms,
       metrics.http_p99_ms
| filter msg = "simulation finished; final snapshot remains available"
| sort @timestamp desc
| limit 10
```

```text
fields @timestamp, level, msg
| stats count(*) as events by level, msg
```

La primera devolvió dos resúmenes reales, cada uno con 6.113 éxitos/0 inválidas/0 timeouts; son métricas internas por ronda, no conteos de todas las solicitudes públicas. No deben sumarse como si fueran un contador único. La segunda, acotada desde el inicio del despliegue, devolvió dos eventos backend ready y dos simulation finished, todos INFO. Una consulta previa de la última hora quedó vacía porque esos eventos eran anteriores; se conserva esa respuesta. La segunda comprueba los eventos emitidos; la ausencia de ERROR no demuestra ausencia de errores HTTP si no se registra cada petición. [Sintaxis oficial de stats](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_QuerySyntax-Stats.html). Caddy se midió localmente durante el diagnóstico; no se exportó su histograma a CloudWatch.

## 6. Validación y publicación

- Go: tests, race, vet y build correctos; ocho casos del probe cubren TLS/ALPN, conexión persistente, vecinos/bloqueos, setup, 409, validación y secretos.
- Caddy: validación con imagen fijada 2.11.7 y 20 controles de sanitización/recarga correctos. [Recarga mediante señales](https://caddyserver.com/docs/command-line#signals).
- React: 18 pruebas, TypeScript/ESLint y generación consistente; 8 pruebas Chromium escritorio/móvil; build productivo correcto tras el último cambio de CSS.
- Flutter: analyze sin incidencias, 13 pruebas y una integración condicionada omitida en la suite normal; la integración Dart con Go real se ejecutó aparte y pasó. APK debug construido, sin prueba física ni iOS.
- Integración Go real local: contrato y auth/errores 400/401/409, Chromium y Dart correctos. Estas verificaciones locales no se usan como latencias AWS.
- Publicación web: S3 privado/CloudFront existentes, nuevos assets con hash e index no-cache. Versiones anteriores conservadas para rollback; invalidación completada.
- Navegador público final, 19:42:39–19:42:45 de Ecuador: HTML/assets coinciden con el build, rutas retiradas llevan a Escape, menú sólo Escape, grafo 300/383, turno 150/versión 301 y contadores 132/41/27 coinciden con Go. Zoom/búsqueda/coordenadas y 390 px sin desbordamiento correctos. Cero errores JavaScript/consola/red, credenciales, solicitudes localhost o rutas antiguas. DNS normal y TLS verificado, sin respuestas simuladas.

No se repitieron las 63 ejecuciones geográficas. El mundo público final no debía avanzar: se conservó la ronda ya terminada para mantener disponibilidad y condiciones comparables.

## 7. Git, seguridad y riesgos

El remoto aprobado `main` apunta a [corozodev/simluacion-desastres-manta](https://github.com/corozodev/simluacion-desastres-manta). Se conservaron los seis commits previos, autores y fechas auténticas. Estos cambios ya se publicaron y el HEAD remoto se comprobó contra el local:

| Commit | Contenido |
| --- | --- |
| `5664214` | Medición de transporte HTTPS y tiempos internos Go, con pruebas |
| `8ec49fa` | Candidato Caddy con registros sanitizados y verificación |
| `f50637f` | React/Flutter sólo Go, generación y pruebas de integración |

El informe y resumen acompañan un commit documental final en la misma rama. El conector no importa el historial local completo; se utilizó Git nativo con la autenticación SSH existente y sustitución de transporte sólo para el comando. El remoto HTTPS almacenado no cambió. No hubo force push, reescritura, nuevas claves o fechas artificiales.

Se revisaron 319 blobs históricos y cada grupo preparado antes de publicar, buscando patrones de credenciales, la clave real, cuenta/contacto privados y archivos sensibles. Sin hallazgos confirmados. Parámetros privados, evidencia completa, bundles, APK y builds permanecen excluidos; no se incluyeron snapshots de diagnóstico con posiciones ocultas.

Para la competición quedan límites concretos:

1. La ronda acaba a los 150 turnos y conserva el snapshot final; otra sesión necesita un inicio coordinado. Reiniciar pierde la RAM.
2. La red externa conserva colas superiores a 500 ms; HTTP correcto no equivale al objetivo temporal. No se aumentó EC2 ni se movió de región para ocultarlo.
3. El APK es debug y no se validó un dispositivo físico. Los 300 nodos siguen siendo una muestra urbana, sin cambios geográficos.
4. El operador mantiene AdministratorAccess por decisión anterior del propietario; el rol EC2 continúa restringido.
5. Budget 30 USD y estimación 22,96 USD/mes sin cambios. AWS sigue informando 0 USD con actualización anterior al despliegue; no demuestra consumo gratuito. Entrega de alertas y captura auténtica de consola siguen sin confirmar. No se crearon recursos de infraestructura nuevos.

Evidencia completa: `deploy/evidence-private/phase3b1-20261026/`, excluida de Git. El resumen público omite secretos, cuenta, destinatarios y salidas completas SSM. No se inicia FASE 3B.2 automáticamente.
