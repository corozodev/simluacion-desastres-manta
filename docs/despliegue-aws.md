# Despliegue AWS — FASE 3A.2

Este documento conserva el despliegue histórico del 26 de octubre. El estado posterior está en [FASE 5 en AWS y retirada programada](despliegue-fase5-y-caducidad.md): `m7i-flex.large`, plan FREE, Budget 50 USD y autokill a partir del 31 de octubre de 2026, 01:46 de Ecuador.

**Actualización FASE 3B.1:** React y Flutter consumen únicamente Go; se retiraron las pantallas y adaptadores del servicio anterior. El frontend actualizado está publicado y el APK debug construido. La infraestructura y el backend productivo permanecen iguales; el diagnóstico Caddy temporal terminó con su configuración original restaurada. [Estado y pruebas actuales](informe-fase3b1.md). El resto conserva la entrega y evidencias de FASE 3A.2.

El propietario autorizó expresamente `phase3a2-20261026T211726Z`. Se ejecutó exclusivamente ese change set y el stack `corodev-phase2` alcanzó **CREATE_COMPLETE el 26 de octubre de 2026 a las 18:04:43 de Ecuador**. Los 14 recursos terminaron correctamente. Se reutilizaron la imagen, el bundle y el build React previamente validados, sin reconstruir infraestructura, repetir pruebas locales o modificar motores, grafos, simulador o contratos.

Frontend: **[sistemamanta.lexinnovate.com/escape](https://sistemamanta.lexinnovate.com/escape)**. API: **[api.sistemamanta.lexinnovate.com/healthz](https://api.sistemamanta.lexinnovate.com/healthz)**. [Evidencia del despliegue](../deploy/validation-phase3a2-deployment.json), [probe público](../deploy/validation-phase3a-public.json) y [costos](costos.md).

## Aprobación e integridad

La autorización está vinculada al ARN completo conservado en evidencia privada. Antes de ejecutar se comprobaron identidad IAM no root, cuenta/región autorizadas, permisos efectivos y eventos CREATE_CHANGESET SUCCEEDED sin VALIDATION_ERROR.

| Control aprobado | Resultado |
| --- | --- |
| Change set / stack | `phase3a2-20261026T211726Z` / `corodev-phase2`, us-east-2 |
| Cambios | 14 Add; cero Modify, Remove o reemplazos |
| SHA-256 plantilla | `be8bbda4995169bfe75342ddeb3746ebcb1e05c83e4064ce3579cd9967eadbf5` |
| SHA-256 parámetros privados | `bd72f438eb145b5881966c7bba29ca2661043d24ef2d1b389f4d3f54d3536315` |
| Estimación conservada | 22,96 USD/mes; reserva 24 USD; Budget existente 30 USD |
| Resultado | CREATE_COMPLETE; distribución Deployed |

No se creó otro change set ni se cambiaron plantilla o parámetros. IAM y CloudFront/OAC/función son globales; ACM frontend está en us-east-1. EC2, EBS, EIP, S3 y CloudWatch están en Ohio. No se crearon VPC, NAT Gateway, balanceador o zona DNS.

## Recursos y seguridad comprobados

| Recursos creados | Configuración verificada en AWS |
| --- | --- |
| `Backend` | EC2 t3.small, Amazon Linux 2023 x86_64; sistema/instancia OK; Docker linux/amd64 |
| `BackendAddress` | IPv4 estable `77.112.199.249` |
| `BackendSecurityGroup` | Entrada pública sólo TCP 80/443; egreso TCP 80/443; sin SSH 22 ni Go 8080 públicos |
| `BackendRole` / `BackendProfile` | Confianza EC2, AmazonSSMManagedInstanceCore, logs del grupo concreto y GetObject sólo en releases/* del bucket de artefactos |
| `BackendLogs` / `CPUAlarm` | Logs siete días; alarma CPU 80%, sin acciones SNS |
| `ArtifactBucket` / `ArtifactBucketPolicy` | Privado, AES256, TLS obligatorio, releases con expiración siete días |
| `WebBucket` / `WebBucketPolicy` | Privado, AES256, versionado, TLS obligatorio, lectura OAC restringida a la distribución |
| `WebOriginAccess` / `SPARoutes` / `WebDistribution` | OAC SigV4 always, rutas SPA, alias exacto y TLS mínimo 1.2 |

Son 14 recursos; el disco raíz gp3 cifrado de 20 GB forma parte de Backend. IMDSv2 es obligatorio con hop limit 1; créditos T3 en standard. La inspección real de infraestructura pasó 30 controles y no encontró eventos de creación fallidos. Un GET anónimo directo a index.html en S3 devolvió 403.

El propietario eligió y asoció **AdministratorAccess al operador deploy-cli** para desarrollo. Esa decisión concede administración amplia y sustituye la alternativa acotada de la [revisión histórica](revision-seguridad-fase3a2.md); no se afirma mínimo privilegio global del operador. **La EC2 mantiene su rol mínimo y no recibe AdministratorAccess.** No se crearon claves permanentes ni se cambiaron perfiles/credenciales.

Run Command y una sesión real de Session Manager funcionaron. La sesión ejecutó `id` como ssm-user y terminó correctamente. No se utilizó SSH. El daemon SSH de la AMI escucha en el host, pero el grupo de seguridad no permite entrada 22.

## Release y secretos

Se transfirió el bundle existente `deploy/releases/corodev-release-phase3a2-20261026.tgz`, SHA-256 `1d0713cafb19a18f2699080f29089379b50d1f32c42590add90f29819305ff53`, a releases/ del bucket privado. En EC2 se verificaron el checksum exterior y todos los archivos internos antes de cargar Docker. La imagen desplegada conserva ID `sha256:ee09a3b6a38c89df40d30c0042cb800e101cd79ff062c992ee885cd5635fa105`, linux/amd64.

`/etc/corodev/backend.env` tiene modo 0600. La API_KEY se generó en EC2 y no apareció en solicitudes o salidas SSM. Para el probe externo autorizado se cifró en EC2 con RSA-OAEP-SHA256 y una clave pública transitoria; sólo el ciphertext salió por SSM. El cliente local privado tiene modo 0600 y la clave RSA privada transitoria se eliminó. La API key nunca se pasa como argumento de comando ni se incorpora a React o Flutter.

Se ejecutaron los scripts existentes `deploy/start-backend.sh` y `deploy/start-tls.sh`. Go usa usuario no root, rootfs readonly, cap-drop ALL, no-new-privileges, límites de memoria/CPU/procesos, tmpfs y restart unless-stopped. El puerto 8080 está publicado exclusivamente en 127.0.0.1 y la red Docker. La inspección del contenedor confirmó estas opciones y awslogs.

El runtime utiliza manta-v2 y el escenario urbano round3 existente: 200 sobrevivientes, 150 turnos, intervalo 2 s, concurrencia 16. CORS permite `https://sistemamanta.lexinnovate.com`. Caddy conserva su imagen fijada por digest, API administrativa apagada, volúmenes de certificados y logs locales con rotación. No hay logs de acceso con cuerpos/credenciales.

La simulación termina tras 150 turnos y el servidor conserva el snapshot final. **El mapa puede quedar inmóvil al terminar; health 200 no implica que siga avanzando.** Reiniciar el contenedor Go reinicia el escenario desde su semilla y pierde la RAM. No se añadió reproducción automática ni persistencia.

## Frontend, DNS y HTTPS

Se publicó exclusivamente el build existente `apps/web/dist`, que contiene la URL HTTPS real de la API: assets con hash y caché inmutable, index.html no-cache. No se borraron versiones/assets. La invalidación CloudFront terminó Completed.

Cloudflare administra lexinnovate.com. El propietario creó/corrigió estos registros, ambos **DNS only, nube gris, TTL Auto**:

| Tipo | Nombre | Destino real |
| --- | --- | --- |
| CNAME | sistemamanta | d3oor59fj9nlnj.cloudfront.net |
| A | api.sistemamanta | 77.112.199.249 |

Los [registros de aplicación](../deploy/dns-application-phase3a2.json) proceden de outputs reales. Conservar el [CNAME de validación ACM](../deploy/dns-validation-phase3a2.json) para renovación. No se modificaron registros ajenos al proyecto.

CloudFront sirve un certificado Amazon válido para el nombre exacto del frontend, emitido por ACM en us-east-1 y vigente hasta el 11 de mayo de 2027. Caddy obtuvo otro certificado de Let's Encrypt para el nombre exacto de la API, vigente hasta el 24 de enero de 2027. Ambos se comprobaron con cadena y hostname válidos y TLS 1.3. API HTTP redirige 308 a HTTPS y entrega HSTS.

Tras corregir el proxy de API, los DNS autoritativos y 1.1.1.1 devolvieron la EIP. Los resolvedores del ISP de este equipo alternaron temporalmente entre la IP correcta, direcciones antiguas Cloudflare y NXDOMAIN. Se conservaron los dos intentos iniciales fallidos del probe y la corrida inicial del navegador. La medición válida consultó DNS real 1.1.1.1 y cacheó la respuesta para la corrida, manteniendo SNI y verificación TLS; no usó una IP fija inventada. Esta diferencia de resolvedor se declara en la evidencia. La propagación a todos los ISP no queda garantizada por una consulta correcta. Al cierre, a las 18:31:19 de Ecuador, el resolvedor normal de este equipo devolvió la EIP en tres consultas y tanto API como frontend respondieron 200 por HTTPS sin sustituir DNS o proxy.

## Comprobaciones externas y latencias

Se ejecutó `tools/qa/phase3a_probe.py` sin modificarlo desde el equipo del propietario, en Ecuador, **fuera de EC2**. La clave sólo estuvo en el entorno privado del proceso. Los fallos iniciales de DNS se conservan separados de la corrida completa.

| Comprobación pública | Resultado |
| --- | --- |
| GET /healthz, /grafo, /estado | 200; grafo 300 nodos/383 aristas |
| POST /paso autorizado | 200, contrato exacto y vecino transitable o espera |
| /paso sin clave / clave incorrecta | 401 / 401 |
| /admin, /reset, /config, /debug/pprof/ | 404 |
| Simulación observada por probe | Turno 59→78; 4169 solicitudes internas correctas, 0 inválidas y 0 timeouts |
| CORS origen frontend | Access-Control-Allow-Origin exacto |
| CORS otro origen | Sin permiso CORS; los GET públicos siguen siendo públicos |
| /escape y objeto S3 directo | 200 / 403 |

POST /paso: **30 muestras válidas, 41 intentos, 11 conflictos 409 de turno reintentados; 0 errores y 0 timeouts en la corrida completa**. p50 **364,43 ms**, p95 **384,72 ms**, p99/máximo **524,49 ms**. Son tiempos HTTPS externos con recepción JSON, percentiles nearest-rank sobre éxitos; no son benchmarks locales ni garantía de SLA. Los conflictos y fallos DNS iniciales deben leerse junto con los percentiles. [Reporte completo](../deploy/validation-phase3a-public.json).

Chromium real comprobó /escape y la integración Go/CORS/HTTPS: turno 8→9, versión 17→19 y 60 marcadores cambiaron coordenadas. Pasaron zoom/reset/selección y la comprobación de ancho sin desbordamiento a 390 px, con 0 errores de JavaScript/red, 0 cabeceras x-api-key y 0 llamadas /paso desde el navegador. Para evitar cachés del ISP se utilizó DoH real 1.1.1.1 mediante un túnel CONNECT local, con TLS del navegador extremo a extremo, sin interceptarlo ni fijar la IP. [Reporte de navegador](../deploy/validation-phase3a2-browser.json). La captura móvil coincidió con una transición del menú y no constituye una revisión visual exhaustiva. La corrida inicial con DNS del ISP tuvo 9 fallos de red sin códigos individuales; su relación con DNS es una inferencia respaldada por las consultas independientes.

El panel de latencia del mapa muestra la métrica interna del simulador, distinta de los percentiles HTTPS externos del probe. React sólo consulta observaciones públicas; no se desplegó un servidor demo adicional.

## Logs, rollback y límites

CloudWatch recibió el evento JSON real `backend ready` en el stream backend del grupo `/corodev/corodev-phase2/backend`, con grafo 300/383 e intervalo 2 s. Se comprobó que la clave real no aparece en los eventos consultados. No se encontró OTel implementado y no se añadió una plataforma de observabilidad. Caddy conserva logs locales con rotación; la alarma CPU no notifica por SNS.

`deploy/rollout.sh` conserva el contenedor previo y lo restaura si falla el nuevo; `deploy/rollback.sh` vuelve después de un rollout. La instalación inicial no crea un release previo al que volver. Un reinicio restaura el escenario desde semilla, **no la RAM**. Para web, restaurar una versión anterior de index.html y sus assets y después invalidar CloudFront. No destruir el stack por un fallo parcial; cualquier cambio de infraestructura requiere revisión nueva.

Detener EC2 conserva cargos EBS/EIP. Al retirar, revisar buckets/versiones Retain y recursos retenidos. El Budget externo no pertenece al stack. Presupuesto 30 USD y gasto informado 0 USD tienen retraso y no detienen cargos; ver [costos](costos.md).

Se mantienen las verificaciones locales previas, sin repetirlas. cfn-guard no estaba disponible y no se ejecutó; no se afirma cumplimiento automatizado de esa herramienta. No se repitieron experimentos FASE 2. Flutter conserva su APK local; no se hizo prueba física ni se incluyó API_KEY.

## Git y evidencias

Los recibos completos de autorización, ejecución, AWS, SSM y pruebas están en `deploy/evidence-private/phase3a2-deployment-20261026/`, excluido de Git. Los JSON públicos omiten cuenta, destinatarios, secretos y parámetros privados. El historial local utiliza fechas auténticas. El propietario **aplazó la publicación GitHub**: no hay remoto ni push; no se creó repositorio público.

Quedan como límites: propagación DNS global sin garantizar, simulación finita/RAM, operador con permisos administrativos por decisión del propietario, entrega de alertas Budget sin confirmar y ausencia de captura auténtica de consola. El Budget sí se comprobó por API; no se fabricó una imagen. No se inició FASE 3B.

## Candidata FASE 3B.2

Se preparó localmente el control multigrafo y el selector de cobertura, con pruebas Go/React/Flutter y mediciones separadas de las públicas anteriores. No se ejecutó CloudFormation ni se reemplazó el backend o frontend público durante esta fase. `deploy/rollout.sh` detiene el contenedor y pierde RAM; esa intervención requiere autorización expresa y revisión de los hashes de la candidata. Los experimentales quedan deshabilitados por defecto. Véanse [operación multigrafo](operacion-multigrafo.md) e [informe FASE 3B.2](informe-fase3b2.md).
