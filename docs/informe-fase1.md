# Informe técnico — FASE 1

> Informe histórico de la versión indicada. Los resultados se conservan; los flujos, despliegue y componentes vigentes están en [arquitectura](arquitectura.md) y [pruebas](pruebas.md).

Entrega local del 26 de octubre de 2026, CoroDev. Alcance: Track A, Escape de Manta Zombie. No se inició FASE 2, no se desplegó AWS y no se inicializó Git ni se crearon commits.

## 1. Implementado

Vertical slice ejecutable: grafo real OSM de Manta de 300 nodos/325 aristas/cuatro refugios ficticios; motor Dijkstra determinista; simulador con cuatro tipos de zombie, bloqueos, mordidas y capacidad; decisiones mediante HTTP real; observación React y Flutter; contratos generados; pruebas y mediciones reproducibles.

Se reutilizaron los clientes, tema, navegación, formularios, TanStack Query, Riverpod/Dio, codegen y API mock. No se añadieron dependencias de runtime ni infraestructura de datos. El modo mock conserva fixtures sintéticas explícitas.

## 2. Arquitectura y directorios

Monolito modular Go, biblioteca estándar, un único escritor autoritativo. `internal/world` define modelos y Store concurrente de copias profundas; `graph` carga/valida; `simulation` conserva estado privado y reglas; `decision` solo consume observaciones; `httpapi` autentica y valida; `application` compone servidor y cliente HTTP; `cmd/{server,sim,bench}` ofrece ejecución normal, acelerada y medición.

Grafo/entrada OSM/procedencia en `services/evacuation/data`; rondas en `scenarios`; mediciones en `reports`. OpenAPI y JSON Schema están en `packages/contracts`; clientes en `apps/{web,mobile}`; importador en `tools/geo`; QA HTTP en `tools/qa`. Ver [arquitectura](arquitectura.md) y [README](../README.md).

El simulador publica después de mover zombies, consulta `/paso` concurrentemente y aplica respuestas en orden por ID. Publica de nuevo tras colisiones/refugios. Sleepers dormidos, PRNG y eventos futuros nunca llegan al motor ni a los clientes. Cada solicitud usa un snapshot y no muta el estado autoritativo.

## 3. Resultados de subagentes

| Especialista | Entrega y archivos principales | Verificación / dificultad resuelta |
| --- | --- | --- |
| A: arquitectura/contratos | `world/{models,store}.go`, OpenAPI, codegen TypeScript/Dart/JSON Schema, ejemplos, auditoría/arquitectura | Generación, tipos y race del Store correctos; amplió generador Dart manteniendo JSON snake_case |
| B: geografía | `internal/graph`, `data/manta*`, `tools/geo`, `docs/grafo.md` | 3 pruebas Python y race Go; Overpass falló y la API Map oficial permitió obtener datos reales |
| C: simulación | `internal/simulation`, tres escenarios, reglas | 20 pruebas principales con subcasos y race; clasificación de timeouts incluso con cuerpo HTTP detenido |
| D: algoritmos | `internal/decision`, pruebas, `docs/algoritmo.md` | 14 pruebas y race; caché compartida, invalidación por contenido y salida de emergencia cuando no hay refugio accesible |
| E: integración clientes/QA | Adaptadores/vistas/tests web/móvil, mock, `tools/qa` | Web 19/mock 40, Flutter 19, análisis/build APK, contratos y navegador/Dart contra Go real |

A estabilizó interfaces antes de B/C/D. El límite de cuatro plazas se resolvió escalonando D y E. Solo A editó contratos hasta estabilizarlos; cada especialista tuvo archivos exclusivos. El coordinador implementó transporte Go, composición, comandos, pruebas completas HTTP, revisión cruzada y documentación final. La revisión detectó y corrigió límites de cuerpo lento, errores de lectura mal clasificados, coherencia del número de refugios y espera innecesaria bajo amenaza.

## 4. Endpoints

- `POST /paso`: `x-api-key`, cuerpo exacto `{sobrevivienteId,nodoActual,turno}`, respuesta exacta `{siguienteNodo}`; vecino transitable o espera.
- `GET /estado`: turno, observaciones, sobrevivientes, ocupación, cierres, eventos y métricas.
- `GET /grafo`: grafo base y versión.
- `GET /healthz`: disponibilidad del proceso.

Estado/grafo son públicos para desarrollo local y CORS configurable. La clave solo se usa en servidor. No hay endpoints administrativos. `/ws/estado` queda pendiente y los clientes usan polling cada dos segundos. La API mock mantiene las operaciones demo previas y añade observación sintética. Ver [contratos](contratos.md).

## 5. Pruebas y resultados

Aprobados: OpenAPI/generación consistente, TypeScript/ESLint, 19 pruebas React, 40 mock, 50 pruebas principales Go y subcasos con `-race`, `go vet`, builds Go/web/mock, 3 pruebas Python, 8 pruebas Playwright demo escritorio/móvil. Flutter analyze limpio, 19 pruebas, APK debug compilado; dos integraciones condicionadas omitidas en la suite normal y la de mundo Go ejecutada explícitamente con éxito. No se afirma ejecución en un teléfono.

La prueba integrada ejecuta dos rondas 3 completas, 150 turnos/200 sobrevivientes, a través de HTTP real y compara estados/eventos/bloqueos/métricas excluyendo solo latencias. No hubo data races ni errores de solicitudes. Chromium y el repositorio Dart consumieron el grafo real de Go; el navegador mostró búsqueda y viewport de 390 px sin desborde ni envío de claves. Ver [evidencia detallada](pruebas.md).

## 6. Latencias y resultados medidos

Linux amd64, Go 1.26.1, GOMAXPROCS=12. Benchmark loopback real de 10.000 solicitudes, 200 sobrevivientes, concurrencia 16, snapshot estable y una solicitud de calentamiento por sobreviviente. Reloj monotónico, latencia incluye transporte/decodificación; percentiles de rango más próximo.

**p50 1,205 ms; p95 2,656 ms; p99 3,685 ms; máximo 8,262 ms**. Éxitos 10.000, inválidas 0, timeouts 0. Rendimiento observado 11.663,9 solicitudes/s. Cumple los objetivos en esta ejecución local; no se extrapola a AWS.

Rondas aceleradas completas, 150 turnos cada una:

| Ronda | Evacuados | Mordidos | Activos | HTTP exitosas | p95 ms |
| --- | --- | --- | --- | --- | --- |
| 1:20 sobrevivientes | 20 | 0 | 0 | 445 | 4,000 |
| 2:80 sobrevivientes | 23 | 22 | 35 | 6.376 | 4,015 |
| 3:200 sobrevivientes | 38 | 150 | 12 | 10.500 | 5,539 |

Todas con 0 inválidas/0 timeouts y disponibilidad observada 100%. Los reportes originales están en `services/evacuation/reports/` (evidencia privada, fuera de Git); `evidence.json` registra hashes de entradas/código. Las rondas, a diferencia del benchmark estable, incluyen movimiento, capacidad, invalidación y cierres dinámicos.

## 7. Pendientes y riesgos

- WebSocket no implementado; polling funcional disponible.
- La ronda 3 evacuó 38/200: la estrategia inicial necesita optimización de supervivencia; no se presenta como rendimiento óptimo.
- Sin predicción temporal avanzada ni asignación coordinada/reservas de plazas. Las solicitudes del mismo turno observan la misma ocupación y el simulador admite por ID.
- El mapa es una subred peatonal de corredores, no todas las calles. Una arista contraída equivale a un movimiento según el contrato; refugios/cantidades de zombies son supuestos de juego explícitos. El puente OSM existe; su colapso es ficticio.
- Observaciones públicas/locales, estado solo en memoria; publicación externa, HTTPS, política de acceso y secretos de despliegue requieren trabajo posterior. No hay operación administrativa que proteger en esta fase.
- APK validado por compilación, sin prueba en dispositivo; iOS no preparado. La integración HTTP demo condicionada anterior no fue ejecutada; sí sus pruebas unitarias y e2e web.

## 8. Comandos exactos

Desde `corodev-spooky`:

```sh
npm install
npm run contracts:generate
npm run tokens:generate
export API_KEY="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
npm run dev:backend
```

En otras terminales:

```sh
npm run dev:api
```

```sh
VITE_WORLD_API_BASE_URL=http://localhost:8080 npm run dev:web
```

Abrir `http://localhost:5173/escape`. Para una demostración acelerada independiente, sin claves ni servidores manuales:

```sh
npm run simulate -- -scenario scenarios/round3.json -output reports/round3.json
npm run test:contracts:http
npm run test:race
npm run bench:backend -- -requests 10000 -concurrency 16 -output reports/http-benchmark.json
```

El README contiene Flutter, variables, generación offline del grafo y el resto de pruebas. Los argumentos de ruta de los comandos Go son relativos a `services/evacuation`.

## 9. FASE 2 recomendada

Priorizar supervivencia frente a runners mediante predicción observable y evaluación multisemilla; coordinar capacidad de refugios; comparar grafos menos reducidos; completar WebSocket y UX; después preparar contenedor persistente EC2, HTTPS/secretos, costos/Budget y pitch. No se inició ninguna de estas tareas. Ver [roadmap](limitaciones.md).
