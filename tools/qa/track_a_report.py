#!/usr/bin/env python3
"""Private Track A graph audit and experiment exports; no network or simulator."""
import argparse
import collections
import csv
import hashlib
import heapq
import importlib.util
import json
import math
import os
from pathlib import Path
import statistics

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / 'services/evacuation'
SPEC = importlib.util.spec_from_file_location('graph_audit', ROOT / 'tools/geo/audit_graph.py')
GA = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(GA)


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(value, ensure_ascii=False, indent=2) + '\n'
    temp = path.with_suffix('.tmp')
    temp.write_text(text)
    temp.chmod(0o600)
    temp.replace(path)


def weighted_reference(g):
    reverse = {n['id']: [] for n in g['nodes']}
    for e in g['edges']:
        if e['blocked']:
            continue
        cost = 1 + e['distance_m']/1000 + e['distance_m']/(e['speed_mps']*100)
        reverse[e['to']].append((e['from'], cost))
        if not e['directed']:
            reverse[e['from']].append((e['to'], cost))
    distances = {s['node_id']: 0 for s in g['shelters']}
    heap = [(0, n) for n in distances]
    heapq.heapify(heap)
    while heap:
        d, n = heapq.heappop(heap)
        if d != distances[n]:
            continue
        for other, cost in reverse[n]:
            candidate = d + cost
            if candidate < distances.get(other, math.inf):
                distances[other] = candidate
                heapq.heappush(heap, (candidate, other))
    return distances


def audit(directory):
    result = {}
    for profile, name in [('competition', 'manta-v2.json'), ('full', 'manta-master.json')]:
        path = BACKEND / 'data' / name
        raw = path.read_bytes()
        g = json.loads(raw)
        if any(e['directed'] for e in g['edges']):
            raise ValueError('This reviewed audit requires undirected graphs; use SCC/directed cuts if source changes')
        a = GA.audit(g)
        refs = weighted_reference(g)
        a.update(file=str(path.relative_to(ROOT)), file_sha256=hashlib.sha256(raw).hexdigest(),
                 shelters=g['shelters'], road_types=dict(collections.Counter(e['road_type'] for e in g['edges'])),
                 bridge_tag_edges=sum(e.get('bridge', False) for e in g['edges']),
                 weighted_cost_formula='1 + distance_m/1000 + distance_m/(speed_mps*100)',
                 mean_weighted_cost_to_nearest_shelter=statistics.mean(refs.values()),
                 total_road_length_m=sum(e['distance_m'] for e in g['edges']),
                 weighted_cost_quantiles=GA.quantiles(list(refs.values())))
        adj = GA.adjacency(g)
        shelter_nodes = {s['node_id'] for s in g['shelters']}
        candidates = set().union(*(set(z['node_ids']) for z in g['spawn_zones'])) - shelter_nodes
        excluded = candidates | set().union(*(adj[n] for n in candidates))
        a['spawn'] = {'zone_candidates': {z['id']: len(set(z['node_ids'])-shelter_nodes) for z in g['spawn_zones']},
                      'survivor_possible_nodes': len(candidates),
                      'minimum_normal_zombie_candidates': len(adj)-len(candidates|shelter_nodes),
                      'minimum_horde_candidates': len(adj)-len(excluded|shelter_nodes),
                      'sampling': 'with replacement; survivors equal weights by four zones; zombies uniform on legal non-shelter nodes, hordes exclude survivor neighbors'}
        base = json.loads((BACKEND/'data/manta-v2.json').read_text())
        base_ids = sorted(e['id'] for e in base['edges'])
        events = {}
        for r in [2, 3]:
            cfg = json.loads((BACKEND/f'scenarios/urban/round{r}.json').read_text())
            closed = set()
            events[str(r)] = []
            for event in cfg['events']:
                eid = event.get('edge_id') or base_ids[event['edge_index']]
                assert any(e['id'] == eid for e in g['edges'])
                closed.add(eid)
                changed = GA.adjacency(g, closed)
                shelter_access = {s['id']: len(GA.distances(changed, [s['node_id']])) for s in g['shelters']}
                events[str(r)].append({'turn': event['turn'], 'edge_id': eid, 'type': event['type'],
                                      **GA.scenario_impact(g, closed), 'nodes_reaching_each_shelter': shelter_access})
        a['scheduled_event_impact'] = events
        result[profile] = a
    save(directory/'topology.json', result)
    print(json.dumps({p:{k:a[k] for k in ['nodes','edges','articulation_count','graph_bridge_count','cycle_rank','static_access','scheduled_event_impact']} for p,a in result.items()}, ensure_ascii=False))


def load(directory):
    manifest = json.loads((directory/'manifest.json').read_text())
    runs = []
    for case in manifest['cases']:
        p = directory/'runs'/(case['run_id']+'.json')
        if p.exists():
            run = json.loads(p.read_text())
            assert run['fingerprint'] == manifest['fingerprint']
            assert run['case'] == case
            runs.append(run)
    return manifest, runs


def verify(directory):
    manifest, runs = load(directory)
    assert len(manifest['cases']) == 36
    assert len({c['run_id'] for c in manifest['cases']}) == 36
    completed = [r for r in runs if r['status']=='completed']
    groups = collections.defaultdict(set)
    requests = 0
    for run in completed:
        c, result = run['case'], run['result']
        m = result['metrics']
        assert m['turns'] == 150 and len(run['connectivity_timeline']) == 150
        assert result['diagnostics']['turns'] == result['final_state']['turn'] == 150
        assert [t['turn'] for t in run['connectivity_timeline']] == list(range(1,151))
        assert result['graph_sha256'] == c['graph_hash']
        assert m['evacuated']+m['bitten']+m['active'] == c['config']['survivors']
        assert result['initial_state_sha256'] == c['initial_hash']
        counts = collections.Counter(z['type'] for z in result['diagnostics']['initial_zombies'])
        for singular, plural in [('walker','walkers'),('runner','runners'),('horde','hordes'),('sleeper','sleepers')]:
            assert counts[singular] == c['config'][plural]
        groups[(c['graph_profile'], c['round'], c['threat_level'])].add(c['initial_hash'])
        assert sum(s['occupancy'] for s in result['final_state']['shelters']) == m['evacuated']
        assert all(s['occupancy']+s['reserved']+s['available']==s['capacity'] and min(s['occupancy'],s['reserved'],s['available'])>=0 for s in result['final_state']['shelters'])
        fleet = result.get('fleet_metrics')
        if c['round']=='round3':
            assert c['config']['rescue_fleet'] and len(result['final_state']['fleet'])==5
            assert 0<=fleet['delivered']<=m['evacuated'] and fleet['pickups']>=fleet['delivered']
        else:
            assert not c['config'].get('rescue_fleet',False) and not result['final_state'].get('fleet')
        requests += sum(m[k] for k in ['requests_success','requests_invalid','requests_timeout'])
    assert len(completed)==36, f'Incomplete experiment: {len(completed)}/36'
    assert len(groups)==12
    assert all(len(hashes)==1 for hashes in groups.values())
    assert all(sum((r['case']['graph_profile'],r['case']['round'],r['case']['threat_level'])==key for r in completed)==3 for key in groups)
    http = json.loads((directory/'http-validation.json').read_text())
    assert http['complete'] and len(http['probes'])==6
    expected_http = {manifest['cases'][i]['run_id']:manifest['cases'][i] for i in [3,4,5,12,13,14]}
    assert {r['case']['run_id'] for r in http['probes']} == set(expected_http)
    assert all(r['case']==expected_http[r['case']['run_id']] for r in http['probes'])
    assert all(r['status']=='completed' and r['result']['metrics']['turns']==3 and r['result']['final_state']['turn']==3 and r['fingerprint']==manifest['fingerprint'] for r in http['probes'])
    proof = json.loads((directory/'equivalence.json').read_text())
    assert proof['verified'] and proof['accelerated']['result']['logical_sha256']==proof['paced']['result']['logical_sha256']
    assert proof['steps']==3
    assert all(proof[k]['fingerprint']==manifest['fingerprint'] and proof[k]['status']=='completed' and proof[k]['result']['metrics']['turns']==3 for k in ['accelerated','paced'])
    summary = {'completed':len(completed),'expected':36,'turns':sum(r['result']['metrics']['turns'] for r in completed),
               'requests':requests,'equivalence_verified':True,'initial_hash_groups':len(groups),
               'all_completed':len(completed)==36}
    save(directory/'integrity.json', summary)
    print(json.dumps(summary))
    return manifest, runs


ALGORITHMS = ['baseline_shortest_path','dynamic_risk_astar','predictive_temporal_astar']
LABELS = dict(zip(ALGORITHMS, ['A · mínima ponderada','B · A* dinámico','C · A* temporal']))


def export(directory):
    manifest, runs = verify(directory)
    by_id = {r['case']['run_id']: r for r in runs}
    preflight = json.loads((directory/'preflight.json').read_text())
    topology = json.loads((directory/'topology.json').read_text())
    refs = {p:weighted_reference(json.loads((ROOT/a['file']).read_text())) for p,a in topology.items()}
    columns = ['run_id','date_utc','graph_profile','graph_nodes','graph_edges','graph_version','graph_hash','round','threat_level','algorithm','seed','initial_hash','outcome_hash','code_commit','source_hash','survivors_initial','zombies_total','zombie_density','survivor_density','threat_ratio','walkers','runners','hordes','sleepers','evacuated','alive_not_evacuated','bitten','survival_percent','evacuation_percent','efficiency_hops','average_evacuation_turns','average_initial_reference_hops','average_initial_reference_weighted_cost','average_moves_evacuated','weighted_route_cost_actual','destination_changes','replans_route_invalidations','stationary_agent_turns','generic_wait_with_route_agent_turns','predictive_waits_exact','survivors_ever_physical_no_route','survivors_ever_no_safe_route','physical_no_route_agent_turns','no_safe_route_agent_turns','full_shelter_agent_turns','initial_connected_survivors_physical','initial_connected_survivors_with_hordes','initial_accessible_nodes_with_hordes','max_horde_blocked_nodes','max_horde_blocked_percent','fleet_pickups','fleet_deliveries','fleet_moves','fleet_useful_trips','fleet_passengers_final','fleet_zero_traversal_vehicles','shelters_full','shelter_unoccupied_capacity','turns_completed','logical_duration_seconds','logical_to_wall_ratio','wall_clock_seconds','simulation_turn_processing_seconds','planning_total_seconds','planning_p50_ms','planning_p95_ms','planning_p99_ms','algorithm_search_p95_ms','handler_decision_p95_ms','http_p50_ms','http_p95_ms','http_p99_ms','http_requests','requests_invalid','timeouts','decision_error_or_invalid_percent','availability_percent','responses_over_500ms','responses_over_500ms_source','diagnostic_latency_points','diagnostic_availability_points','engine_builds','engine_search_counter','engine_cache_hits','engine_predictions','cpu_user_seconds','cpu_system_seconds','process_cumulative_max_rss_kib','run_status','failure']
    rows = []
    for c in manifest['cases']:
        cfg = c['config']
        row = dict(run_id=c['run_id'], graph_profile=c['graph_profile'], graph_nodes=topology[c['graph_profile']]['nodes'], graph_edges=topology[c['graph_profile']]['edges'], graph_version=topology[c['graph_profile']]['graph_version'], graph_hash=c['graph_hash'], round=c['round'], threat_level=c['threat_level'], algorithm=c['algorithm'], seed=cfg['seed'], initial_hash=c['initial_hash'], code_commit=manifest['code_commit'], source_hash=manifest['source_hash'], survivors_initial=cfg['survivors'], zombies_total=sum(cfg[k] for k in ['walkers','runners','hordes','sleepers']), **{k:cfg[k] for k in ['walkers','runners','hordes','sleepers']}, run_status='pending')
        row.update(zombie_density=row['zombies_total']/row['graph_nodes'], survivor_density=cfg['survivors']/row['graph_nodes'], threat_ratio=row['zombies_total']/cfg['survivors'])
        run = by_id.get(c['run_id'])
        if run:
            row.update(run_status=run['status'],failure=run.get('failure',''),date_utc=run['started_at'])
        if run and run['result'].get('metrics'):
            r = run['result']; m = r['metrics']; d = r['diagnostics']; su = d['summary']; people = d['survivors']; planning = d['timings']['planning']
            initial = d['initial_survivors']; total = sum(m[k] for k in ['requests_success','requests_invalid','requests_timeout'])
            errors = m['requests_invalid']+m['requests_timeout']
            error_percent = 100*errors/total if total else None
            ev = [p for p in people if p['status']=='evacuated']
            pf = preflight['/'.join((c['graph_profile'],c['round'],c['threat_level']))]
            fleet = r.get('fleet_metrics')
            max_horde = max((t['with_hordes']['blocked_horde_nodes'] for t in run['connectivity_timeline']),default=0)
            row.update(outcome_hash=r['logical_sha256'], evacuated=m['evacuated'],alive_not_evacuated=m['active'],bitten=m['bitten'],survival_percent=100*(m['evacuated']+m['active'])/cfg['survivors'],evacuation_percent=100*m['evacuated']/cfg['survivors'],efficiency_hops=su['mean_route_efficiency'] if ev else None,average_evacuation_turns=su['mean_evacuation_turn'] if ev else None,average_initial_reference_hops=statistics.mean(p['initial_nearest_shelter_hops'] for p in people),average_initial_reference_weighted_cost=statistics.mean(refs[c['graph_profile']][p['node_id']] for p in initial),average_moves_evacuated=statistics.mean(p['moves'] for p in ev) if ev else None,destination_changes=su['destination_changes'],replans_route_invalidations=su['route_invalidations'],stationary_agent_turns=su['stationary_turns'],generic_wait_with_route_agent_turns=d['failures'].get('wait_with_route',0),survivors_ever_physical_no_route=sum(p['geographic_no_route_turns']+p['blocked_route_turns']>0 for p in people),survivors_ever_no_safe_route=sum(p['threat_route_turns']>0 for p in people),physical_no_route_agent_turns=sum(p['geographic_no_route_turns']+p['blocked_route_turns'] for p in people),no_safe_route_agent_turns=sum(p['threat_route_turns'] for p in people),full_shelter_agent_turns=sum(p['full_shelter_turns'] for p in people),initial_connected_survivors_physical=pf['physical']['connected_survivors'],initial_connected_survivors_with_hordes=pf['with_hordes']['connected_survivors'],initial_accessible_nodes_with_hordes=pf['with_hordes']['accessible_nodes'],max_horde_blocked_nodes=max_horde,max_horde_blocked_percent=100*max_horde/row['graph_nodes'],fleet_pickups=fleet['pickups'] if fleet else None,fleet_deliveries=fleet['delivered'] if fleet else None,fleet_moves=fleet['moves'] if fleet else None,fleet_useful_trips=fleet['useful_trips'] if fleet else None,fleet_passengers_final=sum(len(v['passenger_ids']) for v in r['final_state'].get('fleet',[])) if fleet else None,fleet_zero_traversal_vehicles=sum(v['traversed_edges']==0 for v in run.get('vehicles',[])) if fleet else None,shelters_full=su['shelters_full'],shelter_unoccupied_capacity=su['shelter_unoccupied_capacity'],turns_completed=m['turns'],logical_duration_seconds=2*m['turns'],logical_to_wall_ratio=(2*m['turns'])/(r['elapsed_ms']/1000) if r['elapsed_ms'] else None,wall_clock_seconds=r['elapsed_ms']/1000,simulation_turn_processing_seconds=d['timings']['turn']['total_ms']/1000,planning_total_seconds=planning['total_ms']/1000,planning_p50_ms=planning['p50_ms'],planning_p95_ms=planning['p95_ms'],planning_p99_ms=planning['p99_ms'],handler_decision_p95_ms=r['server_timings']['decision']['p95_ms'],http_p50_ms=m['http_p50_ms'] if total else None,http_p95_ms=m['http_p95_ms'] if total else None,http_p99_ms=m['http_p99_ms'] if total else None,http_requests=total,requests_invalid=m['requests_invalid'],timeouts=m['requests_timeout'],decision_error_or_invalid_percent=error_percent,availability_percent=100*m['requests_success']/total if total else None,responses_over_500ms=0 if total and m['requests_timeout']==0 else None,responses_over_500ms_source='derived_from_zero_timeouts_invariant' if total and m['requests_timeout']==0 else None,diagnostic_latency_points=(10 if m['http_p95_ms']<=150 else 7 if m['http_p95_ms']<=300 else 4 if m['http_p95_ms']<=500 else 0) if total else None,diagnostic_availability_points=(10 if error_percent<.5 else 6 if error_percent<2 else 3 if error_percent<5 else 0) if total else None,engine_builds=r['engine_stats']['builds'],engine_search_counter=r['engine_stats']['searches'],engine_cache_hits=r['engine_stats']['cache_hits'],engine_predictions=r['engine_stats']['predictions'],cpu_user_seconds=run['cpu_user_ms']/1000,cpu_system_seconds=run['cpu_system_ms']/1000,process_cumulative_max_rss_kib=run['process_max_rss_kib'])
        rows.append(row)
    export_identity = directory.parent/'track-a-export.json'
    if export_identity.exists():
        previous = json.loads(export_identity.read_text())
        if previous['fingerprint'] != manifest['fingerprint']:
            raise ValueError('Export destination belongs to another experiment; choose another parent directory')
    save(export_identity, {'fingerprint':manifest['fingerprint'],'evidence_directory':str(directory),'rows':len(rows)})
    csv_path = directory.parent/'track-a-resultados.csv'
    with csv_path.open('w',newline='') as f:
        writer = csv.DictWriter(f,columns); writer.writeheader(); writer.writerows(rows)
    csv_path.chmod(0o600)
    summary = []
    completed = [r for r in rows if r['run_status']=='completed']
    for profile in ['competition','full']:
        for rd in ['round2','round3']:
            for algo in ALGORITHMS:
                group = [r for r in completed if (r['graph_profile'],r['round'],r['algorithm'])==(profile,rd,algo)]
                if group:
                    summary.append(dict(graph_profile=profile,round=rd,algorithm=algo,n=len(group),survival_mean=statistics.mean(r['survival_percent'] for r in group),evacuation_mean=statistics.mean(r['evacuation_percent'] for r in group),survival_min=min(r['survival_percent'] for r in group),survival_max=max(r['survival_percent'] for r in group),wall_total_seconds=sum(r['wall_clock_seconds'] for r in group),planning_total_seconds=sum(r['planning_total_seconds'] for r in group),evacuated=sum(r['evacuated'] for r in group),alive_not_evacuated=sum(r['alive_not_evacuated'] for r in group),bitten=sum(r['bitten'] for r in group),fleet_pickups=sum(r.get('fleet_pickups') or 0 for r in group),fleet_deliveries=sum(r.get('fleet_deliveries') or 0 for r in group),http_p95_max=max(r['http_p95_ms'] for r in group)))
    save(directory/'summary.json',summary)
    write_report(directory, manifest, runs, rows, summary, topology, preflight)
    print(json.dumps({'csv':str(csv_path),'rows':len(rows),'summary':summary},ensure_ascii=False))


def table(headers, rows):
    return '\n'.join(['| '+' | '.join(headers)+' |','| '+' | '.join('---' for _ in headers)+' |']+['| '+' | '.join(str(v) for v in row)+' |' for row in rows])


def write_report(directory, manifest, runs, rows, summary, topology, preflight):
    from datetime import datetime
    # Interpretive paragraphs below belong to this measured experiment.
    signature = hashlib.sha256('\n'.join(sorted(r['case']['run_id']+':'+r['result']['logical_sha256'] for r in runs)).encode()).hexdigest()
    if signature != '948fe21ad39760a1093d38a2bd8f857c2799e32517475d7d25c9ac226dd00c9f':
        raise ValueError('Data were exported, but logical results changed: review the experiment-specific interpretation before generating prose')
    completed = [r for r in rows if r['run_status']=='completed']
    total_seconds = sum(r['wall_clock_seconds'] for r in completed)
    starts = [datetime.fromisoformat(r['started_at'].replace('Z','+00:00')) for r in runs if r['status']=='completed']
    ends = [datetime.fromisoformat(r['ended_at'].replace('Z','+00:00')) for r in runs if r['status']=='completed']
    span = (max(ends)-min(starts)).total_seconds() if starts else 0
    reqs = sum(r['http_requests'] for r in completed)
    errs = sum(r['requests_invalid'] for r in completed)
    timeouts = sum(r['timeouts'] for r in completed)
    lines = ['# Track A — evaluación experimental zombie', '',
             f'Fecha del encargo: 28/10/2026. **{len(completed)}/36 corridas completas**, {sum(r["turns_completed"] for r in completed):,} turnos. Fuente de código: `{manifest["code_commit"]}` más el runner local identificado por SHA256 `{manifest["source_hash"]}`. Los timestamps medidos se conservan en UTC en los JSON.', '',
             '## 1. Resumen ejecutivo', '',
             f'Las 36 ejecuciones en doce condiciones comparan BASE (300/383) y FULL_MANTA (9.179/13.452). El perfil intermedio del catálogo denominado expanded (1.000 nodos) queda excluido conforme a la aclaración del propietario. La suma de duración instrumentada de las corridas terminadas es **{total_seconds:.3f} s**; el intervalo de pared entre la primera y última corrida es **{span:.3f} s**. Los 5.400 turnos representan 180 minutos lógicos.', '',
             'La evidencia es exploratoria: una semilla por ronda, tres intensidades y dos geografías. Las recomendaciones siguientes se basan en estas observaciones, sin superioridad estadística ni puntuación oficial global.', '',
             '## 2. Metodología experimental', '',
             'Se amplió `cmd/compare` y su runner `internal/evaluation`, reutilizando `application.NewWithOptions`, `Simulator.Step`, los algoritmos y el planificador existentes. No se alteraron reglas, políticas, algoritmos ni datos geográficos. Cada corrida crea RNG, motor, cachés, planificador, store y HTTP loopback autenticado independientes. Solo una simulación avanza a la vez; el candado exclusivo impide otro runner en el mismo directorio. Cada resultado se escribe atómicamente antes de continuar y el manifiesto impide reutilizar checkpoints con otra fuente/configuración. Se archivaron binario y fuentes exactas medidos. La automatización entregada añade validación de entorno estable y recuperación de probes HTTP parciales; esas comprobaciones de recuperación no alteran el simulador ni los resultados congelados.', '',
             'Se conserva `classic_random`, asignación global y predicción activadas. El algoritmo es la única variable cambiada dentro de cada grafo/ronda/intensidad. Los hashes iniciales coinciden entre los tres algoritmos en las doce condiciones. La persecución puede divergir al cambiar las rutas; la misma seed entre grafos no empareja posiciones geográficas. Los supervivientes se reparten por cuatro zonas con pesos iguales (20 o 50 por zona); los zombies usan el muestreo legal nativo con reemplazo. No se recalibró ninguna cantidad ni se descartaron condiciones difíciles.', '',
             'La configuración conserva 150 turnos de dos segundos lógicos, sin sleep en la matriz. Modo acelerado significa eliminar la pausa, no garantizar que el cómputo de FULL tarde menos que sus 300 segundos lógicos; la razón tiempo lógico/pared se exporta por corrida. El probe separado verificó igualdad de hashes de los tres snapshots lógicos entre intervalo 0 y 2 s, con flota; solo en ese probe se adelantaron los eventos reales a turnos 2/3. El horizonte configurado siguió en 150. No se corrió una ronda completa a ritmo real.', '',
             f'Entorno **local Linux/{manifest["environment"]["arch"]}, {manifest["environment"]["go"]}**, afinidad efectiva a CPUs 0–1, GOMAXPROCS={manifest["environment"]["gomaxprocs"]}, límite de espacio virtual de 8 GiB y objetivo blando de memoria gestionada por el runtime Go de 7 GiB. El límite de espacio virtual no configura 8 GiB de RAM física, y estas condiciones no acreditan equivalencia con EC2. Los datos de host/proceso constan en el manifiesto. El máximo RSS acumulado del proceso medido fue670.852KiB (aprox.655MiB); no es un pico independiente de cada corrida. En AWS solo se consultaron identidad y estado de EC2 mediante STS y DescribeInstances. Las simulaciones fueron locales y los servicios publicados se conservaron sin cambios. La identidad y EC2 se pudieron leer tras un primer fallo de conectividad del sandbox; el propietario autorizó continuar local.', '',
             '## 3. Características de ambos grafos', '']
    topo_rows = []
    for p,a in topology.items():
        topo_rows.append([p,a['nodes'],a['edges'],a['directed_edges'],a['components'],a['articulation_count'],a['graph_bridge_count'],a['bridge_tag_edges'],a['cycle_rank'],f"{a['mean_weighted_cost_to_nearest_shelter']:.3f}"])
    lines += [table(['Perfil','Nodos','Aristas','Dirigidas','Componentes','Articulaciones','Puentes matemáticos','Etiqueta bridge','E−V+C','Costo medio mínimo'],topo_rows),'',
              'Se aplicó conectividad no dirigida porque ambas fuentes tienen cero aristas dirigidas. Tarjan identifica articulaciones/puentes y considera las aristas paralelas; la etiqueta OSM bridge corresponde a un puente físico y es un concepto distinto. E−V+C es rango de ciclos, indicador de redundancia global, no cantidad de rutas seguras por agente. Los dos grafos parten de una componente y 100% de acceso a cada refugio.', '',
              'El peso existente es `1 + distance_m/1000 + distance_m/(speed_mps*100)`; no representa segundos. Ambos conservan cuatro refugios ficticios de capacidad 60 (240 total). Los cuatro emplazamientos cambian entre BASE y FULL. Las zonas de spawn y distancias también cambian: no se atribuyen diferencias entre grafos únicamente al algoritmo.', '']
    for p,a in topology.items():
        lines += [f'**{p}:** versión `{a["graph_version"]}`, SHA256 de archivo `{a["file_sha256"]}`. Longitud total {a["total_road_length_m"]:.3f}m; longitudes mín./p50/p95/máx.: '+ '/'.join(f'{a["edge_length_m"][str(q)]:.3f}' for q in [0,.5,.95,1])+'m. Tipos de calle: '+', '.join(f'{k}={v}' for k,v in sorted(a['road_types'].items()))+'.','']
    lines += [table(['Perfil','Refugio','Nodo real','Capacidad'],[[p,s['id'],s['node_id'],s['capacity']] for p,a in topology.items() for s in a['shelters']]),'',
              'Los cierres son eventos sintéticos del escenario sobre aristas reales, no incidentes observados en calles de Manta. Los eventos se resuelven por el catálogo a los mismos IDs reales en ambos grafos: R2 turno 40 `E-4420ceab96c993b4`; R3 turno 35 `E-01417b990110320d` y turno 80 `E-01780b1cf640b889`. BASE queda299+1 tras R2; el nodo aislado no pertenece a las zonas iniciales. Tras ambos cierresR3 queda278+22, con R-2 en la isla de 22: todos conservan algún refugio, pero pierden destinos alternativos y capacidad compartida. FULL conserva una componente de 9.179 y acceso a cada refugio después de todos estos cierres. El JSON topológico conserva tamaños y accesibilidad por refugio.', '',
              '## 4. Configuraciones R2/R3 y validación inicial','',
              table(['Ronda','Supervivientes','Nivel','Caminantes','Corredores','Hordas','Dormidos','Flota','Seed'],[[r,n,l,*counts,'no' if r==2 else '5×4',20261025+r] for r,n,comps in [(2,80,[(30,8,2,0),(45,12,3,0),(60,16,4,0)]),(3,200,[(60,25,5,10),(90,37,8,15),(120,50,10,20)])] for l,counts in zip(['baja','media','alta'],comps)]),'',
              'Las cantidades son experimentales, no oficiales. R2 conserva 16 trabajadores y R3 conserva 32;80/200 consultas máximas por turno no son80/200 simultáneas. Las hordas permanecen inmóviles según `horde_move_every=0` de los escenarios. Se verificó la composición completa en los diagnósticos privados, incluidos dormidos, antes del primer turno de cada corrida. No hay coincidencias iniciales zombie/superviviente ni supervivientes dentro de huellas iniciales de horda. El muestreo con reemplazo admite todas las poblaciones sin reducción.', '']
    initial_rows = []
    for key,pf in preflight.items():
        p,r,l = key.split('/'); n = len(pf['initial']['initial_survivors']); h = pf['with_hordes']
        initial_rows.append([p,r,l,f'{pf["physical"]["connected_survivors"]}/{n}',f'{h["connected_survivors"]}/{n}',h['blocked_horde_nodes'],f'{h["accessible_nodes"]}/{topology[p]["nodes"]}'])
    lines += [table(['Perfil','Ronda','Nivel','Conexión física inicial','Conexión con hordas','Huella horda','Nodos con acceso+hordas'],initial_rows),'',
              'La huella de horda incluye nodo y vecinos físicos. La auditoría de la corrida usa aristas legales y prohíbe destinos de horda, permitiendo salir de un origen peligroso como hace el motor. No presupone la misma dificultad en ambos mapas. El registro por turno conserva accesibilidad física y con hordas sin exportar mapas completos.', '',
              '## 5. Resultados completos de las 36 ejecuciones','']
    for profile in ['competition','full']:
        lines += [f'### {"BASE" if profile=="competition" else "FULL_MANTA"}', '',
                  table(['Ronda/nivel','Alg.','Evac.','Vivos sin evac.','Mordidos','Superv.%','Evac.%','Pared s','HTTPp95ms','Estado'],[[r['round']+'/'+r['threat_level'],'ABC'[ALGORITHMS.index(r['algorithm'])],r.get('evacuated','ND'),r.get('alive_not_evacuated','ND'),r.get('bitten','ND'),f"{r['survival_percent']:.2f}" if 'survival_percent' in r else 'ND',f"{r['evacuation_percent']:.2f}" if 'evacuation_percent' in r else 'ND',f"{r['wall_clock_seconds']:.3f}" if 'wall_clock_seconds' in r else 'ND',f"{r['http_p95_ms']:.3f}" if r.get('http_p95_ms') is not None else 'ND',r['run_status']] for r in rows if r['graph_profile']==profile]),'']
    lines += ['A=ruta mínima ponderada; B=A* riesgo dinámico; C=A* temporal predictivo. Supervivencia=(evacuados+activos)/iniciales. Los activos no han evacuado. La duración de pared incluye instrumentación del runner, predictor de evaluación, snapshots/hashes y observación de conectividad; el tiempo nativo de turnos y planificación se exporta aparte.', '',
              '## 6. Comparación entre algoritmos','',
              table(['Perfil','Ronda','Alg.','n','Superv. media%','Rango%','Evac. media%','Planificación total s','Pared total s'],[[s['graph_profile'],s['round'],'ABC'[ALGORITHMS.index(s['algorithm'])],s['n'],f"{s['survival_mean']:.3f}",f"{s['survival_min']:.2f}–{s['survival_max']:.2f}",f"{s['evacuation_mean']:.3f}",f"{s['planning_total_seconds']:.3f}",f"{s['wall_total_seconds']:.3f}"] for s in summary]),'']
    for profile in ['competition','full']:
        for rd in ['round2','round3']:
            group = [s for s in summary if (s['graph_profile'],s['round'])==(profile,rd)]
            if group:
                best = max(s['survival_mean'] for s in group)
                winners = [s for s in group if s['survival_mean']==best]
                lines += [f'{profile}/{rd}: mayor supervivencia media observada {best:.3f}%, '+', '.join(LABELS[s['algorithm']] for s in winners)+'. La tabla permite comparar evacuación y costo sin asumir que ganar supervivencia implica ganar todas las métricas.','']
    lines += ['**Anomalías BASE medidas.** En R3 baja los tres algoritmos terminan con 120 evacuados,26 activos y54 mordidos. R-1/R-3 están a60/60 y R-2/R-4 vacíos: la capacidad global libre no representa capacidad segura alcanzable. R-2 está cubierto por horda y R-4 queda separado de los sectores que conservan agentes. En R3 media, los 50 supervivientes inicialmente sin acceso bajo hordas son toda Barbasquillo y terminan mordidos en las tres estrategias. Se conserva esta imposibilidad estructural sin cambiar spawns.', '',
              'En BASE R2 media, C conserva 61 vivos frente a 55 de B y48 de A, pero todos evacúan48: trece agentes de C y siete de B siguen activos sin ruta segura observable. En R3 media C evacúa 120 frente a 95 de B y91 de A; en R3 alta,109 frente a 79 de ambas alternativas. En R3 baja no mejora el resultado y demora la llegada media:14,425 turnos frente a10,400 de B y10,483 de A. El valor predictivo depende de la condición.', '',
              'Los 18 resultados BASE acumulan cero agente-turnos de falta de ruta física por geografía/cierres; casi toda evacuación R2 termina antes del colapso del turno 40. La matriz no discrimina robustamente qué estrategia se adapta mejor a esos cierres. En BASE solo se usan R-1 y R-3: los cambios de destino no prueban descubrimiento de R-2/R-4. No se declara ganador en refugios alternativos ni se atribuye causalmente la mejora a replanificar ante los cierres.', '']
    lines += ['**Regresión FULL R3 alta.** C conserva 138 vivos y evacúa 82, frente a 172/133 deB y 167/153 deA. Los 200 agentes parten conectados bajo hordas y los 56 activos finales deC figuran in_transit: esta regresión no coincide con una desconexión física. En Barbasquillo C pierde 26 personas frente a 4 deB; en Esteros pierde 20 frente a 2. Ocupación R-1/R-2/R-3/R-4: C 56/5/21/0; B 57/46/30/0; A 60/46/47/0. La asignación final es observable, pero no identifica qué decisión la originó.', '',
              'C acumula 2.252 esperas genéricas con ruta, frente a 2.657 deB y 1.266 deA: no puede diagnosticarse como exceso de espera predictiva a partir de esas cifras. C registra 42 recogidas y 24 entregas, frente a 21/3 deB y 23/9 deA; más rescate observado no evita el peor resultado conjunto. Al final quedan 7 pasajeros C, 2 B y 7 A, contados como activos. C tarda 272,536s frente a 239,026 B y 197,066 A. Su eficiencia nativa entre evacuados es 0,5345 frente a 0,5675 B y0,7922 A. Esta condición impide recomendar el temporal universalmente.', '']
    lines += ['En la tabla, n representa tres intensidades, no tres réplicas independientes. Las medias resumen esas condiciones concretas.', '']
    lines += ['Las replanificaciones se exportan como invalidaciones de ruta y cambios de destino, conservando sus nombres reales. Son indicadores distintos de un conteo total de búsquedas A*. Se incluyen esperas, movimientos y reversos por agente en los JSON. El contador EngineStats.searches cuenta la instrumentación existente; no mide expansiones de A* ni operaciones elementales completas.', '',
              '## 7. Intensidad y densidad','',
              table(['Perfil','Ronda','Zombies baja/media/alta por nodo','Supervivientes por nodo','Amenazas por superviviente'],[[p,r,' / '.join(f'{z/topology[p]["nodes"]:.6f}' for z in zs),f'{n/topology[p]["nodes"]:.6f}',' / '.join(f'{z/n:.3f}' for z in zs)] for p in ['competition','full'] for r,n,zs in [('R2',80,[40,60,80]),('R3',200,[100,150,200])]]),'',
              'La intensidad cambia también el consumo RNG al generar tipos y sus posiciones posteriores; no es un aumento causal aislado manteniendo exactamente el mismo mundo. Un resultado no monótono entre intensidades es posible. Los zombies están más dispersos globalmente en FULL con la misma población, pero el peso igual de zonas produce concentraciones locales diferentes. Las huellas reales de horda y porcentajes máximos bloqueados constan en CSV y timelines.', '',
              '## 8. Impacto del tamaño del grafo','']
    for rd in ['round2','round3']:
        differences=[]
        for algo in ALGORITHMS:
            a=next((s for s in summary if (s['graph_profile'],s['round'],s['algorithm'])==('competition',rd,algo)),None)
            b=next((s for s in summary if (s['graph_profile'],s['round'],s['algorithm'])==('full',rd,algo)),None)
            if a and b:
                differences.append(['ABC'[ALGORITHMS.index(algo)],f"{b['survival_mean']-a['survival_mean']:+.3f}",f"{b['evacuation_mean']-a['evacuation_mean']:+.3f}",f"{b['wall_total_seconds']/a['wall_total_seconds']:.2f}×",f"{b['planning_total_seconds']/a['planning_total_seconds']:.2f}×"])
        lines += [f'**{rd}: diferencia FULL−BASE**','',table(['Alg.','Superv. pp','Evac. pp','Razón pared','Razón planificación'],differences),'']
    zones = collections.defaultdict(collections.Counter)
    for run in runs:
        c=run['case']
        if run['status']=='completed' and c['graph_profile']=='full' and c['round']=='round3':
            for person in run['result']['diagnostics']['survivors']:
                zones[(c['algorithm'],person['zone_id'])][person['status']]+=1
    lines += ['**Sectores FULL en R3**, sumando las tres intensidades por algoritmo;150 agentes por zona. Es localización inicial, no área de navegación cerrada ni un mapa oficial de riesgo.', '', table(['Alg.','Zona de origen','Evacuados','Activos','Mordidos'],[['ABC'[ALGORITHMS.index(a)],z,c['evacuated'],c['active'],c['bitten']] for (a,z),c in sorted(zones.items())]),'']
    lines += ['FULL contiene más ciclos y evita las desconexiones de los tres eventos elegidos, pero también tiene más articulaciones absolutas, rutas más largas y otros refugios. Los callejones y articulaciones siguen siendo críticos; BASE pierde alternativas hacia R-2 por los cierresR3. Se conserva el listado de articulaciones/puentes y distribución de distancias en el anexo topológico. La densidad, topología, ubicación de refugios y spawns confunden la comparación; estos datos no estiman complejidad asintótica ni un efecto causal puro del tamaño.', '',
              '## 9. Flota R3','',
              table(['Perfil','Alg.','Recogidos','Entregados','Evac. totales','Fracción evac. entregada'],[[s['graph_profile'],'ABC'[ALGORITHMS.index(s['algorithm'])],s['fleet_pickups'],s['fleet_deliveries'],s['evacuated'],f"{100*s['fleet_deliveries']/s['evacuated']:.2f}%" if s['evacuated'] else 'ND'] for s in summary if s['round']=='round3']),'',
              'Se cuentan las entregas como subconjunto de evacuados: no se suman de nuevo. La diferencia recogidos−entregados puede incluir mordidos y pasajeros todavía activos. El runner comprueba cinco vehículos, capacidad cuatro, máximo dos aristas reales por turno, pasajeros únicos, ocupación y conservación de personas. Los vehículos pueden reutilizarse y el despachador continúa reevaluando objetivos útiles, pero actividad baja no demuestra por sí sola un fallo.', '',
              'Por vehículo se guardan aristas recorridas, turnos de estado activo/idle, carga máxima observada al final de turno, cambios observados de objetivo y motivos de espera. Los pickups/entregas pueden ocurrir y desaparecer entre dos snapshots: **viajes iniciados/completados, recogidos/entregados exactos por vehículo, máxima ocupación intraturno, asignaciones fallidas, objetivos inaccesibles, retornos y reasignaciones exactas son ND**. No se reinterpretan cambios de objetivo como reasignaciones internas. La actividad observada al final de turno es un muestreo, no tiempo activo exacto. Los JSON mantienen la evidencia por vehículo sin fabricar ceros.', '',
              'En BASE, V-02 y V-04 recorren cero aristas en las nueve corridas R3 y registran motivos como no_safe_pickup_route; esto no acredita una avería. Los otros vehículos realizan rescates. En R3 baja hay120 evacuados con 18–27 entregas de flota según algoritmo: más entregas no implican automáticamente más evacuación total. La interacción conjunta de peatones, corredores y despachador puede cambiar la contribución de la flota entre algoritmos. No existe R3 sin flota en esta matriz; no se calcula una mejora causal por rescate.', '',
              '## 10. Eficiencia, latencia y disponibilidad','',
              f'Las rondas completas midieron **{reqs:,} solicitudes HTTP loopback reales**, {errs} inválidas/errores de decisión y {timeouts} timeouts. Son decisiones de la propia simulación, con transporte y decodificación incluidos. Los percentiles se calculan por corrida con nearest-rank; no se promedian percentiles para fingir un p95 agregado.', '',
              'Se distinguen: (A) búsqueda pura por algoritmo: **ND**, no hay cronómetro por búsqueda; (B) planificación global, que incluye routing y asignación, y procesamiento nativo de 150 turnos: medidos; (C) latencia completa cliente de POST/paso: medida. El handler/decision a menudo lee planes preparados: su tiempo no representa por sí solo el costo de búsqueda. La duración del runner añade instrumentación y no es exclusivamente tiempo de motor; excluye construcción de aplicación y planificación inicial, incluidas en cambio en los deltas CPU. La planificación tiene151 muestras por corrida (preparación inicial y150 pasos), y el tiempo nativo de turnos 150.', '',
              'La eficiencia nativa es media de saltos mínimos iniciales sin amenazas / movimientos realizados entre evacuados. No equivale a costo ponderado ni a fórmula oficial; las camionetas suman aristas de pasajeros. El CSV añade referencia ponderada inicial por superviviente y movimiento medio de evacuados. El costo ponderado real de cada trayectoria completa y su desviación exacta son ND, porque no se registró cada arista peatonal/vehicular por persona. Turnos hasta refugio solo se promedian entre quienes llegaron.', '',
              'Los diagnósticos separan sin camino físico (geográfico/cierres), sin ruta por amenaza visible, refugio lleno, espera genérica con ruta y fallos técnicos. Los recuentos de agentes únicos pueden superponerse entre turnos; no deben sumarse como categorías exclusivas de personas. La espera predictiva exacta es ND: wait_with_route no demuestra esa intención. Las métricas derivadas de no-ruta nativas corresponden a decisiones peatonales; los pasajeros tienen su tratamiento propio.', '']
    http_path=directory/'http-validation.json'
    if http_path.exists():
        http=json.loads(http_path.read_text())
        probe_rows=[]
        for run in http['probes']:
            c=run['case'];m=run['result']['metrics'];n=sum(m[k] for k in ['requests_success','requests_invalid','requests_timeout']);e=m['requests_invalid']+m['requests_timeout'];pct=100*e/n if n else math.nan;p95=m['http_p95_ms']
            latency_points=10 if p95<=150 else 7 if p95<=300 else 4 if p95<=500 else 0
            availability_points=10 if pct<.5 else 6 if pct<2 else 3 if pct<5 else 0
            probe_rows.append([c['round'],'ABC'[ALGORITHMS.index(c['algorithm'])],n,f"{m['http_p50_ms']:.6f}",f'{p95:.6f}',f"{m['http_p99_ms']:.6f}",e,m['requests_timeout'],f'{pct:.9f}%',latency_points,availability_points])
        lines += ['**Validación HTTP focalizada posterior:** seis probes BASE de tres turnos, intensidades medias, tres algoritmos, colas de 16/32 trabajadores. Sin ráfagas artificiales ni cambios de reglas; solicitudes efectivas reducidas por terminales.','',table(['Ronda','Alg.','Requests','p50ms','p95ms','p99ms','Fallos/inválidos','Timeouts','% fallos','Pts lat.','Pts disp.'],probe_rows),'']
    lines += ['Los puntos se calculan con los valores completos sin redondear: p95 ≤150/300/500ms →10/7/4 y >500→0; error <0,5/<2/<5%→10/6/3 y resto0. Son **diagnósticos locales**, no calificaciones del jurado. No se exportó una distribución de duraciones máximas ni el desglose de códigos HTTP. En las corridas con cero timeouts, el conteo >500ms se deduce igual a cero por el invariante de Simulator.decisions: toda llamada con elapsed>500ms incrementa RequestsTimeout. El CSV identifica esa deducción y deja ND cuando no puede separar excesos de otros timeouts. El conteo de inválidos/timeouts procede del cliente/simulador y no equivale a un desglose por status. HTTP a ritmo nominal completo, HTTPS/WAN y EC2 quedan pendientes; no se acredita representatividad oficial con aceleración local.', '',
              '## 11. Limitaciones experimentales y anomalías','',
              'Una seed por condición; sin intervalos de confianza ni superioridad estadística. La comparación entre intensidades y grafos no mantiene posiciones equivalentes. Los refugios y zonas cambian. No hay contrafactual de flota. El pronóstico es limitado a observaciones y no está calibrado. Las métricas faltantes quedan vacías en CSV y se etiquetan ND;0 solo significa cero medido o contador nativo sin ocurrencias. Las latencias de HTTP son locales; el proceso está instrumentado y limitado por afinidad, espacio virtual y memoria Go blanda. RSS es el máximo acumulado del proceso, no pico independiente por corrida. No hubo pruebas Safari/dispositivo físico.', '',
              'Incidencias de preparación: Go no pudo escribir su caché fuera del workspace; se usó GOCACHE en /tmp. Una prueba focalizada falló inicialmente porque el sandbox impedía abrir sockets loopback; pasó al ejecutarse con esa capacidad. El primer acceso AWS falló por red del sandbox y luego se verificaron identidad e instancia solo mediante lecturas. Estas incidencias se conservan como problemas del entorno de preparación, sin contarlas como fallos de las 36 corridas.', '',
              '## 12. Recomendación para la presentación','']
    recommendations=[]
    for rd in ['round2','round3']:
        group=[s for s in summary if s['graph_profile']=='competition' and s['round']==rd]
        if group:
            winner=max(group,key=lambda s:(s['survival_mean'],s['evacuation_mean'],-s['planning_total_seconds']))
            recommendations.append([rd,LABELS[winner['algorithm']],f"BASE: supervivencia media {winner['survival_mean']:.3f}%, evacuación {winner['evacuation_mean']:.3f}%; desempate por evacuación y costo medidos"])
    if len([s for s in summary if s['graph_profile']=='competition'])==6:
        ranking=[]
        for algo in ALGORITHMS:
            r2=next(s for s in summary if (s['graph_profile'],s['round'],s['algorithm'])==('competition','round2',algo));r3=next(s for s in summary if (s['graph_profile'],s['round'],s['algorithm'])==('competition','round3',algo))
            ranking.append(((2*r2['survival_mean']+3*r3['survival_mean'])/5,algo))
        best=max(ranking)
        recommendations.append(['Política única BASE',LABELS[best[1]],f'Indicador parcial exploratorio R2/R3 ponderado2:3 = {best[0]:.3f}% de supervivencia; no puntuación oficial'])
    for rd in ['round2','round3']:
        group=[s for s in summary if s['graph_profile']=='full' and s['round']==rd]
        if group:
            winner=max(group,key=lambda s:(s['survival_mean'],s['evacuation_mean'],-s['planning_total_seconds']))
            fastest=max(group,key=lambda s:(s['evacuation_mean'],-s['planning_total_seconds']))
            recommendations.append(['FULL/'+rd,LABELS[winner['algorithm']],f"Mayor supervivencia media {winner['survival_mean']:.3f}%; para priorizar evacuación: {LABELS[fastest['algorithm']]} con {fastest['evacuation_mean']:.3f}%. Considerar el costo medido"])
    recommendations += [['Grafo evaluación','BASE 300','Prioridad reglada del proyecto y costo controlado; FULL se presenta como experimental'],['Escalabilidad','FULL_MANTA 9179','Muestra comportamiento real a mayor tamaño, distancias y densidad diferentes'],['Prueba de fuego','BASE; R2 media 60 y R3 alta 200; seeds 20261027/20261028','Conserva tipos y bloqueos; R3 con 5×4 y 200/200 inicialmente conectados bajo hordas. Intensidades experimentales y exigentes. R3 media 150 se conserva como diagnóstico del sector estructuralmente aislado']]
    lines += [table(['Uso','Recomendación','Fundamento'],recommendations),'',
              'La configuración, seeds y hashes permiten comprobar una repetición futura; aquí se verificó equivalencia corta y no un replay completo de las36 corridas. Para contrastar presión menor se usa la intensidad baja como condición ya medida, sin prometer que todos los resultados sean monótonos. No se promueve el temporal por sofisticación: la decisión se deriva de supervivencia observada, evacuación y costo dentro de BASE. Una demo del mapa mayor puede mostrar una composición distinta de limitaciones, que debe explicarse con sus datos.', '',
              'El Track A pondera supervivencia 50%, eficiencia 20%, latencia 15% y disponibilidad 15%, con supervivencia R1×1/R2×2/R3×3 según el contexto proporcionado. Falta R1 y una fórmula oficial completa de eficiencia; no se calcula calificación global. El indicador parcial 2:3 anterior solo ayuda a escoger una política para estas condiciones.', '',
              '## 13. Conclusiones y reproducción','',
              'Los resultados permiten comparar tres estrategias en condiciones iniciales iguales dentro de cada condición, identificar cuellos topológicos y observar actividad de rescate sin confundir recogida con entrega. Las diferencias grandes deben interpretarse junto a activos no evacuados, refugios disponibles, huellas de horda y costo de planificación. Ningún algoritmo puede garantizar evacuación si las rutas disponibles quedan cortadas o no son aceptables frente a amenazas.', '',
              'Para reanudar la evidencia medida con sus fuentes y binario congelados: `bash reports/track-a-evidence/replay-frozen.sh`. El script extrae únicamente ese archivo local en un temporal y conserva los resultados existentes. La versión medida también vive en `frozen-source.tar.gz`; no se inicializa Git. Para un experimento NUEVO con las fuentes actuales, usar otro directorio, por ejemplo `reports/track-a-nuevo/track-a-evidence`, tanto en auditor/runner como en exportación. Comandos base desde la raíz (sin AWS ni servicios públicos):','',
              '```sh','python3 tools/qa/track_a_report.py audit --directory reports/track-a-nuevo/track-a-evidence',
              'GOCACHE=/tmp/corodev-track-a-gocache node tools/scripts/go.mjs build -o /tmp/corodev-track-a-compare ./cmd/compare',
              '(cd services/evacuation && GOMAXPROCS=2 GOMEMLIMIT=7GiB prlimit --as=8589934592 -- taskset -c 0,1 /tmp/corodev-track-a-compare --track-a --output ../../reports/track-a-nuevo/track-a-evidence)',
              'python3 tools/qa/track_a_report.py export --directory reports/track-a-nuevo/track-a-evidence','```','',
              'La afinidad 0,1 debe elegirse de las CPUs permitidas del host. El runner verifica y omite corridas ya completas del mismo manifiesto; para otra fuente/configuración usar otro directorio. Los resultados fallidos/interrumpidos se conservan antes de reintentarlos. El binario temporal puede reconstruirse con la fuente de esta entrega. Los JSON privados contienen spawns de dormidos y nunca deben publicarse con la web.', '',
              'Artefactos: [CSV](track-a-resultados.csv), [retrospectiva](retrospectiva-corodev.md), [manifiesto](track-a-evidence/manifest.json), [topología](track-a-evidence/topology.json), [preflight](track-a-evidence/preflight.json), [equivalencia](track-a-evidence/equivalence.json), [resumen JSON](track-a-evidence/summary.json), [integridad](track-a-evidence/integrity.json), [comandos y cierre](track-a-evidence/verification.json), [validación HTTP](track-a-evidence/http-validation.json) y 36 JSON individuales en `track-a-evidence/runs/`. Todo `reports/` está ignorado por Git.','',
              'Verificación ejecutada: auditoría offline; compilación de cmd/compare; prueba focalizada `TestExperimentPreservesPartialEvidenceAndScenarioHorizon`; dos pruebas de recuperación `TestTrackA*`, go vet de cmd/compare y evaluation; reanudación en copia temporal sin turnos adicionales; equivalencia corta; matriz secuencial; probes HTTP; validación de composición/hashes/conservación/capacidad/150 turnos y exportación. No se ejecutaron lint global, E2E, suites generales, Flutter, despliegues ni cambios de infraestructura. No se crearon commits. El proceso temporal terminó y cerró sus listeners al completar.']
    path=directory.parent/'track-a-experimento.md'
    text='\n'.join(lines)+'\n'
    if (directory.parent/'track-a-r3-flota.md').exists():
        note='> **Ampliación R3 completada:** se añadieron 18 controles sin flota, con los mismos estados iniciales y código nativo. El estudio totaliza 54 corridas y 8.100 turnos. La [comparación emparejada de flota](track-a-r3-flota.md) actualiza las conclusiones sobre rescate; las limitaciones de ausencia de contrafactual que siguen se refieren únicamente a la matriz original de 36 corridas.\n\n'
        text=text.replace('\n\n','\n\n'+note,1)
    path.write_text(text);path.chmod(0o600)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['audit','verify','export'])
    parser.add_argument('--directory', type=Path, default=ROOT/'reports/track-a-evidence')
    args = parser.parse_args()
    {'audit':audit, 'verify':verify, 'export':export}[args.action](args.directory)
