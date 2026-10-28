# MantaSim · CoroDev

**AWS Hackathon · Track A: Escape de Manta Zombie**

Simulador de evacuación sobre calles reales de Manta, Ecuador. Calcula rutas hacia refugios y las revisa cuando aparecen amenazas, se cierran calles o se agotan las plazas. Incluye rescate vehicular experimental y un laboratorio de inundaciones con parámetros sintéticos.

**Go** · **React + TypeScript** · **Flutter Android** · **AWS**

[Demo](#demo-pública) · [Inicio rápido](#inicio-rápido) · [Track A y API](#api-y-prueba-de-fuego) · [Arquitectura](#arquitectura-y-aws) · [Costos](#costos-budget-y-limitaciones) · [Entregables](#entregables-del-hackathon) · [Contribuir y agentes](#contribuir-y-trabajar-con-agentes)

| Si quieres… | Empieza aquí |
| --- | --- |
| Evaluar el proyecto o preparar el pitch | [Guía de demo](#demo-pública), [resultados](#resultados-verificables) y [entregables](#entregables-del-hackathon) |
| Ejecutar, probar o desplegar | [Inicio rápido](#inicio-rápido), [Track A](#api-y-prueba-de-fuego) y [despliegue AWS](#desplegar-en-aws) |
| Modificar el código, como persona o agente | [AGENTS.md](AGENTS.md), [fuentes de verdad](#contribuir-y-trabajar-con-agentes) y [mapa documental](#documentación-y-estructura) |

## Demo pública

**[Abrir Escape de Manta Zombie](https://sistemamanta.lexinnovate.com/escape)** · [Laboratorio de inundaciones](https://sistemamanta.lexinnovate.com/flood-lab) · [Visor móvil](https://sistemamanta.lexinnovate.com/mobile) · [Salud de la API](https://api.sistemamanta.lexinnovate.com/healthz)

1. Abre **Escape**, explora el grafo **Básica (BASE)** y elige una ronda. Para evaluar las reglas del reto, selecciona **Oficial · reglas del reto** (`official`) en **Configuración avanzada**.
2. Pulsa **Iniciar simulación**. Selecciona una persona para consultar su ruta y destino; observa amenazas, ocupación y plazas reservadas.
3. Usa **Pausar** y **Continuar** para explicar el estado. Al finalizar o cancelar, **Reiniciar** repite la configuración y semilla; **Nueva configuración** permite preparar otra ejecución.
4. Abre el **visor móvil** para observar la última ejecución publicada. React móvil y Android son espectadores; el control permanece en la consola de escritorio.

Abrir o recargar la página no inicia otra simulación. La demo no pide clave de operador para comenzar. Para mostrar camionetas, sigue la [demostración PRO](docs/nivel-pro.md#demostración-reproducible).

**Vigencia:** la retirada está programada desde el **31 de octubre de 2026, 01:46 (Ecuador)**. Confirmar que cubre la fecha del pitch. [Programación y alcance](deploy/autokill/README.md) · [versión y verificaciones registradas](docs/despliegue.md#estado-respaldado-por-evidencia).

### Cómo leer el mapa y las métricas

| Indicador | Significado |
| --- | --- |
| Evacuados | Personas admitidas en un refugio. Un pasajero cuenta después de la entrega. |
| Activos | Personas que siguen en la simulación, a pie o a bordo. |
| Supervivencia | Porcentaje de evacuados más activos respecto de la población inicial. |
| Ocupación / reservas | La ocupación cuenta llegadas; una reserva protege una plaza para un agente asignado. |
| Espera | Puede deberse a una decisión válida, falta de ruta/plaza o un fallo HTTP. El detalle muestra los diagnósticos observables disponibles. |
| Latencia p95 | El 95 % de las solicitudes medidas tarda ese tiempo o menos. Identificar si mide HTTP local o procesamiento del servidor. |

[Definiciones y cálculo](docs/pruebas.md#metodología-y-rúbrica) · [diagnósticos de movilidad](docs/nivel-pro.md#supervivientes).

## Inicio rápido

Requisitos: **Node ≥22.12, npm ≥10, Go ≥1.23, Python 3 y GNU Make**. Flutter y Docker son opcionales para ejecutar la web local.

```sh
git clone https://github.com/corozodev/simluacion-desastres-manta.git
cd simluacion-desastres-manta
make setup
make dev
```

Abre **http://127.0.0.1:5173/escape** y pulsa **Iniciar simulación**. También están disponibles `/flood-lab` y `/mobile`. La API y el laboratorio utilizan Go real en los puertos locales 8080/8082; no necesitas AWS.

`make setup` instala dependencias, genera contratos/tokens y crea configuración privada sólo cuando falta. Detén el entorno con **Ctrl+C** o `make stop`; los reportes se conservan. `GO_BIN` y `FLUTTER_BIN` permiten seleccionar herramientas fuera de PATH.

### Probar los cambios

Ejecuta desde la raíz, después de preparar el entorno:

| Comando | Qué comprueba | Requiere |
| --- | --- | --- |
| `make smoke` | Web, salud, capacidades, publicados, laboratorio y `/paso` autenticado | `make dev` activo |
| `make test` | Pruebas JavaScript y Go | Herramientas y dependencias locales |
| `make verify` | Documentación, contratos/derivados, lint/tipos, Go/race, geografía, integraciones HTTP y builds web/Go | Sin AWS, Flutter ni servicios previos |
| `npm run docs:check` | Enlaces/anclas locales y comprobaciones básicas de secretos en el árbol publicable | Node y Git |

Las pruebas de navegador y Flutter se ejecutan aparte. [Cobertura y comandos](docs/pruebas.md) · [Android y firma de distribución](apps/mobile/README.md) · [puertos y recuperación local](docs/despliegue.md#desarrollo-local). `make help` muestra las tareas disponibles.

## Qué hace el sistema

### Nivel Base

El preset `official` utiliza **BASE: 300 intersecciones y 383 aristas derivadas de OpenStreetMap**, cuatro zonas de origen y cuatro refugios ficticios.

- R1/R2/R3: **20/80/200 sobrevivientes**, **150 turnos de 2 segundos**, sin flota.
- Rutas sobre calles transitables, replanificación ante amenazas/cierres y espera cuando corresponde.
- Caminantes, corredores, hordas y dormidos; mordidas por nodo y cruce. Los dormidos ocultos permanecen privados.
- Colapso de puente en R2 y dos cierres en R3 mediante overlays sobre la geografía fuente.
- Decisiones mediante `POST /paso` autenticado; mapa React y espectadores React móvil/Android.

`legacy_current` es el algoritmo predeterminado; existen alternativas comparables. FULL_MANTA, con **9.179 nodos y 13.452 aristas**, es experimental y requiere habilitación explícita. [Reglas y supuestos](docs/reglas-simulacion.md) · [matriz de cumplimiento y evidencia](docs/pruebas.md#matriz-de-cumplimiento).

### Nivel PRO

| Función | Alcance |
| --- | --- |
| Predicción de corredores | Riesgo a partir de movimientos observados; probabilidades sin calibrar. |
| Coordinación de refugios | Capacidad, reservas y reasignación validadas por el simulador. |
| Rescate | Cinco camionetas de cuatro plazas; recogida, traslado y entrega en refugios con capacidad. |
| Avance vehicular | Hasta dos aristas reales por turno frente a una peatonal; doble velocidad física en m/s pendiente de acreditar. |

La flota es experimental y está excluida de `official`. Las mediciones incluyen regresiones: PRO no garantiza mayor supervivencia. [Implementación, límites y demo reproducible](docs/nivel-pro.md).

### Inundaciones y reportes ciudadanos

El laboratorio utiliza `rainfall_runoff_2d` o `compound_flood_2d`, con agua en una malla separada del grafo vial. Lluvia, relieve, costa, cauce y refugios son escenarios sintéticos. OSM aporta calles; SNGR y los eventos históricos aportan contexto con fuente y fecha.

Los reportes ciudadanos se guardan en disco privado, nacen pendientes y no cambian automáticamente una tormenta. **Esta extensión es una simulación experimental; no proporciona alertas oficiales ni recomendaciones de evacuación.** [Laboratorio](docs/laboratorio-inundaciones.md) · [procedencia de datos](docs/datos-oficiales-y-demo.md) · [reportes](docs/incidentes-ciudadanos.md).

## API y prueba de fuego

### Endpoint Track A

| Entorno | Método y URL |
| --- | --- |
| AWS | `POST https://api.sistemamanta.lexinnovate.com/paso` |
| Local | `POST http://127.0.0.1:8080/paso` |

Cabeceras: `Content-Type: application/json` y `x-api-key`. La clave de evaluación se entrega al jurado por un canal privado.

Solicitud ilustrativa:

```json
{"sobrevivienteId":"S-0089","nodoActual":"N-0117","turno":142}
```

Respuesta exacta: un vecino transitable o el nodo actual para esperar.

```json
{"siguienteNodo":"N-0118"}
```

Usa IDs, nodo y turno reales del mismo runtime. El `/paso` público consulta el mundo de compatibilidad `/estado`, preparado e inactivo. Cada sesión de React tiene su propio HTTP loopback privado; sus nodos/turnos pertenecen a esa ejecución. [Ejemplo curl con estado real y autenticación](docs/contratos.md#probar-paso-y-entregar-la-clave-al-jurado) · [OpenAPI](packages/contracts/openapi.yaml).

### Ejecutar las tres rondas

Desde la raíz, después de `make setup`, ejecuta secuencialmente:

```sh
npm run simulate -- -scenario scenarios/urban/round1.json -interval 2s -output reports/realtime/r1.json
npm run simulate -- -scenario scenarios/urban/round2.json -interval 2s -output reports/realtime/r2.json
npm run simulate -- -scenario scenarios/urban/round3.json -interval 2s -output reports/realtime/r3.json
```

Cada ronda dura cinco minutos nominales. La CLI crea un proceso local aislado con HTTP real autenticado; no necesita la demo publicada. Los informes quedan bajo `services/evacuation/reports/`, ignorado por Git.

### Medir latencia y comparar

Se cronometra `/paso` en el cliente con reloj monotónico: incluye TCP/HTTP loopback, handler y lectura/decodificación. Excluye la cola previa del trabajador y la planificación global anterior. Se ordenan las duraciones y se toma el rango `ceil(0,95 × n)` para p95; también se guardan p50/p99, errores y timeouts. Cada JSON de ronda conserva métricas.

Benchmark local de 10.000 solicitudes, concurrencia 16 y snapshot fijo, con calentamiento previo:

```sh
npm run bench:backend -- -requests 10000 -concurrency 16 -output reports/latencia/paso.json
```

Para comparar algoritmos con las mismas semillas mediante rondas completas aceleradas:

```sh
npm run compare:agents -- --rounds 1,2,3 --seeds 7,42 --repeats 2 \
  --algorithms legacy_current,predictive_temporal_astar --output reports/comparison
```

La comparación exporta JSON/CSV. `--realtime` añade el ritmo nominal a cada ejecución. Misma versión de motor/grafo, configuración y semilla permiten reproducir resultados lógicos; los tiempos HTTP quedan fuera de esa garantía. Un fallo o timeout HTTP se convierte en espera y puede cambiar el resultado.

Estas mediciones locales excluyen el trayecto de Internet hasta AWS. El benchmark fijo complementa las rondas con amenazas y cambios de estado. Los percentiles de distintas ejecuciones se calculan por separado. [Metodología y rúbrica](docs/pruebas.md#metodología-y-rúbrica) · [medición del servidor en CloudWatch](docs/despliegue.md#observabilidad-mínima-cloudwatch).

## Arquitectura y AWS

![Arquitectura de MantaSim: clientes, servicios AWS, motores y flujos públicos y privados](docs/arquitectura.svg)

[Fuente Mermaid editable](docs/arquitectura.mmd) · [arquitectura detallada](docs/arquitectura.md).

| Decisión | Motivo |
| --- | --- |
| Monolito modular Go; un escritor por simulación | Mantener el orden lógico y la coherencia de estado, reservas y RNG. |
| Decisiones sobre snapshots inmutables | Permitir consultas concurrentes sin modificar el mundo. |
| Sesiones aisladas y polling; geografía descargada aparte | Separar ejecuciones y limitar los datos repetidos por actualización. |
| OpenAPI y tokens como fuentes compartidas | Generar contratos y diseño coherentes para TypeScript, Dart y CSS. |
| Importación offline de OSM versionado | Reproducir la geografía sin depender de un servicio de rutas durante cada turno. |

La infraestructura registrada utiliza **EC2 `m7i-flex.large`, 2 vCPU/8 GiB, Ohio (`us-east-2`)**, con Docker y Caddy para HTTPS. React se sirve desde **S3 privado → CloudFront/OAC**, con ACM. CloudWatch recibe logs y métricas; CloudFormation describe recursos y SSM permite operarlos sin SSH público. Cloudflare DNS y Let's Encrypt son externos a AWS.

La web y el acceso HTTPS a la API son públicos, con autenticación según la operación. Los buckets, los puertos Go y el HTTP de decisiones de cada sesión son privados. El laboratorio hidráulico y su almacenamiento ciudadano permanecen separados del motor zombie.

### Desplegar en AWS

1. Supera las [verificaciones](docs/pruebas.md) y configura las URLs HTTPS públicas de la API para el build React.
2. Compila la web, construye la imagen Linux/amd64 y genera el bundle con `deploy/aws/prepare-release.sh`, siguiendo la [preparación de release](docs/despliegue.md#preparar-una-release).
3. En la cuenta/región autorizadas, sigue la [actualización de la instalación existente](docs/despliegue.md#actualización-de-la-instalación-existente), con persistencia, salud y reversión. Para otra instalación, utiliza la [plantilla CloudFormation y sus parámetros](docs/despliegue.md#infraestructura-nueva-y-retirada).

## Resultados verificables

El registro local del **27 de octubre de 2026** contiene **16 rondas aceleradas completas, 2.400 turnos y 93.962 solicitudes válidas**, sin inválidas/timeouts y con hashes lógicos repetidos. Es evidencia histórica del código y equipo identificados en [pruebas](docs/pruebas.md#mediciones-locales-de-esta-consolidación); no certifica rendimiento de la versión actual ni capacidad EC2.

Ejemplo R3, semilla 42, 200 personas y 150 turnos:

| Algoritmo y flota | Evacuados | Mordidos | Activos |
| --- | ---: | ---: | ---: |
| `legacy_current`, sin flota | 169 | 1 | 30 |
| `predictive_temporal_astar`, sin flota | 170 | 18 | 12 |
| `legacy_current`, con flota experimental | 137 | 3 | 60 |
| `predictive_temporal_astar`, con flota experimental | 166 | 8 | 26 |

En esta semilla, la flota redujo evacuados en ambos algoritmos y la alternativa temporal registró más mordidos que `legacy_current` sin flota. Se conservan los resultados adversos y el algoritmo predeterminado. La muestra no demuestra una mejora universal de PRO.

## Costos, Budget y limitaciones

| Concepto | Importe y alcance |
| --- | --- |
| Operación continua estimada | **78,28 USD/mes**, 730 horas y uso pequeño; tarifas consultadas el 27/10/2026, antes de descuentos. [Cálculo por servicio y exclusiones](docs/costos.md#proyección-mensual-reproducible). |
| AWS Budget | **50 USD/mes**. Avisa; no detiene cargos. La proyección mensual supera ese importe. |
| Consumo mostrado en la captura | **0,09 USD (0,18 %)** del Budget; gasto mensual de cuenta con retraso de actualización. |
| Gasto real del hackathon | **Pendiente**: conciliar período, servicios y créditos/impuestos con Billing/Cost Explorer. |

![AWS Budget: límite de 50 USD, gasto mostrado de 0,09 USD, alertas OK y un correo verificado](docs/budget.png)

La captura muestra umbrales **OK** y **1/1 correo verificado**. Acredita la configuración visible; la recepción de una alerta disparada y el gasto final atribuible al proyecto siguen pendientes de evidencia. [Fuente y alcance](docs/costos.md#gasto-real-del-evento-y-budget).

Límites principales: sesiones en RAM que se pierden al reiniciar Go; refugios ficticios; predicción sin calibrar; movimiento por aristas; FULL_MANTA experimental; hidráulica sintética; validación pendiente en dispositivos físicos. Los reportes ciudadanos tienen persistencia independiente. [Limitaciones completas](docs/limitaciones.md).

## Entregables del hackathon

Estado documental revisado el **28 de octubre de 2026 (Ecuador)**. La disponibilidad futura de la demo depende de su vigencia operativa.

| Entregable | Estado y acceso |
| --- | --- |
| Repositorio público e historial real | [Código](https://github.com/corozodev/simluacion-desastres-manta) · [commits](https://github.com/corozodev/simluacion-desastres-manta/commits) |
| README raíz | Descripción, ejecución, pruebas, diseño, despliegue, límites y Budget en este documento |
| Diagrama de arquitectura | [SVG](docs/arquitectura.svg) y [fuente Mermaid](docs/arquitectura.mmd) |
| Captura AWS Budget con alertas | [Incorporada](docs/budget.png) |
| Declaración de costos | [Modelo mensual](docs/costos.md); **pendiente** el gasto final del evento |
| Aplicación AWS con URL pública | [Demo](https://sistemamanta.lexinnovate.com/escape) · [verificación registrada](docs/despliegue.md#estado-respaldado-por-evidencia); confirmar vigencia hasta el pitch |
| Presentación PDF/PPT/PPTX ≤20 MB | **Pendiente**: incorporar archivo o enlace público y comprobar tamaño |
| Video opcional | Sin enlace incorporado |
| Track A | [Endpoint, simulador y latencia](#api-y-prueba-de-fuego) |

## Contribuir y trabajar con agentes

Lee primero [AGENTS.md](AGENTS.md) y el `AGENTS.md` del directorio que vas a modificar. Allí están las reglas de mantenimiento, seguridad y autorización. Revisa `git status` y conserva el trabajo existente.

| Si cambias… | Edita la fuente | Generación / guía |
| --- | --- | --- |
| Operaciones o modelos HTTP | [OpenAPI](packages/contracts/openapi.yaml) | `npm run contracts:validate` y `npm run contracts:generate`; [contratos](docs/contratos.md) |
| Diseño o identidad | [tokens.json](packages/design-tokens/tokens.json) y [brand.json](packages/design-tokens/brand.json) | `npm run tokens:generate`; [salidas generadas](packages/design-tokens/README.md) |
| Consola web | [apps/web/src](apps/web/src) | [Reglas React](apps/web/AGENTS.md) |
| Cliente Android | [apps/mobile](apps/mobile) | [Reglas Flutter](apps/mobile/AGENTS.md) |
| Motor, decisiones o sesiones | [services/evacuation](services/evacuation) | [Reglas Go](services/evacuation/AGENTS.md) |

Después de regenerar contratos o diseño, ejecuta `npm run generated:check`. Las salidas generadas se verifican desde sus fuentes. Usa las tareas de la raíz y las pruebas apropiadas al cambio; informa comandos, fallos y omisiones.

Las guías actuales de la tabla siguiente describen el comportamiento vigente. Los informes FASE 1–8 y el evaluador FASE 1 conservan evidencia histórica. Las credenciales y los reportes privados permanecen fuera de Git. Crear commits, hacer push y operar AWS requiere autorización expresa según [AGENTS.md](AGENTS.md).

## Documentación y estructura

| Tema | Fuente |
| --- | --- |
| Componentes, flujo y decisiones | [Arquitectura](docs/arquitectura.md) |
| Desarrollo local, Docker, AWS y CloudWatch | [Despliegue](docs/despliegue.md) |
| Reglas, cumplimiento, reproducción y medición | [Reglas de simulación](docs/reglas-simulacion.md) · [pruebas](docs/pruebas.md) |
| Predicción, refugios y flota | [Nivel PRO](docs/nivel-pro.md) |
| HTTP, autenticación y tipos generados | [Contratos](docs/contratos.md) |
| Costos y pendientes | [Costos](docs/costos.md) · [limitaciones](docs/limitaciones.md) |
| Geografía, datos, hidráulica e informes de fases | [Índice técnico](docs/INDEX.md) |

El monorepo concentra Go en `services/evacuation`, React en `apps/web`, Android en `apps/mobile`, recursos compartidos en `packages`, automatización en `tools` y artefactos de despliegue en `deploy`.

## Autoría

Soy [corozodev](https://github.com/corozodev), único integrante de **CoroDev**. Desarrollé MantaSim con apoyo de asistentes de IA para implementación, revisión y documentación. El historial del repositorio conserva la evolución del proyecto. OpenStreetMap, GeoManta y SNGR/CONAGE mantienen su [procedencia y atribución](docs/datos-oficiales-y-demo.md).
