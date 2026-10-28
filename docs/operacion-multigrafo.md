> **Referencia técnica histórica FASE 3B.2.** Para ejecutar el producto actual usar [desarrollo local](development/local-setup.md), [contratos](contratos.md) y [arquitectura](arquitectura.md). Hidrología, controles públicos y visores posteriores sustituyen las reglas/pantallas previas descritas aquí; los motores y reportes históricos se preservan.

# Operación multigrafo — FASE 3B.2

Competición es la modalidad predeterminada y la referencia del Track A. El catálogo acepta exclusivamente los tres archivos revisados, con checksum, geometría, cuatro zonas y cuatro refugios válidos:

| ID | Archivo | Nodos / aristas | Activación predeterminada |
| --- | --- | --- | --- |
| `competition` | `data/manta-v2.json` | 300 / 383 | Habilitada |
| `full` | `data/manta-master.json` | 9.179 / 13.452 | Deshabilitada, experimental |
| `expanded` | `data/manta-expanded.json` | 1.000 / 1.599 | Deshabilitada, experimental |

Manta completo contiene toda la red representada por el maestro de FASE 2. No acredita todas las vías de la ciudad ni límites municipales oficiales. Ampliado es un preset intermedio, nunca el mapa completo. Los refugios son ficticios sobre nodos reales.

## Observar y previsualizar

`GET /estado` añade `simulation`: ID de ejecución, modalidad, ronda, semilla, versión del grafo, estado, límite de turnos e intervalo. Sigue omitiendo sleepers dormidos y PRNG. `GET /simulation` devuelve sólo esos metadatos; `/simulation/catalog` informa presets, disponibilidad y motivos de bloqueo. No publica la identidad del operador.

React obtiene el grafo activo con `/grafo?run_id=…`. Si la ejecución cambió, el servidor devuelve `409 RUN_CHANGED`; el cliente recupera el mundo y usa una clave de caché nueva. También desmonta selección, búsqueda, rutas y vista del mapa al cambiar de ejecución.

El selector **Previsualizar cobertura** consulta `/grafo?mode=full` sin activar una simulación. La vista previa muestra calles, zonas y refugios estáticos; oculta posiciones, zombies y rutas de la ronda activa. Las estadísticas superiores siguen perteneciendo a la modalidad activa, identificada en el panel. Las previsualizaciones reutilizan JSON geográfico inmutable; no crean simuladores ni copias del maestro por solicitud.

## Operador y seguridad

No había autenticación de operador. Se implementó una credencial aleatoria independiente de 256 bits y un verificador SHA-256 en el servidor. No es una contraseña humana: no reutilizar contraseñas ni calcular el verificador de la clave de `/paso`. El servidor rechaza que ambas credenciales coincidan.

Desde `services/evacuation`, generar archivos **privados nuevos**:

```bash
mkdir -p ../../deploy/evidence-private
go run ./cmd/operator-key -operator operador -directory ../../deploy/evidence-private/operator-local
```

El directorio queda con modo 0700; `operator.env` y `operator-login.json`, 0600. El comando no imprime sus secretos. `operator.env` contiene únicamente identificador y verificador para el servidor. El propietario consulta el código en `operator-login.json` localmente y lo introduce en el formulario. No enviarlo a chat, Git, bundles ni variables `VITE_`/Dart.

Configurar `ADMIN_OPERATOR` y `ADMIN_ACCESS_HASH` en el entorno privado del backend. Vacíos deshabilitan administración; configuración parcial o inválida impide arrancar. La identidad registrada es la etiqueta de esa credencial compartida; no se afirma identificación individual mediante IAM, SSO o MFA.

`POST /admin/session` valida código y operador. El navegador borra el campo antes de esperar la respuesta; no conserva el código en estado React, variables de mutación, localStorage o sessionStorage. La sesión usa cookie opaca `__Host-corodev_admin`, HttpOnly, Secure, SameSite Strict, host exclusivo, ruta `/`, duración absoluta de una hora. El servidor conserva hashes de las cookies y admite hasta ocho sesiones; reiniciar o rotar el verificador requiere volver a autenticarse. Los intentos de acceso tienen límite global de diez por minuto.

Las mutaciones exigen origen HTTPS explícitamente aprobado, JSON y token CSRF ligado a la sesión. El CSRF se conserva sólo en memoria del cliente; no autoriza nada sin la cookie. `DELETE /admin/session` revoca la sesión. Las respuestas administrativas son `no-store`; CORS permite credenciales únicamente al origen aprobado. API y frontend actuales comparten sitio HTTPS aunque tengan hosts distintos. No se habilita CORS comodín ni se usa la API key de movimiento en React/Flutter.

Estas decisiones siguen las guías de [sesiones](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) y [CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) de OWASP. El acceso público a observaciones permanece de sólo lectura.

## Iniciar entre rondas

El operador elige preset, ronda 20/80/200 y semilla entera segura para JavaScript. React envía `POST /admin/runs` con `expected_run_id` y CSRF. Sólo se inicia después de terminar la ronda anterior; no existe un endpoint para interrumpirla. Las carreras entre operadores reciben `409 RUN_ACTIVE` o `409 RUN_CHANGED`. Un preset deshabilitado devuelve `403 MODE_DISABLED`. Un fallo al preparar la siguiente ronda conserva la anterior.

Cada ejecución tiene store, motor, planificador, cachés, cliente HTTP y PRNG propios. Se prepara y valida la candidata antes de intercambiarla; sólo hay una simulación activa. No se modifica `POST /paso`, no se muta el mundo desde solicitudes y no se añaden saltos o cambios a reglas zombie.

Se conservan los últimos diez snapshots **finales observables** mediante `/runs/{run_id}/estado`, sin grafo repetido ni información oculta. El grafo correspondiente puede recuperarse por preset. No es almacenamiento duradero: reiniciar pierde RAM e historial; exportar los finales necesarios antes de intervenir. Los logs JSON `simulation.run_started` y `simulation.run_finished` incluyen timestamp, operador, ID, modalidad y configuración, sin credenciales. No se añadió un nuevo destino de logs o métrica facturable.

Las rondas conservan 150 turnos a intervalos nominales de dos segundos y semillas originales 20261026/27/28, salvo semilla elegida expresamente. Si un turno tarda más, no se oculta ese costo. Para otros grafos, los bloqueos por índice se resuelven al mismo ID físico del grafo de competición: ronda 2 puente `E-4420ceab96c993b4`; ronda 3 calles `E-01417b990110320d` y `E-01780b1cf640b889`. Cada variante utiliza sus refugios y candidatos de aparición aprobados; por ello los resultados entre topologías no son comparaciones causales de algoritmos.

## Desarrollo y mediciones

Para una prueba local explícita, escuchar sólo en `127.0.0.1`, aprobar el origen local exacto y usar `ADMIN_ALLOW_INSECURE_LOOPBACK=true`. El servidor rechaza esta opción con un listener público; usa una cookie de desarrollo distinta. No utilizarla detrás de un proxy público. En producción permanecerá `false`, con Caddy/HTTPS y Go privado.

`SIM_AUTOSTART=false` permite esperar a un operador en desarrollo; en producción el comportamiento previo sigue siendo arranque automático de Competición. `SIM_INTERVAL=0` o intervalos cortos son aceleraciones de prueba, nunca se presentan como rondas de dos segundos. `SIM_TURNS` admite sólo 150. `GRAPH_PATH`/`SCENARIO_PATH` de arranque deben pertenecer al catálogo de Competición y rondas urbanas; no se aceptan rutas arbitrarias. `SIM_CONCURRENCY` limita decisiones internas; 200 sobrevivientes no obliga a lanzar 200 solicitudes simultáneas en cada turno.

Construir y medir sin AWS, desde la raíz:

```bash
cd services/evacuation
go build -o ../../deploy/evidence-private/multigraph-bench ./cmd/multigraph-bench
cd ../..
python3 tools/qa/benchmark_multigraph.py --binary deploy/evidence-private/multigraph-bench --output deploy/evidence-private/benchmark-nuevo --modes competition full
MULTIGRAPH_EVIDENCE_DIR=deploy/evidence-private/browser-nuevo node tools/qa/check_multigraph.mjs
```

El benchmark usa Docker local sin red externa ni puertos publicados, dos CPU, `GOMAXPROCS=2`, memoria/swap limitadas a 1 GB, rootfs readonly y sin capacidades. Ejecuta tres rondas a dos segundos por modalidad y estrés HTTP sobre un snapshot inicial estable: 1.000 intentos, 200 clientes, autenticación real, conexiones persistentes y deadline 500 ms. La inicialización/calientamiento queda fuera de las latencias del estrés. CPU/RSS abarcan el proceso completo, incluida carga del catálogo; no representan toda una EC2 con sistema y Caddy.

`--accelerate-reference` acelera sólo las rondas de referencia no completas y lo declara. Sirve para comprobar resultados deterministas, no para comparar CPU media con rondas pausadas. Los JSON conservan fallos, timeouts, percentiles nearest-rank sobre todos los intentos del estrés, CPU, RSS máxima, pico de cgroup y recibos Docker. Un objetivo incumplido devuelve código distinto de cero y conserva evidencia. Un OOM/timeout queda en el recibo aunque no exista JSON de aplicación. Nunca publicar diagnósticos con posiciones iniciales ocultas.

El objetivo oficial se evalúa en Competición. Por indicación del propietario, el maestro es un experimento geográfico: sus latencias se informan sin exigirle el rendimiento del preset de 300 nodos ni alterar reglas para conseguirlo. Los umbrales de referencia en los reportes sirven para caracterizar el costo, no para atribuirle al reto un requisito sobre 9.179 nodos. Las condiciones y resultados de esta entrega están en [informe-fase3b2.md](informe-fase3b2.md).

## AWS actual

Esta entrega se desplegó en AWS con autorización expresa. El contenedor nuevo usa la imagen revisada y Competición ronda 3; conserva la clave de movimiento, límites Docker y awslogs. Caddy, certificados, DNS, IAM y CloudFormation no cambiaron. El selector y el acceso de operador están disponibles en la URL pública.

El propietario ordenó no conservar imágenes de respaldo. El contenedor anterior detenido, su imagen Docker y los archivos duplicados de imagen de instalación se retiraron de EC2. La imagen actual y el Caddy activo se conservan. El script general `deploy/rollout.sh` aún contempla una copia temporal durante el cambio; futuras operaciones de este servidor deben respetar la preferencia del propietario y no dejar ese respaldo. No hay rollback inmediato a la imagen anterior en EC2. El historial observable sigue en RAM; no representa una imagen de respaldo.

`ENABLE_FULL_MODE=false` y `ENABLE_EXPANDED_MODE=false` permanecen en producción. Las vistas previas están disponibles; activar un experimento público exige una decisión separada. Al terminar 150 turnos el mapa queda inmóvil; el operador puede iniciar una ronda nueva. La validación externa no inició una ronda adicional. Véase [evidencia del rollout](../deploy/validation-phase3b2-rollout.json).
