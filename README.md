# MantaSim · CoroDev

**AWS Hackathon · Track A: Escape de Manta Zombie**

Construí MantaSim para explorar cómo evacuar personas por las calles de Manta cuando las amenazas y las rutas disponibles cambian. Partí del reto de escape zombi y extendí el proyecto con rescate vehicular y un laboratorio de inundaciones urbanas.

El motor está escrito en **Go**. Desarrollé una consola en **React y TypeScript** para controlar las simulaciones y un cliente **Flutter Android** para observarlas. Desplegué la aplicación en **AWS**.

[Demo](#demo-pública) · [Inicio rápido](#inicio-rápido) · [Arquitectura](#arquitectura-y-aws) · [API y simulador](#api-y-simulador) · [Resultados](#resultados) · [Costos](#costos-budget-y-limitaciones) · [Documentación](#documentación-y-estructura)

## Demo pública

**[Escape de Manta Zombie](https://sistemamanta.lexinnovate.com/escape)** · [Laboratorio de inundaciones](https://sistemamanta.lexinnovate.com/flood-lab) · [Visor móvil](https://sistemamanta.lexinnovate.com/mobile)

Para recorrer la demo, recomiendo empezar por el escenario zombi:

1. Selecciona el grafo **Básica (BASE)** y una ronda. En **Configuración avanzada**, elige **Oficial · reglas del reto** para probar el preset `official`.
2. Pulsa **Iniciar simulación** y selecciona una persona para seguir su ruta. Observa cómo cambian las amenazas, los caminos y las plazas de los refugios.
3. Usa **Pausar** y **Continuar** para inspeccionar el estado. Al terminar o cancelar, **Reiniciar** repite la configuración y semilla; **Nueva configuración** permite preparar otra ejecución.

Abrir o recargar la página no inicia otra simulación. El visor móvil y Android observan la última ejecución publicada; el control permanece en la consola de escritorio. Para probar las camionetas, dejé una [guía del modo PRO](docs/nivel-pro.md#demostración-reproducible).

La demo tiene una retirada programada desde el **31 de octubre de 2026, 01:46 (Ecuador)**. Su [vigencia operativa](deploy/autokill/README.md) y las [verificaciones del despliegue](docs/despliegue.md#estado-respaldado-por-evidencia) están documentadas. La API expone un [healthcheck público](https://api.sistemamanta.lexinnovate.com/healthz).

## Inicio rápido

Preparé el entorno local para ejecutar la web y los servicios Go sin necesitar AWS, Docker ni Flutter. Se requieren **Node ≥22.12, npm ≥10, Go ≥1.23, Python 3 y GNU Make**.

```sh
git clone https://github.com/corozodev/simluacion-desastres-manta.git
cd simluacion-desastres-manta
make setup
make dev
```

Abre **http://127.0.0.1:5173/escape**. El laboratorio está en `/flood-lab` y el visor en `/mobile`. La API utiliza el puerto 8080 y el laboratorio, el 8082.

`make setup` instala dependencias, genera contratos y tokens, y crea la configuración privada sólo cuando falta. Para detener el entorno, usa **Ctrl+C** o `make stop`; los reportes se conservan. `make help` muestra las tareas disponibles.

### Pruebas

Desde la raíz, después de preparar el entorno:

| Comando | Qué comprueba |
| --- | --- |
| `make smoke` | Web, API, laboratorio y `/paso` autenticado; requiere `make dev` activo. |
| `make test` | Pruebas JavaScript y Go. |
| `make verify` | Documentación, contratos y derivados, lint/tipos, Go/race, geografía, integraciones HTTP y builds web/Go. |

`make test` y `make verify` no necesitan servicios previos ni AWS. Las pruebas de navegador y Flutter se ejecutan aparte. Dejé los detalles en [pruebas](docs/pruebas.md), la [guía local](docs/despliegue.md#desarrollo-local) y el [README de Android](apps/mobile/README.md). `GO_BIN` y `FLUTTER_BIN` permiten seleccionar herramientas fuera de PATH.

## Qué implementé

### Escape zombi: nivel Base

Trabajé sobre **BASE**, una muestra de la red vial de Manta con **300 intersecciones y 383 aristas derivadas de OpenStreetMap**. Incluí cuatro zonas de origen y cuatro refugios ficticios.

El preset `official` ejecuta tres rondas con **20, 80 y 200 sobrevivientes**, respectivamente. Cada ronda tiene **150 turnos de dos segundos**, sin flota. Implementé caminantes, corredores, hordas y dormidos, con mordidas por coincidencia de nodo y cruce. R2 incorpora el colapso de un puente y R3, dos cierres adicionales.

Las personas calculan rutas hacia refugios y las revisan ante amenazas, cierres y falta de plazas. El simulador valida cada movimiento y permite esperar. Los dormidos aún ocultos permanecen fuera de la información pública.

Conservé `legacy_current` como planificador predeterminado y añadí alternativas para comparar. También mantengo **FULL_MANTA**, de 9.179 nodos y 13.452 aristas, como opción experimental que requiere habilitación explícita. Las [reglas](docs/reglas-simulacion.md) y la [matriz de cumplimiento](docs/pruebas.md#matriz-de-cumplimiento) detallan el alcance.

### Rescate y coordinación: nivel PRO

Añadí predicción del riesgo de corredores a partir de movimientos observados, asignación de refugios con capacidad y reservas, y **cinco camionetas de cuatro plazas** para recoger y trasladar personas.

Las camionetas recorren hasta dos aristas reales por turno frente a una peatonal. Eso representa avance topológico; no acredita el doble de velocidad física en m/s. Un pasajero cuenta como evacuado después de su entrega en un refugio con plaza.

Mantengo la flota como experimental, fuera de `official`. Mis pruebas incluyen regresiones: estas funciones no garantizan mayor supervivencia. En [Nivel PRO](docs/nivel-pro.md) explico su implementación, demostración y límites.

### Laboratorio de inundaciones

Extendí la evacuación a un laboratorio con los modelos `rainfall_runoff_2d` y `compound_flood_2d`. El agua se calcula sobre una malla separada del grafo vial. La lluvia, el relieve, la costa, el cauce y los refugios son escenarios sintéticos; las calles proceden de OSM. Uso la susceptibilidad SNGR y los eventos históricos como contexto con fuente y fecha.

También incorporé reportes ciudadanos mediante una API real y almacenamiento privado en disco. Los reportes nuevos quedan pendientes y no modifican automáticamente una tormenta.

Esta extensión es experimental: **no proporciona alertas oficiales ni recomendaciones de evacuación**. Documenté el [laboratorio](docs/laboratorio-inundaciones.md), la [procedencia de los datos](docs/datos-oficiales-y-demo.md) y el [flujo de reportes](docs/incidentes-ciudadanos.md).

## Arquitectura y AWS

![Arquitectura de MantaSim: clientes, servicios AWS, motores y flujos públicos y privados](docs/arquitectura.svg)

[Fuente Mermaid editable](docs/arquitectura.mmd) · [explicación de la arquitectura](docs/arquitectura.md).

Elegí un **monolito modular Go** y un único escritor por simulación para conservar el orden de los turnos y la coherencia del mundo. Cada sesión aísla su estado, semilla, reloj y cachés. Las decisiones consultan snapshots inmutables mediante HTTP real autenticado; los clientes reciben observaciones por polling y descargan la geografía por separado.

Centralicé los contratos HTTP en OpenAPI y el diseño en tokens compartidos para generar sus salidas en TypeScript, Dart y CSS. Importé la geografía offline desde fuentes versionadas para reproducir las simulaciones sin depender de un servicio externo de rutas durante cada turno.

Para el despliegue utilicé **EC2 `m7i-flex.large`, 2 vCPU/8 GiB, en Ohio (`us-east-2`)**, con Docker y Caddy para HTTPS. La web se sirve desde **S3 privado mediante CloudFront/OAC y ACM**. CloudWatch recibe logs y métricas; CloudFormation describe los recursos y SSM permite operarlos sin SSH público. Cloudflare DNS y Let's Encrypt son externos a AWS.

La web y el acceso HTTPS a la API son públicos, con autenticación según la operación. Los buckets, los puertos Go y el HTTP de decisiones de cada sesión permanecen privados. Separé el laboratorio hidráulico y su almacenamiento del motor zombi.

### Despliegue

Para preparar una release, primero compilo React con las URLs HTTPS de la API, construyo la imagen Linux/amd64 y genero el bundle con `deploy/aws/prepare-release.sh`. Dejé los comandos en la [guía de preparación](docs/despliegue.md#preparar-una-release).

Para actualizar la instalación existente, sigo el [procedimiento de despliegue y reversión](docs/despliegue.md#actualización-de-la-instalación-existente), que contempla persistencia y comprobaciones de salud. Para una instalación nueva, están la [plantilla CloudFormation y sus parámetros](docs/despliegue.md#infraestructura-nueva-y-retirada). Las operaciones requieren acceso autorizado a la cuenta y región.

## API y simulador

### Endpoint del Track A

```text
POST https://api.sistemamanta.lexinnovate.com/paso
```

En local utilizo `POST http://127.0.0.1:8080/paso`. La solicitud requiere `Content-Type: application/json` y la cabecera privada `x-api-key`. La clave de evaluación se entrega por un canal privado.

Solicitud ilustrativa:

```json
{"sobrevivienteId":"S-0089","nodoActual":"N-0117","turno":142}
```

La respuesta contiene únicamente el siguiente nodo: un vecino transitable o el nodo actual para esperar.

```json
{"siguienteNodo":"N-0118"}
```

Los IDs, el nodo y el turno deben pertenecer al mismo runtime. El `/paso` público consulta el mundo de compatibilidad `/estado`, preparado e inactivo; cada sesión de React tiene su propio HTTP loopback privado. Dejé un [ejemplo curl con estado real](docs/contratos.md#probar-paso-y-entregar-la-clave-al-jurado) y el [contrato OpenAPI](packages/contracts/openapi.yaml).

### Ejecutar las rondas

Para repetir las tres rondas a su ritmo nominal, ejecuto estos comandos secuencialmente desde la raíz, después de `make setup`:

```sh
npm run simulate -- -scenario scenarios/urban/round1.json -interval 2s -output reports/realtime/r1.json
npm run simulate -- -scenario scenarios/urban/round2.json -interval 2s -output reports/realtime/r2.json
npm run simulate -- -scenario scenarios/urban/round3.json -interval 2s -output reports/realtime/r3.json
```

Cada ronda dura cinco minutos nominales. La CLI crea un proceso local aislado con HTTP real autenticado y guarda los informes bajo `services/evacuation/reports/`, ignorado por Git. No necesita la demo publicada.

### Medir latencia y comparar algoritmos

Mido `/paso` desde el cliente con reloj monotónico. Incluyo TCP/HTTP loopback, el handler y la lectura/decodificación de la respuesta; excluyo la cola previa del trabajador y la planificación global anterior. Los informes guardan p50, p95, p99, errores y timeouts.

El p95 indica el tiempo en el que termina al menos el 95 % de las solicitudes medidas: ordeno las duraciones y tomo el rango `ceil(0,95 × n)`. Para un benchmark de 10.000 solicitudes con concurrencia 16, snapshot fijo y calentamiento previo:

```sh
npm run bench:backend -- -requests 10000 -concurrency 16 -output reports/latencia/paso.json
```

Para comparar algoritmos con las mismas semillas mediante rondas completas aceleradas:

```sh
npm run compare:agents -- --rounds 1,2,3 --seeds 7,42 --repeats 2 \
  --algorithms legacy_current,predictive_temporal_astar --output reports/comparison
```

La comparación exporta JSON/CSV; `--realtime` añade el ritmo nominal a cada ejecución. La misma versión de motor y grafo, configuración y semilla permiten reproducir resultados lógicos. Los tiempos HTTP quedan fuera de esa garantía; un fallo o timeout se convierte en espera y puede cambiar el resultado.

Distingo estas mediciones locales de la latencia por Internet y del procesamiento registrado en CloudWatch. El benchmark fijo complementa las rondas completas; calculo los percentiles de cada ejecución por separado. Documenté la [metodología y rúbrica](docs/pruebas.md#metodología-y-rúbrica) y la [instrumentación del servidor](docs/despliegue.md#observabilidad-mínima-cloudwatch).

## Resultados

En la validación local del **27 de octubre de 2026** registré **16 rondas aceleradas completas, 2.400 turnos y 93.962 solicitudes válidas**, sin inválidas ni timeouts y con hashes lógicos repetidos. Conservo la versión, el equipo y las condiciones de medición en [pruebas](docs/pruebas.md#mediciones-locales-de-esta-consolidación). Son resultados históricos; no certifican rendimiento de la versión actual ni capacidad EC2.

Estos fueron los resultados de R3 con semilla 42, 200 personas y 150 turnos:

| Algoritmo y flota | Evacuados | Mordidos | Activos |
| --- | ---: | ---: | ---: |
| `legacy_current`, sin flota | 169 | 1 | 30 |
| `predictive_temporal_astar`, sin flota | 170 | 18 | 12 |
| `legacy_current`, con flota experimental | 137 | 3 | 60 |
| `predictive_temporal_astar`, con flota experimental | 166 | 8 | 26 |

En esta semilla, la flota redujo evacuados en ambos algoritmos y la alternativa temporal registró más mordidos que `legacy_current` sin flota. Por eso mantuve el planificador predeterminado y conservé los resultados adversos junto con los favorables.

Al leer estas cifras, distingo **evacuación** de **supervivencia**: una persona activa sigue viva, pero aún no ha llegado a un refugio. Las reservas tampoco cuentan como llegadas, y los pasajeros se consideran evacuados después de la entrega.

## Costos, Budget y limitaciones

Estimé una operación continua de **78,28 USD/mes**, con 730 horas y uso pequeño, antes de descuentos. Dejé el [cálculo por servicio, las tarifas consultadas el 27/10/2026 y las exclusiones](docs/costos.md#proyección-mensual-reproducible) para que se pueda revisar.

Mi AWS Budget es de **50 USD/mes**. La captura muestra **0,09 USD (0,18 %)** de consumo mensual de cuenta, umbrales **OK** y **1/1 correo verificado**:

![AWS Budget: límite de 50 USD, gasto mostrado de 0,09 USD, alertas OK y un correo verificado](docs/budget.png)

El Budget avisa y no detiene cargos; mi proyección mensual supera ese importe. Los 0,09 USD llegan con retraso de actualización y no representan el gasto final del proyecto. **Me queda conciliar el gasto real del hackathon** con Billing/Cost Explorer, indicando período, servicios y créditos/impuestos. [Fuente y alcance de la captura](docs/costos.md#gasto-real-del-evento-y-budget).

### Límites que mantengo explícitos

- Las sesiones viven en RAM y se pierden al reiniciar Go; los reportes ciudadanos tienen persistencia independiente.
- Los refugios son ficticios y BASE representa una muestra de la red vial. FULL_MANTA sigue siendo experimental.
- La predicción no está calibrada y el movimiento se expresa por aristas, sin integrar velocidad física en m/s.
- La hidráulica utiliza parámetros sintéticos y los reportes nuevos requieren revisión antes de modificar información operativa.
- Las pruebas de navegador no sustituyen la validación en dispositivos físicos, que sigue pendiente.

Detallo estos alcances en [limitaciones](docs/limitaciones.md).

## Documentación y estructura

Organicé el código en `services/evacuation` (Go), `apps/web` (React) y `apps/mobile` (Flutter). En `packages` reuní contratos, diseño y recursos compartidos; en `tools`, la automatización local; y en `deploy`, los artefactos y procedimientos AWS.

| Tema | Documento |
| --- | --- |
| Componentes, flujo y decisiones | [Arquitectura](docs/arquitectura.md) |
| Desarrollo local, Docker, AWS y CloudWatch | [Despliegue](docs/despliegue.md) |
| Reglas, reproducción y medición | [Reglas de simulación](docs/reglas-simulacion.md) · [pruebas](docs/pruebas.md) |
| Predicción, refugios y flota | [Nivel PRO](docs/nivel-pro.md) |
| HTTP y autenticación | [Contratos](docs/contratos.md) |
| Costos y alcance | [Costos](docs/costos.md) · [limitaciones](docs/limitaciones.md) |
| Datos, geografía e informes de fases | [Índice técnico](docs/INDEX.md) |

## Autoría

Soy [corozodev](https://github.com/corozodev), único integrante de **CoroDev**. Desarrollé MantaSim con apoyo de asistentes de IA para implementación, revisión y documentación. El historial del repositorio conserva la evolución del proyecto. Agradezco las fuentes de OpenStreetMap, GeoManta y SNGR/CONAGE; mantengo su [procedencia y atribución](docs/datos-oficiales-y-demo.md) en la documentación.
