#!/usr/bin/env python3
"""Generate the Phase 2 report from measured, private local evaluation artifacts."""
import collections
import hashlib
import json
from pathlib import Path
import re
import statistics

ROOT = Path(__file__).resolve().parents[2]
REPORTS = ROOT / 'services/evacuation/reports/phase2'


def read(name):
    return json.loads((REPORTS / name).read_text())


def round_number(result):
    return int(re.search(r'Ronda (\d)', result['scenario']).group(1))


def mean(rows, getter):
    return statistics.mean(getter(row) for row in rows)


def ema(row):
    m = row['metrics']
    return f"{m['evacuated']}/{m['bitten']}/{m['active']}"


def main():
    baseline = read('baseline/results.json')
    geography = read('geography/results.json')
    expanded = read('expanded-geography/results.json')
    urban = read('urban/results.json')
    assert len(baseline) == len(geography) == len(expanded) == 9 and len(urban) == 36
    grouped = collections.defaultdict(list)
    for row in urban:
        grouped[(round_number(row), row['seed'])].append(row)
    for rows in grouped.values():
        assert len({r['initial_state_sha256'] for r in rows}) == 1
        assert len({r['graph_sha256'] for r in rows}) == 1
        assert len({json.dumps(r['config'], sort_keys=True) for r in rows}) == 1
    all_cases = baseline + geography + expanded + urban
    for row in all_cases:
        m = row['metrics']
        assert m['turns'] == 150
        assert m['evacuated'] + m['bitten'] + m['active'] == row['config']['survivors']
        assert m['requests_invalid'] == m['requests_timeout'] == 0
    geo_table = []
    for a, b, c in zip(baseline, geography, expanded):
        assert (a['seed'], round_number(a)) == (b['seed'], round_number(b)) == (c['seed'], round_number(c))
        geo_table.append(f"| {round_number(a)} | {a['seed']} | {ema(a)} | {ema(b)} | {ema(c)} |")
    urban_table = []
    for key, rows in sorted(grouped.items()):
        variants = {r['strategy']: r for r in rows}
        urban_table.append(f"| {key[0]} | {key[1]} | " + ' | '.join(ema(variants[v]) for v in ['phase1', 'improved', 'no-prediction', 'no-reservations']) + ' |')
    aggregate = []
    for rnd in range(1, 4):
        for strategy in ['phase1', 'improved', 'no-prediction', 'no-reservations']:
            rows = [r for r in urban if round_number(r) == rnd and r['strategy'] == strategy]
            aggregate.append(f"| {rnd} | {strategy} | {mean(rows,lambda r:r['metrics']['evacuated']):.2f} | {mean(rows,lambda r:r['metrics']['bitten']):.2f} | {mean(rows,lambda r:r['metrics']['active']):.2f} | {100*mean(rows,lambda r:r['alive_ratio']):.2f}% | {mean(rows,lambda r:r['diagnostics']['summary']['mean_evacuation_turn']):.2f} | {mean(rows,lambda r:r['diagnostics']['summary']['mean_route_efficiency']):.3f} |")
    timing_table = []
    for rnd in range(1, 4):
        for strategy in ['phase1', 'improved', 'no-prediction', 'no-reservations']:
            rows = [r for r in urban if round_number(r) == rnd and r['strategy'] == strategy]
            timing_table.append(f"| {rnd} | {strategy} | {mean(rows,lambda r:r['diagnostics']['summary']['stationary_turns']):.1f} | {mean(rows,lambda r:r['diagnostics']['summary']['no_route_turns']):.1f} | {max(r['metrics']['http_p95_ms'] for r in rows):.3f} |")
    bench = [read(name) for name in ['http-16.json', 'http-sustained-200.json', 'http-burst-200.json']]
    bench_table = []
    for label, b in zip(['Sostenida 16', 'Sostenida 200', 'Ráfagas de 200'], bench):
        assert b['requests_success'] == 10000 and not b['requests_invalid'] and not b['requests_timeout']
        bench_table.append(f"| {label} | {b['http_p50_ms']:.3f} | {b['http_p95_ms']:.3f} | {b['http_p99_ms']:.3f} | {b['http_max_ms']:.3f} | 100% |")
    improved = [r for r in urban if r['strategy'] == 'improved']
    no_prediction = [r for r in urban if r['strategy'] == 'no-prediction']
    fp = sum(r['prediction_audit']['false_positive_candidates'] for r in improved)
    candidates = sum(r['prediction_audit']['candidate_nodes'] for r in improved)
    missed = sum(r['prediction_audit']['missed_actual_nodes'] for r in improved)
    avoided_net = sum(r['metrics']['bitten'] for r in no_prediction) - sum(r['metrics']['bitten'] for r in improved)
    deaths = collections.defaultdict(collections.Counter)
    for row in improved:
        for bite in row['diagnostics']['bites']:
            deaths[round_number(row)][(bite['zombie_type'], bite['mechanism'])] += 1
    max_planning = max(r['diagnostics']['timings']['planning']['p95_ms'] for r in urban)
    max_publication = max(r['diagnostics']['timings']['publication']['p95_ms'] for r in urban)
    max_turn = max(r['diagnostics']['timings']['turn']['p95_ms'] for r in urban)
    max_snapshot = max(r['server_timings']['snapshot']['p95_ms'] for r in urban)
    funcs = sum(len(re.findall(r'^func Test', p.read_text(), re.M)) for p in (ROOT/'services/evacuation/internal').rglob('*_test.go'))
    image = json.loads((ROOT/'deploy/validation-phase2-final.json').read_text())
    total_requests = sum(r['metrics']['requests_success'] for r in all_cases)
    text = '''# Informe FASE 2 — Manta, rutas y preparación AWS

Entrega local del 26 de octubre de 2026, America/Guayaquil. Código funcional, datos OSM y mediciones; no se inició FASE3. El informe, datos y motor de FASE1 se conservan. No se inicializó Git ni se crearon commits. Este documento se genera de JSON reales con `python3 tools/qa/report_phase2.py`.

## A. Diagnóstico inicial

Se reprodujo exactamente la semilla20261028: **38 evacuados,150 mordidos,12 activos** en150turnos. Son50vivos(25%), mientras que solo19% llegó al refugio. Hubo8034turnos inmóviles y9751turnos sin ruta observable segura;101mordidas fueron de runners,38 de walkers,10 de sleepers despiertos y1 de horda. Todas fueron por coincidencia final de nodo; no se mezcló mecanismo con tipo de zombie. Quedaron202plazas vacías y ningún refugio lleno: capacidad total no era el principal cuello de botella de esa ejecución.

El mapa300/325 tenía225articulaciones,226puentes de grafo y26ciclos. Las3hordas iniciales dejaban95/300nodos sin acceso a refugio. También había26coincidencias iniciales sobreviviente/zombie. La hipótesis geográfica queda respaldada por estas mediciones, pero no explica sola las muertes por runners. Ver [diagnóstico geográfico](diagnostico-geografico.md) y [diagnóstico de supervivencia](diagnostico-supervivencia.md).

## B. Nuevo mapa y sus límites

| Variante | Nodos | Aristas | Longitud vial km | Articulaciones | Puentes de grafo | Ciclos |
| --- | --- | --- | --- | --- | --- | --- |
| v1 histórico | 300 | 325 | 24.952 | 225 | 226 | 26 |
| v2 operativo | 300 | 383 | 43.196 | 158 | 136 | 84 |
| Ampliado experimental | 1000 | 1599 | 137.338 | 118 | 100 | 600 |
| Maestro urbano | 9179 | 13452 | 972.521 | 1578 | 1794 | 4274 |

Se adquirieron25teselas OSM completas y polígonos públicos de GeoManta. El maestro abarca las seis parroquias marcadas urbanas por esa fuente; no toda Manabí ni todo el cantón rural. Hay fuente comprimida, checksum, geometrías y trazabilidad por segmento. Se preservaron conexiones troncales reales hacia San Mateo que un filtro anterior omitía. Ninguna arista operativa omite una intersección real; no se conectaron nodos por mera proximidad.

**El operativo no representa todas las calles de Manta:** contiene4,44%de la longitud vial del maestro. La exigencia de aproximadamente300nodos limita simultáneamente cobertura y alternativas. La envolvente gráfica es una referencia visual, no un límite municipal exacto. El ampliado no se activa automáticamente.

Más ciclos no garantizan robustez ante cualquier ataque: el peor corte de dos aristas deja65/300nodos sin refugio en v2 frente a37/300en v1; la peor horda deja93/300frente a44/300. En ampliado esos valores bajan a39/1000y45/1000. No se ajustó la topología usando las semillas de evacuación. Ver [fuentes, geometría, refugios y compromisos](grafo-fase2.md).

## C. Escenarios y comparabilidad

`scenarios/urban/round{1,2,3}.json` tiene20/80/200sobrevivientes y150turnos. Los orígenes son polígonos municipales verificables: Tarqui Centro, Los Esteros, Barbasquillo y Jocay. La distribución inicial es equilibrada y configurable; zombies se distribuyen por el territorio operativo. La navegación puede salir de la zona inicial. Capacidades asumidas:60por refugio,240en total. Refugios ficticios y ubicaciones están publicados en la documentación geográfica.

Las cantidades zombie se conservaron: ronda1=8walkers; ronda2=12walkers+4runners+2hordas; ronda3=20walkers+8runners+3hordas+10sleepers. El puente físico de ronda2 es `E-4420ceab96c993b4`; el colapso es ficticio. Ronda3bloquea dos calles. Las reglas de movimiento/mordida/visibilidad/duración no cambiaron.

Se predeclararon semillas `historical,7,42`. Histórica corresponde a20261026/20261027/20261028según ronda. El replay conserva posiciones/refugios históricos mediante remapeos geográficos registrados y el avance inicial de PRNG; con el mismo grafo reproduce38/150/12. La topología puede alterar persecuciones posteriores. Los escenarios urbanos cambian deliberadamente refugios y condiciones iniciales para utilizar las cuatro zonas y evitar coincidencias imposibles; su mejora no se atribuye solo al algoritmo.

## D. Algoritmos e integración

Producción mantiene un único motor determinista con opciones. Dijkstra inverso compartido por refugio combina turnos, distancia/velocidad y riesgo estimado finito. Se respetan bloqueos, hordas y todos sus vecinos, posiciones zombies actuales y cruces opuestos de cada segmento runner. Solo se cruza una arista por turno. El predictor matemático desacoplado estima posiciones/transiciones a1–2turnos a partir de información observable; la envolvente futura es riesgo, no una prohibición absoluta ni una garantía.

Las cachés inmutables separan búsqueda de ruta y cambios de objetivos del pronóstico; se reutilizan búsquedas por contenido real, no se invalidan solo por cambiar world_version. Se conservan rutas seguras dentro de histéresis acotada. Una llegada segura al refugio se evalúa antes de la fase zombie siguiente.

El coordinador prepara asignaciones/reservas antes de publicar. Usa escasez/regret e histéresis15%, sin sobreasignar. La simulación mantiene autoridad sobre posiciones/capacidad/ocupación, libera reservas y convierte la reserva en ocupación. Un escape no reserva plaza. `/paso` solo lee el plan coherente. El motor FASE1 permanece congelado exclusivamente en `internal/evaluation/phase1`.

A geografía, B diagnóstico/simulación, C rutas/predictor, D coordinación y E infraestructura/clientes trabajaron con archivos exclusivos; el coordinador estabilizó contratos, evaluador, HTTP, integración, regresiones y medición. Ver [algoritmo](algoritmo-fase2.md), [reservas](refugios-fase2.md) y [reglas](reglas-simulacion.md).

## E. Evaluación comparativa

### Experimento A: solo geografía

Motor histórico congelado, misma semilla/cantidades/reglas/capacidad y150turnos. Refugios y apariciones históricos se remapean y cada distancia se registra en JSON. **E/M/A = evacuados/mordidos/vivos no evacuados**.

| Ronda | Semilla | v1 E/M/A | v2 E/M/A | Ampliado E/M/A |
| --- | --- | --- | --- | --- |
''' + '\n'.join(geo_table) + '''

En la semilla histórica de ronda3, cambiar mapa elevó evacuados38→58 en300nodos y129en el ampliado, con el mismo motor. No es universal: en semilla7ronda3, v2 evacuó35frente a39de v1. El promedio de evacuados de ronda3 sube31→52,67, pero vivos medios bajan56→53,33. La ampliación1000 obtuvo129,67evacuados medios y133,67vivos. Queda demostrada la influencia de la topología sin confundir mayor evacuación con mayor supervivencia.

### Experimentos B/C/D: mismo v2 y protocolo urbano

Por cada ronda/semilla, las cuatro variantes tienen idénticos hashes de grafo, configuración y estado inicial. `phase1` es motor original sobre las condiciones urbanas nuevas; `improved` activa predicción y coordinación; `no-prediction` desactiva solo predicción; `no-reservations` elimina el hook global, conservando motor/predictor.

| Ronda | Semilla | Original E/M/A | Nuevo E/M/A | Sin predicción E/M/A | Sin reservas E/M/A |
| --- | --- | --- | --- | --- | --- |
''' + '\n'.join(urban_table) + '''

Promedios sobre las tres semillas, sin elegir únicamente ejecuciones favorables:

| Ronda | Variante | Evacuados | Mordidos | Activos | Total vivo | Turno medio de evacuación | Eficiencia media |
| --- | --- | --- | --- | --- | --- | --- | --- |
''' + '\n'.join(aggregate) + '''

La eficiencia es promedio por ejecución respecto a distancia inicial al refugio más próximo sin zombies; puede diferir del destino final. No es una solución óptima conjunta. En ronda3, el nuevo motor pasa de133,33a136evacuados medios y de159,33a175,67vivos medios:68%evacuados y87,83%vivos. Esta comparación aísla algoritmo; no equipara directamente38históricos con132urbanos de la semilla histórica.

Regresión explícita: en ronda2semilla7, predicción activada dio59evacuados/7mordidos/14activos; desactivada,76/1/3. En ronda3histórica, el original urbano evacuó138frente a132del nuevo, aunque el nuevo dejó159vivos frente a138. Se conserva la configuración global por mayor supervivencia agregada, sin afirmar dominio por semilla ni optimalidad.

| Ronda | Variante | Inmovilidad acumulada media | Turnos sin ruta media | Máximo p95 HTTP de las semillas ms |
| --- | --- | --- | --- | --- |
''' + '\n'.join(timing_table) + f'''

La ausencia de rutas se desglosa por geografía, calles, amenazas y capacidad en cada informe; los mecanismos/tipos de mordida y tiempos por sobreviviente están registrados. Todos los{len(all_cases)}ensayos finales, {len(all_cases)*150}turnos y{total_requests}solicitudes de simulación tuvieron0inválidas/0timeouts y conservaron poblaciones. La disponibilidad medida es éxito/total, no un SLA externo.

### Auditoría de predicción y límites causales

En las nueve ejecuciones nuevas hubo{fp}candidatos de posición futura no ocupados sobre{candidates}candidatos y{missed}posiciones reales de runner no cubiertas. Es una envolvente de posibilidades, no predicciones simultáneas: su amplia cobertura puede generar desvíos innecesarios. Con/sin predicción hubo una diferencia neta de{avoided_net}mordidas menos al activarla. No se presenta ese delta como{avoided_net}intercepciones individuales demostradas: las decisiones cambian persecuciones y trayectorias posteriores. La regresión de ronda2documenta el costo real de sobreestimar riesgo.

No se calcula una puntuación oficial de prueba de fuego: el material aportado no incluye pesos/fórmula suficientes. Las proporciones medidas se publican sin inventar una rúbrica.

## F. Rendimiento y calidad

Benchmarks finales secuenciales, sin otros tests del proyecto en paralelo: Linux amd64, Go1.26.1, GOMAXPROCS12, v2,200sobrevivientes activos,10.000solicitudes por carga, una de calentamiento por sobreviviente. HTTP loopback real, reloj monotónico, incluye transporte/decodificación; percentiles de rango más próximo. El snapshot permanece estable; los ensayos150turnos complementan con replanificación/cierres/capacidad.

| Carga | p50 ms | p95 ms | p99 ms | Máximo ms | Disponibilidad |
| --- | --- | --- | --- | --- | --- |
''' + '\n'.join(bench_table) + f'''

Las30.000solicitudes medidas tuvieron0errores/0timeouts; p95≤150ms y máximo<500ms en esta máquina. El benchmark previo a la corrección de bind se conserva en `http-before-ipv4-regression-fix`; la tabla usa la medición final cronológica, no el resultado más favorable.

En las rondas urbanas se separaron tiempos: máximo p95 de planificación{max_planning:.3f}ms, publicación{max_publication:.3f}ms, turno{max_turn:.3f}ms y adquisición de snapshot{max_snapshot:.3f}ms. El motor histórico calcula en HTTP; la planificación del nuevo ocurre antes de publicar. Las cifras locales no equivalen a EC2.

Pasaron **{funcs}pruebas principales Go y subcasos con race**, vet/build,10Python,22React,40mock,8e2e escritorio/móvil, TypeScript/ESLint, generación consistente y builds web/mock. Flutter analyze limpio,21pruebas y2integraciones condicionadas omitidas en suite normal; la integración del mundo Go se ejecutó explícitamente con Chromium y Dart contra v1/v2. APK debug compilado; no se afirma prueba en dispositivo.

Docker detectó un defecto de integración real: un wildcard IPv4 anunciaba `::1` y el health200ocultaba200decisiones fallidas en un contenedor sin IPv6. Se corrigió el bootstrap para respetar IPv4, añadió regresión y se repitió el paquete. La imagen final `{image['image_id']}` ({image['image_size_bytes']/1024**2:.2f}MiB) pasó200decisiones internas, auth, vecinos/bloqueos, reservas, visibilidad y health, no-root/readonly,2CPU/1GB. La evidencia es `deploy/validation-phase2-final.json`.

## G. AWS

Preparados Docker multi-stage con digests, health, reinicio, HTTPS Caddy, CloudFormation EC2/S3privado/CloudFrontOAC/CloudWatch/Budget, IAM mínimo, release/rollback y documentación de red/secretos. La imagen final usa v2 y escenario urbano compatibles. **No se desplegó AWS:** faltan CLI/acceso autenticado, cuenta y región autorizadas. No existe URL pública comprobada, gasto real, Budget creado ni captura `budget.png`. No se inventaron esas evidencias.

Estimación ilustrativa documentada: **24,03USD/mes** para un ejemplo `us-east-1`,730horas, con fuentes oficiales y supuestos; no es cargo observado ni cotización. La región debe confirmarse antes de usar la plantilla; el Budget precede a recursos con consumo. Ver [despliegue/rollback](despliegue-aws.md), [costos](costos.md) y [diagrama](arquitectura.svg).

## H. Clientes

React conserva `/escape`, tema y Mock/HTTP. Ahora dibuja geometrías reales, polígonos de origen y envolvente de referencia, zoom/desplazamiento/reset, rutas seleccionadas, posición, próximo nodo, refugio, reservas y amenazas observadas. Sigue mostrando sobrevivientes fuera de su origen. El estado de conexión depende del mundo Go, sin requerir health del demo. Flutter conserva navegación y presenta mapa/ruta/detalles equivalentes. Ningún cliente recibe API keys privilegiadas ni sleepers dormidos; no hay controles de IA ficticios.

## I. Riesgos y límites abiertos

-300nodos no alcanzan para toda la vialidad urbana sin omitir intersecciones; el operativo es representativo y mantiene cuellos de botella. No se declara cobertura completa por ocupar una envolvente grande.
- Algunas personas vivas no llegan en150turnos; la coordinación greedy no garantiza costo óptimo y el predictor puede sobreestimar exposición. Se publican semillas/regresiones y ablations completas.
- Los escenarios urbanos usan nuevos orígenes/refugios y evitan coincidencias iniciales; comparar directamente su porcentaje con FASE1sin aislar factores sería incorrecto.
- Modelado peatonal OSM no sustituye verificación de aceras en terreno. Polígonos municipales y PDOT tienen versiones distintas, documentadas.
- Estado en memoria, observación pública local, sin WebSocket; polling funcional. Antes de publicación externa completar cuenta/región, DNS/HTTPS, política de acceso y medición sobre la instancia.
- No hay score oficial computable sin rúbrica suficiente ni prueba Android física/iOS. Reportes privados incluyen sleepers iniciales y deben mantenerse fuera del hosting público.

Se conservaron intermedios (`geography-intermediate-*`, `urban-prototype-*`, `urban-before-*`, `*-before-final-diagnostics`) porque cambiaron filtros de fuente o se corrigieron defectos concretos de admisión/escape/diagnóstico. No se usan para sustituir semillas finales ni ocultar resultados desfavorables.

## J. Reproducir y posibles acciones siguientes

Desde la raíz del monorepo:

```sh
npm install
npm run contracts:generate
npm run graph:generate
npm run graph:test
npm run check
npm test
npm run test:race
npm run build:web
npm run build:backend
npm run test:e2e
FLUTTER_BIN=/ruta/flutter/bin/flutter npm run test:contracts:http -- --urban --browser --flutter
npm run evaluate -- -graphs data/manta-v1.json -strategies phase1 -output reports/phase2/baseline
npm run evaluate -- -graphs data/manta-v2.json -strategies phase1 -output reports/phase2/geography
npm run evaluate -- -graphs data/manta-expanded.json -strategies phase1 -output reports/phase2/expanded-geography
npm run evaluate -- -protocol urban -graphs data/manta-v2.json -strategies phase1,improved,no-prediction,no-reservations -output reports/phase2/urban
npm run bench:backend -- -requests 10000 -concurrency 16 -output reports/phase2/http-16.json
npm run bench:backend -- -requests 10000 -concurrency 200 -output reports/phase2/http-sustained-200.json
npm run bench:backend -- -requests 10000 -concurrency 200 -burst -output reports/phase2/http-burst-200.json
docker build -t corodev-evacuation:phase2 -f services/evacuation/Dockerfile .
python3 tools/qa/verify_docker.py
python3 tools/qa/report_phase2.py
```

Los argumentos de rutas de wrappers Go son relativos a `services/evacuation`; reportes detallados son privados. Semillas, pesos, grafos y posiciones están incluidos por ejecución. Repetir cambia latencias, no se fuerzan tiempos reproducibles. Para arrancar web/backend/Flutter consultar [README](../README.md).

Para una eventual FASE3: confirmar cuenta/región y desplegar con Budget real; resolver con la organización el límite de intersecciones; estudiar el ampliado y cruces temporales; calibrar predictor sobre más semillas y mejorar asignación. WebSocket solo tras estabilizar despliegue. **Ninguna acción FASE3se inició.**
'''
    # Keep readable Spanish spacing around numbers without rewriting identifiers,
    # code paths, hashes or command lines.
    paragraphs = []
    fenced = False
    for line in text.splitlines():
        if line.startswith('```'):
            fenced = not fenced
        if not fenced and not line.startswith(('```', '|')):
            parts = re.split(r'(`[^`]*`|\[[^\]]*\]\([^)]*\)|\bv[12]\b)', line)
            for index in range(0, len(parts), 2):
                parts[index] = re.sub(r'(?<=[a-zA-Záéíóúñ])(?=\d)', ' ', parts[index])
                parts[index] = re.sub(r'(?<=\d)(?=[a-zA-Záéíóúñ])', ' ', parts[index])
                parts[index] = re.sub(r'(?<=%)(?=[a-zA-Záéíóúñ])', ' ', parts[index])
                parts[index] = re.sub(r'(?<=[a-zA-Záéíóúñ]),(?=\S)', ', ', parts[index])
                parts[index] = re.sub(r';(?=\S)', '; ', parts[index])
                parts[index] = re.sub(r':(?=\d)', ': ', parts[index])
            line = ''.join(parts)
        if line.startswith('-') and not line.startswith('- '):
            line = '- ' + line[1:]
        paragraphs.append(line)
    (ROOT/'docs/informe-fase2.md').write_text('\n'.join(paragraphs) + '\n')
    manifest = {'date_local': '2026-10-26', 'timezone': 'America/Guayaquil', 'final_comparison_runs':len(all_cases),
                'final_turns':len(all_cases)*150, 'simulation_successful_http_requests':total_requests,
                'predeclared_seeds':['historical',7,42], 'comparison_files':['baseline/results.json','geography/results.json','expanded-geography/results.json','urban/results.json'],
                'docker_image_id':image['image_id'], 'aws_deployed':False, 'sha256':{}}
    files = list((ROOT/'services/evacuation').rglob('*.go')) + list((ROOT/'services/evacuation/scenarios').rglob('*.json'))
    files += [ROOT/'services/evacuation/data'/name for name in ['manta-v1.json','manta-v2.json','manta-expanded.json','manta-master.json']]
    for path in sorted(files):
        manifest['sha256'][str(path.relative_to(ROOT))] = hashlib.sha256(path.read_bytes()).hexdigest()
    (REPORTS/'evidence-final.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(f'Report: {len(all_cases)} comparative runs, {total_requests} successful simulation HTTP requests, {funcs} Go tests; hashes coherent.')


if __name__ == '__main__':
    main()
