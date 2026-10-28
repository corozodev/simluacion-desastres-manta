# CoroDev · Escape de Manta Zombie

**MantaSim — AWS Hackathon, Track A.** Evacuación de múltiples sobrevivientes sobre una muestra vial real de Manta, con amenazas móviles, bloqueos y replanificación. React inicia y observa simulaciones; Flutter Android y React móvil comparten su estado como espectadores.

**[Abrir demo pública](https://sistemamanta.lexinnovate.com/escape)** · [Visor móvil](https://sistemamanta.lexinnovate.com/mobile) · [API health](https://api.sistemamanta.lexinnovate.com/healthz) · [Repositorio](https://github.com/corozodev/simluacion-desastres-manta)

Índice: [funciones](#funciones) · [demo](#demo-en-cinco-minutos) · [local](#inicio-local) · [arquitectura](#arquitectura) · [API](#api-paso) · [evaluación](#simulación-y-evaluación) · [PRO](#nivel-pro--capacidades-avanzadas) · [AWS](#aws-y-costos) · [límites](#limitaciones-y-entrega) · [documentación](#repositorio-y-documentación).

## Funciones

| Categoría | Implementación |
| --- | --- |
| Track A base | BASE: 300 intersecciones, 383 aristas, cuatro refugios ficticios, cuatro tipos de zombie, mordidas por nodo/cruce y cierres. Tres rondas de 20/80/200 sobrevivientes, 150 turnos de 2 s. |
| Routing | Plan determinista por snapshot, asignación de refugios, reservas y replanificación sobre calles transitables. Alternativas comparables conservan sus regresiones medidas. |
| Nivel PRO | Predicción observable de corredores, capacidad/reservas y flota experimental 5 × 4. [Estado y límites PRO](docs/nivel-pro.md). |
| Clientes | Mapa vivo React, rutas seleccionables, configuración e inicio manual, pausa/reanudación; espectadores `/mobile` y Android sin control de motores. |
| Extensiones | Inundación hidráulica 2D sobre relieve sintético; laboratorio, reportes ciudadanos persistentes y referencia SNGR separada. FULL_MANTA (9.179 nodos) es opcional y experimental. |

Las extensiones no acreditan puntos del núcleo zombie. La geografía vial proviene de OSM; los refugios y desastres simulados no representan instalaciones habilitadas ni alertas reales.

## Demo en cinco minutos

Versión publicada en AWS el 27 de octubre de 2026: [`47f51fa`](https://github.com/corozodev/simluacion-desastres-manta/commit/47f51fa3ec3d00f19874de50703b4fabc013de37). Se verificaron por HTTPS el inicio, avance, pausa, cancelación repetida y reinicio de inundaciones. [Registro del despliegue](deploy/deployment-delivery-20261027.json).

1. **0:00–0:45:** abrir [Escape](https://sistemamanta.lexinnovate.com/escape). Explorar BASE antes de iniciar; abrir la página no crea una simulación.
2. **0:45–2:00:** configurar una ronda y pulsar **Iniciar simulación**. Seleccionar un sobreviviente para ver su ruta; observar zombies, bloqueos y ocupación de refugios. Cada sesión posee su propio motor.
3. **2:00–3:30:** mostrar el [procedimiento PRO](docs/nivel-pro.md): pronóstico observable, plazas y flota experimental. La flota no pertenece a `official`; el riesgo estimado no es una trayectoria segura.
4. **3:30–4:30:** abrir `/mobile` o Android para observar la ejecución publicada. Mostrar `/flood-lab` como extensión; **Iniciar tormenta** es explícito y usa datos hidráulicos sintéticos.
5. **4:30–5:00:** presentar [pruebas](docs/pruebas.md), arquitectura y costos. No esperar una ronda nominal completa durante el pitch.

La demo pública no requiere login de operador. El selector ofrece BASE y FULL_MANTA sólo cuando el servidor lo habilita. Los espectadores conservan el final durante su retención y no reinician motores.

## Inicio local

Requisitos: Node ≥22.12, npm ≥10, Go ≥1.23, Python 3 y GNU Make. Flutter/Android y Docker son opcionales para la demo web. Desde la raíz:

```sh
make help
make setup
make dev
```

Abrir `http://127.0.0.1:5173/escape`; laboratorio `/flood-lab`; visor `/mobile`. API Go en `127.0.0.1:8080`, laboratorio en `127.0.0.1:8082`. El motor comienza sólo al pulsar el control correspondiente.

`setup` conserva configuraciones existentes y genera una clave local privada. `dev` reutiliza el lanzador existente, sin AWS ni mock. **Ctrl+C** o `make stop` detienen sus tres procesos sin borrar reportes. En otra terminal: `make smoke`, `make test` o `make verify`. [Configuración, recuperación y Flutter](docs/development/local-setup.md).

## Arquitectura

![Arquitectura de MantaSim: clientes, AWS y motores internos](docs/arquitectura.svg)

Go es un monolito modular: el simulador es el único escritor y publica snapshots inmutables; el planificador sólo observa. Cada sesión aísla RNG, cachés, overlays y HTTP autenticado de decisión. Los clientes consultan estado compacto por polling y obtienen la geografía por separado. El laboratorio conserva un proceso independiente y persiste reportes en archivos privados; las sesiones viven en RAM.

[Arquitectura y flujo](docs/arquitectura.md) · [fuente editable del diagrama](docs/arquitectura.mmd) · [decisión del monorepo](docs/decisions/ADR-001-monorepo.md).

## API /paso

`POST /paso`, `Content-Type: application/json`, cabecera privada `x-api-key`:

```json
{"sobrevivienteId":"S-0089","nodoActual":"N-0117","turno":142}
```

```json
{"siguienteNodo":"N-0118"}
```

Estos IDs ilustran el contrato: usar IDs, nodo y turno reales del **mismo runtime**. La respuesta permite esperar o avanzar a un vecino transitable. `/paso` no mueve el mundo ni reserva plazas. Go valida autenticación, entrada y coherencia; un fallo de la llamada deja al agente esperando.

Con `make dev` activo, `make smoke` comprueba `401` sin clave y `200` autenticado sin mostrarla. `npm run test:contracts:http` crea un servidor temporal y valida respuestas y errores contra el esquema generado. Ejemplo copiable de `curl` y provisión privada de la clave al jurado: [contratos](docs/contratos.md).

**Ámbitos:** `/estado` y `/paso` públicos conservan un runtime de compatibilidad preparado e inactivo. El mapa observa `/v1/simulations/...`; sus motores consultan su propio `/paso` autenticado por loopback. No mezclar el turno de una sesión con `/estado`. No hay WebSocket implementado.

## Simulación y evaluación

```sh
# Ronda completa acelerada, HTTP real y concurrencia del preset
npm run simulate -- -scenario scenarios/urban/round3.json -seed 42
# La misma ronda al ritmo nominal de cinco minutos
npm run simulate -- -scenario scenarios/urban/round3.json -seed 42 -interval 2s
# Latencia HTTP local concurrente
npm run bench:backend
```

La [metodología](docs/pruebas.md) reúne las tres rondas secuenciales de 15 minutos, comparación, supervivencia ponderada, eficiencia, percentiles HTTP, errores y rúbrica. Las rondas aceleradas conservan 150 turnos; su tiempo medido no equivale al reloj nominal. Semilla/configuración/grafo iguales deben reproducir resultados lógicos, excluyendo tiempos HTTP.

`npm run compare:agents` usa HTTP real y conserva resultados adversos. El evaluador FASE 1 permanece congelado; los [informes históricos](docs/INDEX.md) distinguen cambios geográficos y algorítmicos. Los benchmarks locales no acreditan capacidad EC2.

## Nivel PRO — Capacidades avanzadas

| Capacidad | Estado verificable y observación |
| --- | --- |
| Predicción | Implementada sobre observaciones de corredores; capa de riesgo estimado a dos turnos y estrategias que lo usan. Sin sleepers ocultos ni probabilidades calibradas. |
| Refugios | Capacidad, ocupación, reservas y disponibilidad coherentes; asignación global antes de `/paso`, revalidación por el escritor y pruebas concurrentes. React muestra capacidad y plazas libres. |
| Rescate | Cinco camionetas experimentales, cuatro plazas cada una, rutas transitables y evacuación sólo tras entrega. Dos aristas por turno frente a una peatonal; falta acreditar doble velocidad física por distancia/tipo de vía. |

Preparación PRO requiere código, prueba y demostración observable. [Implementación y demo reproducible](docs/nivel-pro.md) · [matriz BASE/PRO y regresiones](docs/pruebas.md).

## AWS y costos

Inventario confirmado por lectura AWS el 27 de octubre: **us-east-2 (Ohio), EC2 `m7i-flex.large`, 2 vCPU / 8 GiB y EBS cifrado de 20 GiB**. Caddy termina HTTPS y da entrada a Go/laboratorio. Web en **S3 privado + CloudFront**, con ACM; DNS externo en Cloudflare. SSM y CloudWatch apoyan operación y logs. La plantilla inicial conserva tamaños anteriores: no es inventario del host actual.

[Despliegue, secretos, health, logs y rollback](docs/despliegue.md) · [costos y fuentes](docs/costos.md). La web, API y build publicados se verificaron por HTTPS. La actualización conservó infraestructura, credenciales y datos; el registro detalla su alcance.

La proyección modelada es **77,68 USD/mes**, antes de descuentos y con supuestos de uso pequeño: [desglose y exclusiones](docs/costos.md). La EC2 sola a 730 h supera el Budget verificado de 50 USD. **Gasto real del evento: pendiente de Billing. Captura AWS Budget: pendiente del propietario en `docs/budget.png`.** Revisar datos sensibles antes de incorporarla.

<!-- Al añadir la captura auténtica y revisada, sustituir el texto pendiente por:
![AWS Budget con alerta configurada](docs/budget.png)
No crear una imagen ficticia ni un PNG vacío. -->

## Limitaciones y entrega

BASE es una muestra urbana, no cobertura completa. FULL_MANTA es experimental. Reiniciar Go pierde las sesiones en RAM. Predicción/flota pueden empeorar resultados; inundación usa relieve/lluvia sintéticos. Android compilado y Chromium móvil no acreditan Safari real ni capacidad EC2. [Limitaciones y pendientes verificables](docs/limitaciones.md).

Entrega **miércoles 28 de octubre de 2026, 10:00 Ecuador**; pitch **viernes 30 de octubre, ULEAM**. Antes de publicar: revisar diff e historial real, ejecutar verificaciones, incorporar Budget auténtico y gasto real, confirmar URL y adjuntar presentación PDF/PPT/PPTX ≤20 MB. La publicación Git y AWS de esta versión fue autorizada y ejecutada; las diapositivas y evidencias pendientes corresponden al propietario. [Lista de entrega](docs/limitaciones.md).

## Repositorio y documentación

| Ruta | Responsabilidad |
| --- | --- |
| `services/evacuation` | Go: API, zombies, routing, sesiones y laboratorio hidráulico |
| `apps/web` | React/TypeScript: consola y visor móvil |
| `apps/mobile` | Flutter Android: espectador y reportes ciudadanos |
| `packages/contracts/openapi.yaml` | Fuente HTTP; genera TypeScript, Dart y JSON Schema |
| `packages/design-tokens` | Identidad y tokens compartidos generados |
| `tools`, `deploy` | Desarrollo, QA, importación offline y artefactos AWS |
| `services/mock-api` | Compatibilidad/pruebas starter, fuera de los clientes actuales |

**[Índice documental](docs/INDEX.md)** · [pruebas](docs/pruebas.md) · [contratos](docs/contratos.md) · [instrucciones para agentes](AGENTS.md).

Equipo **CoroDev**, un integrante: [corozodev](https://github.com/corozodev). Agradecimientos a OpenStreetMap y sus colaboradores, GeoManta, SNGR/CONAGE y las comunidades Go, React, Flutter y AWS. [Procedencia geográfica](docs/grafo-fase2.md) · [fuentes y atribución](docs/datos-oficiales-y-demo.md).
