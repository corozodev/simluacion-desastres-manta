#!/usr/bin/env python3
"""Export matched R3 fleet counterfactuals from native simulator evidence."""
import argparse
import collections
import csv
from datetime import datetime
import hashlib
import json
from pathlib import Path
import shutil
import statistics

ROOT = Path(__file__).resolve().parents[2]
ALGORITHMS = ['baseline_shortest_path','dynamic_risk_astar','predictive_temporal_astar']
LABEL = dict(zip(ALGORITHMS,['A · mínima ponderada','B · A* dinámico','C · A* temporal']))
STATES = ['evacuated','active','bitten']


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n')
    temp.chmod(0o600)
    temp.replace(path)


def csv_write(path, rows):
    assert rows
    columns = list(rows[0])
    with path.open('w',newline='') as output:
        writer=csv.DictWriter(output,columns)
        writer.writeheader()
        writer.writerows(rows)
    path.chmod(0o600)
    with path.open() as output:
        assert len(list(csv.DictReader(output)))==len(rows)


def table(headers, rows):
    return '\n'.join(['| '+' | '.join(headers)+' |','| '+' | '.join('---' for _ in headers)+' |']+['| '+' | '.join(str(v) for v in r)+' |' for r in rows])


def percent(n):
    return n/2  # R3 has exactly 200 people in each matched world.


def prepare(directory, reference):
    manifest=json.loads((reference/'manifest.json').read_text())
    completion=json.loads((reference/'completion.json').read_text())
    assert len(manifest['cases'])==completion['completed']==36 and completion['turns']==5400
    paths=[reference/'manifest.json',reference/'frozen-source.tar.gz',reference.parent/'track-a-resultados.csv']+sorted((reference/'runs').glob('*.json'))
    assert len(paths)==39
    hashes={str(p.resolve().relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
    directory.mkdir(parents=True,exist_ok=True)
    path=directory/'reference-files-sha256.json'
    if path.exists():
        assert json.loads(path.read_text())==hashes, 'Reference hashes differ; use another directory'
    else:
        save(path,hashes)
    report=reference.parent/'track-a-experimento.md'
    snapshot=directory/'original-report-snapshot.md'
    if report.exists() and not snapshot.exists():
        shutil.copy2(report,snapshot);snapshot.chmod(0o600)
    print(json.dumps({'reference_runs_frozen':36,'reference_files':len(hashes),'output':str(directory)}))


def export(directory):
    manifest = json.loads((directory/'manifest.json').read_text())
    assert manifest['kind']=='track_a_r3_no_fleet' and manifest['native_source_matches_reference']
    reference_dir = (directory/manifest['reference_directory']).resolve()
    original_manifest = json.loads((reference_dir/'manifest.json').read_text())
    assert original_manifest['fingerprint']==manifest['reference_fingerprint']
    completion = json.loads((directory/'completion.json').read_text())
    assert completion['completed']==18 and completion['turns']==2700 and completion['fingerprint']==manifest['fingerprint']
    assert len(manifest['cases'])==18 and len({c['run_id'] for c in manifest['cases']})==18
    expected = {c['run_id']:c for c in original_manifest['cases'] if c['round']=='round3'}
    assert set(expected)=={c['reference_run_id'] for c in manifest['cases']}
    hashes = json.loads((directory/'reference-files-sha256.json').read_text())
    for path, digest in hashes.items():
        assert hashlib.sha256((ROOT/path).read_bytes()).hexdigest()==digest, f'Reference modified: {path}'
    rows, off_rows, people_rows, curves = [], [], [], []
    transitions = collections.defaultdict(collections.Counter)
    groups = collections.defaultdict(list)
    total_requests, errors, timeouts = 0, 0, 0
    initial_groups = collections.defaultdict(set)
    for c in manifest['cases']:
        off = json.loads((directory/'runs'/(c['run_id']+'.json')).read_text())
        original_id = c['reference_run_id']
        on = json.loads((reference_dir/'runs'/(original_id+'.json')).read_text())
        assert off['case']==c and on['case']==expected[original_id]
        assert off['fingerprint']==manifest['fingerprint'] and on['fingerprint']==original_manifest['fingerprint']
        assert on['status']==off['status']=='completed'
        assert on['case']['config']['rescue_fleet'] and not c['config'].get('rescue_fleet',False)
        comparable=dict(on['case']['config']); comparable.pop('rescue_fleet',None)
        without=dict(c['config']); without.pop('rescue_fleet',None)
        assert comparable==without
        assert c['round']=='round3' and c['config']['survivors']==200 and c['config']['turns']==150
        ro, rn = on['result'], off['result']
        assert ro['graph_sha256']==rn['graph_sha256']==c['graph_hash']
        assert ro['initial_state_sha256']==rn['initial_state_sha256']==c['initial_hash']
        initial_groups[(c['graph_profile'],c['threat_level'])].add(c['initial_hash'])
        assert ro['diagnostics']['initial_survivors']==rn['diagnostics']['initial_survivors']
        assert ro['diagnostics']['initial_zombies']==rn['diagnostics']['initial_zombies']
        for r in [ro,rn]:
            m=r['metrics']
            assert m['turns']==r['diagnostics']['turns']==r['final_state']['turn']==150
            assert m['evacuated']+m['active']+m['bitten']==200
            assert sum(s['occupancy'] for s in r['final_state']['shelters'])==m['evacuated']
            assert all(s['occupancy']+s['reserved']+s['available']==s['capacity'] and min(s['occupancy'],s['reserved'],s['available'])>=0 for s in r['final_state']['shelters'])
            composition=collections.Counter(z['type'] for z in r['diagnostics']['initial_zombies'])
            assert [composition[t] for t in ['walker','runner','horde','sleeper']]==[c['config'][t] for t in ['walkers','runners','hordes','sleepers']]
        assert not rn['final_state'].get('fleet') and rn.get('fleet_metrics') is None
        assert len(off['connectivity_timeline'])==150
        counts_on, counts_off = ro['metrics'], rn['metrics']
        for k in ['requests_success','requests_invalid','requests_timeout']:
            assert counts_off[k]>=0
        total_requests += sum(counts_off[k] for k in ['requests_success','requests_invalid','requests_timeout'])
        errors += counts_off['requests_invalid']; timeouts += counts_off['requests_timeout']
        people_on = {p['id']:p for p in ro['diagnostics']['survivors']}
        people_off = {p['id']:p for p in rn['diagnostics']['survivors']}
        assert len(people_on)==len(people_off)==200 and people_on.keys()==people_off.keys()
        bites_on = {b['survivor_id']:b['turn'] for b in ro['diagnostics']['bites']}
        bites_off = {b['survivor_id']:b['turn'] for b in rn['diagnostics']['bites']}
        pair_transitions = collections.Counter()
        common_arrival_deltas=[]
        common_efficiency_deltas=[]
        common_bite_deltas=[]
        for person_id, pn in people_off.items():
            po=people_on[person_id]
            assert all(po[k]==pn[k] for k in ['initial_node','zone_id','initial_nearest_shelter_hops'])
            assert po['status'] in STATES and pn['status'] in STATES
            pair_transitions[(pn['status'],po['status'])]+=1
            transitions[c['graph_profile']][(pn['status'],po['status'])]+=1
            both_evacuated=po['status']==pn['status']=='evacuated'
            both_bitten=po['status']==pn['status']=='bitten'
            if both_evacuated:
                assert po['evacuation_turn']>0 and pn['evacuation_turn']>0
                common_arrival_deltas.append(po['evacuation_turn']-pn['evacuation_turn'])
                common_efficiency_deltas.append(po['route_efficiency']-pn['route_efficiency'])
            if both_bitten:
                common_bite_deltas.append(bites_on[person_id]-bites_off[person_id])
            people_rows.append(dict(pair_id=original_id,graph_profile=c['graph_profile'],threat_level=c['threat_level'],algorithm=c['algorithm'],seed=c['config']['seed'],survivor_id=person_id,spawn_zone=pn['zone_id'],initial_node=pn['initial_node'],initial_nearest_shelter_hops=pn['initial_nearest_shelter_hops'],status_without_fleet=pn['status'],status_with_fleet=po['status'],evacuation_turn_without=pn['evacuation_turn'] if pn['status']=='evacuated' else None,evacuation_turn_with=po['evacuation_turn'] if po['status']=='evacuated' else None,arrival_delta_common_evacuated=po['evacuation_turn']-pn['evacuation_turn'] if both_evacuated else None,moves_without=pn['moves'],moves_with=po['moves'],efficiency_without=pn['route_efficiency'] if pn['status']=='evacuated' else None,efficiency_with=po['route_efficiency'] if po['status']=='evacuated' else None,bite_turn_without=bites_off.get(person_id),bite_turn_with=bites_on.get(person_id),bite_turn_delta_common_bitten=bites_on[person_id]-bites_off[person_id] if both_bitten else None))
        assert sum(pair_transitions.values())==200
        gained_survival=sum(n for (a,b),n in pair_transitions.items() if a=='bitten' and b!='bitten')
        lost_survival=sum(n for (a,b),n in pair_transitions.items() if a!='bitten' and b=='bitten')
        gained_evacuation=sum(n for (a,b),n in pair_transitions.items() if a!='evacuated' and b=='evacuated')
        lost_evacuation=sum(n for (a,b),n in pair_transitions.items() if a=='evacuated' and b!='evacuated')
        alive_on=counts_on['evacuated']+counts_on['active'];alive_off=counts_off['evacuated']+counts_off['active']
        assert gained_survival-lost_survival==alive_on-alive_off
        assert gained_evacuation-lost_evacuation==counts_on['evacuated']-counts_off['evacuated']
        fleet=ro['fleet_metrics']
        row=dict(pair_id=original_id,run_id_without_fleet=c['run_id'],graph_profile=c['graph_profile'],graph_nodes=ro['nodes'],graph_edges=ro['edges'],graph_hash=c['graph_hash'],threat_level=c['threat_level'],algorithm=c['algorithm'],seed=c['config']['seed'],initial_hash=c['initial_hash'],survivors_initial=200,zombies_total=sum(c['config'][k] for k in ['walkers','runners','hordes','sleepers']),evacuated_with=counts_on['evacuated'],evacuated_without=counts_off['evacuated'],delta_evacuated=counts_on['evacuated']-counts_off['evacuated'],active_with=counts_on['active'],active_without=counts_off['active'],alive_with=alive_on,alive_without=alive_off,delta_alive=alive_on-alive_off,bitten_with=counts_on['bitten'],bitten_without=counts_off['bitten'],survival_percent_with=percent(alive_on),survival_percent_without=percent(alive_off),delta_survival_pp=percent(alive_on-alive_off),evacuation_percent_with=percent(counts_on['evacuated']),evacuation_percent_without=percent(counts_off['evacuated']),delta_evacuation_pp=percent(counts_on['evacuated']-counts_off['evacuated']),gross_survival_gains=gained_survival,gross_survival_losses=lost_survival,gross_evacuation_gains=gained_evacuation,gross_evacuation_losses=lost_evacuation,common_evacuated=len(common_arrival_deltas),mean_arrival_turn_delta_common=statistics.mean(common_arrival_deltas) if common_arrival_deltas else None,mean_efficiency_delta_common=statistics.mean(common_efficiency_deltas) if common_efficiency_deltas else None,common_bitten=len(common_bite_deltas),mean_bite_turn_delta_common=statistics.mean(common_bite_deltas) if common_bite_deltas else None,fleet_pickups=fleet['pickups'],fleet_deliveries=fleet['delivered'],fleet_useful_trips=fleet['useful_trips'],fleet_passengers_final=sum(len(v['passenger_ids']) for v in ro['final_state']['fleet']),wall_seconds_with=ro['elapsed_ms']/1000,wall_seconds_without=rn['elapsed_ms']/1000,planning_seconds_with=ro['diagnostics']['timings']['planning']['total_ms']/1000,planning_seconds_without=rn['diagnostics']['timings']['planning']['total_ms']/1000,http_p95_ms_with=counts_on['http_p95_ms'],http_p95_ms_without=counts_off['http_p95_ms'],http_requests_with=sum(counts_on[k] for k in ['requests_success','requests_invalid','requests_timeout']),http_requests_without=sum(counts_off[k] for k in ['requests_success','requests_invalid','requests_timeout']),invalid_with=counts_on['requests_invalid'],invalid_without=counts_off['requests_invalid'],timeouts_with=counts_on['requests_timeout'],timeouts_without=counts_off['requests_timeout'],turns_with=150,turns_without=150,pair_status='completed_clean' if all(m['requests_invalid']==0 and m['requests_timeout']==0 for m in [counts_on,counts_off]) else 'completed_technical_issues')
        rows.append(row);groups[(c['graph_profile'],c['algorithm'])].append(row)
        off_rows.append(dict(run_id=c['run_id'],reference_run_id=original_id,graph_profile=c['graph_profile'],graph_nodes=rn['nodes'],graph_edges=rn['edges'],round='round3',threat_level=c['threat_level'],algorithm=c['algorithm'],seed=c['config']['seed'],initial_hash=c['initial_hash'],graph_hash=c['graph_hash'],outcome_hash=rn['logical_sha256'],rescue_fleet=False,survivors_initial=200,zombies_total=row['zombies_total'],**{k:c['config'][k] for k in ['walkers','runners','hordes','sleepers']},evacuated=counts_off['evacuated'],alive_not_evacuated=counts_off['active'],bitten=counts_off['bitten'],survival_percent=percent(alive_off),evacuation_percent=percent(counts_off['evacuated']),average_evacuation_turn=rn['diagnostics']['summary']['mean_evacuation_turn'] if counts_off['evacuated'] else None,efficiency_hops=rn['diagnostics']['summary']['mean_route_efficiency'] if counts_off['evacuated'] else None,turns_completed=150,wall_clock_seconds=rn['elapsed_ms']/1000,planning_total_seconds=rn['diagnostics']['timings']['planning']['total_ms']/1000,http_p50_ms=counts_off['http_p50_ms'],http_p95_ms=counts_off['http_p95_ms'],http_p99_ms=counts_off['http_p99_ms'],http_requests=row['http_requests_without'],requests_invalid=counts_off['requests_invalid'],timeouts=counts_off['requests_timeout'],run_status='completed'))
        to,tn=ro['diagnostics']['timeline'],rn['diagnostics']['timeline']
        assert len(to)==len(tn)==150
        for a,b in zip(to,tn):
            assert a['turn']==b['turn']
            curves.append(dict(pair_id=original_id,graph_profile=c['graph_profile'],threat_level=c['threat_level'],algorithm=c['algorithm'],turn=a['turn'],logical_seconds=2*a['turn'],evacuated_with=a['evacuated'],evacuated_without=b['evacuated'],delta_evacuated=a['evacuated']-b['evacuated'],alive_with=a['active']+a['evacuated'],alive_without=b['active']+b['evacuated'],delta_alive=a['active']+a['evacuated']-b['active']-b['evacuated'],bitten_with=a['bitten'],bitten_without=b['bitten']))
    assert len(rows)==18 and len(people_rows)==3600 and len(curves)==2700
    assert len(initial_groups)==6 and all(len(v)==1 for v in initial_groups.values())
    parent=directory.parent
    identity=parent/'track-a-r3-export.json'
    if identity.exists():
        assert json.loads(identity.read_text())['fingerprint']==manifest['fingerprint'], 'Another comparison owns this export destination; use another parent directory'
    save(identity,{'fingerprint':manifest['fingerprint'],'reference_fingerprint':manifest['reference_fingerprint'],'matched_pairs':18})
    csv_write(parent/'track-a-r3-sin-flota.csv',off_rows)
    csv_write(parent/'track-a-r3-comparacion-flota.csv',rows)
    csv_write(parent/'track-a-r3-transiciones.csv',people_rows)
    csv_write(parent/'track-a-r3-curvas.csv',curves)
    summary=[]
    for (profile,algorithm),group in groups.items():
        assert len(group)==3
        summary.append(dict(graph_profile=profile,algorithm=algorithm,n_conditions=3,survival_percent_with=statistics.mean(r['survival_percent_with'] for r in group),survival_percent_without=statistics.mean(r['survival_percent_without'] for r in group),delta_survival_pp=statistics.mean(r['delta_survival_pp'] for r in group),evacuation_percent_with=statistics.mean(r['evacuation_percent_with'] for r in group),evacuation_percent_without=statistics.mean(r['evacuation_percent_without'] for r in group),delta_evacuation_pp=statistics.mean(r['delta_evacuation_pp'] for r in group),delta_alive=sum(r['delta_alive'] for r in group),delta_evacuated=sum(r['delta_evacuated'] for r in group),fleet_deliveries=sum(r['fleet_deliveries'] for r in group),wall_seconds_with=sum(r['wall_seconds_with'] for r in group),wall_seconds_without=sum(r['wall_seconds_without'] for r in group)))
    save(directory/'summary.json',summary)
    integrity=dict(controls_completed=18,matched_pairs=18,individual_pairs=3600,curve_rows=2700,new_ticks=2700,total_study_runs=54,total_study_ticks=8100,initial_hash_groups=6,reference_files_unchanged=True,native_source_matches_reference=True,new_http_requests=total_requests,new_invalid=errors,new_timeouts=timeouts,clean_pairs=sum(r['pair_status']=='completed_clean' for r in rows))
    save(directory/'integrity.json',integrity)
    write_report(parent, directory, manifest, rows, summary, transitions, off_rows, integrity)
    print(json.dumps({'integrity':integrity,'summary':summary},ensure_ascii=False))


def write_report(parent,directory,manifest,rows,summary,transitions,off_rows,integrity):
    started=[];ended=[]
    for c in manifest['cases']:
        run=json.loads((directory/'runs'/(c['run_id']+'.json')).read_text())
        started.append(datetime.fromisoformat(run['started_at'].replace('Z','+00:00')))
        ended.append(datetime.fromisoformat(run['ended_at'].replace('Z','+00:00')))
    span=(max(ended)-min(started)).total_seconds()
    gains=sum(r['delta_alive']>0 for r in rows);losses=sum(r['delta_alive']<0 for r in rows)
    evac_gains=sum(r['delta_evacuated']>0 for r in rows);evac_losses=sum(r['delta_evacuated']<0 for r in rows)
    lines=['# R3 — contrafactual con y sin flota','',
           f'**18/18 controles nuevos**, emparejados con las18 R3 originales. Cada control completa150 turnos; se añaden2700 turnos y el estudio totaliza54 corridas/8100 turnos. Los controles suman {sum(r["wall_clock_seconds"] for r in off_rows):.3f} s instrumentados y abarcan {span:.3f} s de pared entre la primera y última corrida. Las 36 corridas originales, su manifiesto y CSV mantienen los mismos hashes.','',
           '## Diseño y alcance causal','',
           'El runner copia cada caso R3 del manifiesto original y modifica exclusivamente RescueFleet=true→false. Conserva200 agentes, composición zombie, seed20261028, política classic_random, grafo/hash, cuatro refugios/capacidades, eventos,150 turnos, predicción y asignación global. Iniciales de supervivientes y todos los zombies, incluidos dormidos privados, coinciden byte a byte; también coinciden ID, nodo inicial, zona y distancia inicial por agente.','',
           'Se verificaron todos los archivos Go internos y go.mod contra la fuente congelada original; solo cambia la automatización. Go, arquitectura, afinidad0–1, GOMAXPROCS2, límite virtual8GiB y objetivo blando de memoria Go7GiB coinciden. El límite virtual no asigna8GiB de RAM física. Los18 controles son secuenciales, locales, acelerados y usan HTTP loopback autenticado; no modifican AWS ni el servicio publicado.','',
           'En los pares sin fallos técnicos, este contraste observa el **efecto total del modo de flota en cada mundo simulado**. Incluye transporte, reservas, asignaciones, persecución de corredores, activación de dormidos y consumo posterior de RNG. La misma seed empareja el estado inicial; no obliga a conservar trayectorias posteriores cuando cambia el tratamiento. No se identifica un efecto aislado del transporte directo. Una mejora del estado de S-X no prueba que ese agente fuera pasajero.','',
           f'El contraste conserva una semilla por condición. Los3600 pares individuales interactúan dentro de18 comparaciones de mundos: no son3600 réplicas independientes. En supervivencia, la flota gana en{gains} pares, pierde en{losses} y empata en{18-gains-losses}; en evacuación gana en{evac_gains}, pierde en{evac_losses} y empata en{18-evac_gains-evac_losses}. Las magnitudes y dirección se muestran por condición; no hay conclusión universal.','',
           '## Resultados emparejados','',
           'En todas las tablas, **Δ=con flota−sin flota**. Vivo incluye evacuado y activo. A=mínima ponderada, B=A* dinámico, C=A* temporal.','']
    for profile in ['competition','full']:
        lines += [f'### {"BASE300" if profile=="competition" else "FULL_MANTA9179"}','',table(['Intensidad','Alg.','Evac. con/sin','Vivos con/sin','Δevac.','Δvivos','Δsuperv. pp','Entregados flota'],[[r['threat_level'],'ABC'[ALGORITHMS.index(r['algorithm'])],f"{r['evacuated_with']}/{r['evacuated_without']}",f"{r['alive_with']}/{r['alive_without']}",f"{r['delta_evacuated']:+d}",f"{r['delta_alive']:+d}",f"{r['delta_survival_pp']:+.2f}",r['fleet_deliveries']] for r in rows if r['graph_profile']==profile]),'']
    lines += ['## Resumen por algoritmo','',
              'Medias de las tres intensidades con igual peso; no son tres réplicas de la misma condición.','',table(['Grafo','Alg.','Superv.% con/sin','Δsuperv. pp','Evac.% con/sin','Δevac. pp','Entregas'],[[s['graph_profile'],'ABC'[ALGORITHMS.index(s['algorithm'])],f"{s['survival_percent_with']:.3f}/{s['survival_percent_without']:.3f}",f"{s['delta_survival_pp']:+.3f}",f"{s['evacuation_percent_with']:.3f}/{s['evacuation_percent_without']:.3f}",f"{s['delta_evacuation_pp']:+.3f}",s['fleet_deliveries']] for s in summary]),'']
    for profile in ['competition','full']:
        group=[s for s in summary if s['graph_profile']==profile]
        for treatment in ['with','without']:
            best=max(group,key=lambda s:(s['survival_percent_'+treatment],s['evacuation_percent_'+treatment]))
            best_evac=max(group,key=lambda s:s['evacuation_percent_'+treatment])
            lines += [f'{profile}, {"con" if treatment=="with" else "sin"} flota: mayor supervivencia media {LABEL[best["algorithm"]]} ({best["survival_percent_"+treatment]:.3f}%); mayor evacuación {LABEL[best_evac["algorithm"]]} ({best_evac["evacuation_percent_"+treatment]:.3f}%).','']
    most_help=max(rows,key=lambda r:r['delta_alive']);most_harm=min(rows,key=lambda r:r['delta_alive'])
    lines += [f'Mayor ganancia de supervivencia: {most_help["pair_id"]}, {most_help["delta_alive"]:+d} personas ({most_help["delta_survival_pp"]:+.2f}pp). Mayor pérdida: {most_harm["pair_id"]}, {most_harm["delta_alive"]:+d} ({most_harm["delta_survival_pp"]:+.2f}pp). Son extremos observados de estas configuraciones.','',
              '## Quién cambia de estado','',
              'Filas=estado sin flota; columnas=estado con flota. Son estados finales emparejados, sin atribuir una entrega directa a una persona.','']
    for profile in ['competition','full']:
        lines += [f'**{profile}**, agregando algoritmos e intensidades (1800 pares virtuales):','',table(['Sin→con','Evacuado','Activo','Mordido'],[[a,*[transitions[profile][(a,b)] for b in STATES]] for a in STATES]),'']
    lines += [table(['Grafo/nivel/alg.','Ganancias/pérdidas supervivencia','Ganancias/pérdidas evacuación','Llegan en ambos','Δturno llegada común'],[[r['graph_profile']+'/'+r['threat_level']+'/'+'ABC'[ALGORITHMS.index(r['algorithm'])],f"{r['gross_survival_gains']}/{r['gross_survival_losses']}",f"{r['gross_evacuation_gains']}/{r['gross_evacuation_losses']}",r['common_evacuated'],f"{r['mean_arrival_turn_delta_common']:+.3f}" if r['mean_arrival_turn_delta_common'] is not None else 'ND'] for r in rows]),'',
              'La diferencia de llegada se calcula solo entre agentes evacuados en ambos mundos: negativa indica llegada anterior con flota. El subconjunto común tiene sesgo de selección y no representa a los200 agentes. La eficiencia comparada también se restringe a esa intersección en el CSV; no se interpreta como puntuación oficial. Los pares de mordidos conservan sus turnos de mordida; los no mordidos quedan sin ese valor, sin inventar una muerte en150.','',
              '## Contribución observada y límites de medición','',
              'Las entregas son parte de los evacuados y no se suman de nuevo. No equivalen al efecto neto: una corrida puede entregar personas y aun así terminar con menos evacuados o vivos que su control. El CSV separa entregas, ganancias/pérdidas brutas y diferencias netas. No hay historial suficiente para identificar retrospectivamente todos los pasajeros que fueron entregados.','',
              'Los contadores de espera, no-ruta, destinos e invalidaciones cubren principalmente decisiones peatonales; los pasajeros se procesan por otra ruta del simulador. Por ello no se comparan sus totales como si tuvieran igual exposición. Los movimientos incluyen aristas de pasajeros y representan recorrido, sin medir esfuerzo peatonal. Las curvas de150 turnos permiten comparar evolución sin renderizar un navegador.','',
              '## Procesamiento y HTTP','',table(['Grafo','Alg.','Pared total con/sin s','Diferencia s','Solicitudes con/sin'],[[s['graph_profile'],'ABC'[ALGORITHMS.index(s['algorithm'])],f"{s['wall_seconds_with']:.3f}/{s['wall_seconds_without']:.3f}",f"{s['wall_seconds_with']-s['wall_seconds_without']:+.3f}",str(sum(r['http_requests_with'] for r in rows if r['graph_profile']==s['graph_profile'] and r['algorithm']==s['algorithm']))+'/'+str(sum(r['http_requests_without'] for r in rows if r['graph_profile']==s['graph_profile'] and r['algorithm']==s['algorithm']))] for s in summary]),'',
              f'Los controles nuevos registran {integrity["new_http_requests"]} solicitudes, {integrity["new_invalid"]} inválidas/errores y {integrity["new_timeouts"]} timeouts. El máximo p95 por control es {max(r["http_p95_ms"] for r in off_rows):.6f} ms. Las solicitudes cambian al variar cuántos agentes siguen activos o son pasajeros; no es una carga HTTP idéntica. Los tiempos de planificación/pared/clientes son diagnósticos locales. Se conservaron recursos y fuente nativa, pero los tratamientos se midieron en bloques sucesivos, no en un ensayo alternado. No se atribuyen todas las diferencias de tiempo exclusivamente al costo de vehículos ni se acredita EC2/HTTPS.','',
              '## Recomendación y reproducibilidad','',
              '**Decisión para estas condiciones:** en BASE, C con flota alcanza 62,5% de supervivencia y 58,167% de evacuación; sin flota, 60,833%/55,833%. La mejora de supervivencia procede de diez personas en intensidad alta. En FULL, B sin flota alcanza 92%/59%; C sin flota, 91,833%/45,667%. La diferencia de supervivencia B−C es solo una persona de 600, mientras la diferencia de evacuación es 80. No demuestra superioridad estadística.', '',
              'Para una demo PRO con prioridad BASE, conservar C con flota es defendible con estas semillas. Para FULL y prioridad de supervivencia, preferir B sin flota; si la prioridad exclusiva es evacuación antes del horizonte, A con flota logra 73,667%, con 78,833% de supervivencia. La configuración official del proyecto sigue sin flota; este estudio no cambia los presets ni el despliegue.', '',
              '**Caso adverso más fuerte:** FULL C alta pierde 40 supervivientes con flota, aunque entrega 24 pasajeros. El emparejamiento muestra cinco ganancias y 45 pérdidas de supervivencia. En FULL A alta hay empate de 167 vivos, pero 18 ganancias y 18 pérdidas individuales. En BASE C baja el empate 146 oculta cuatro ganancias y cuatro pérdidas. Un empate global no implica que sobrevivan los mismos individuos.', '',
              'Elegir algoritmo y flota como dos factores separados. Para priorizar supervivencia, usar la comparación por grafo y tratamiento mostrada arriba; para evacuar antes del horizonte, revisar el segundo indicador. Una entrega positiva no justifica afirmar que la flota mejora el resultado neto. Esta ampliación permite defender efectos totales dentro del simulador y estas semillas, sin generalizar a otras poblaciones o geografías.','',
              '```sh','python3 tools/qa/track_a_fleet_report.py prepare','GOCACHE=/tmp/corodev-track-a-gocache node tools/scripts/go.mjs build -o /tmp/corodev-track-a-no-fleet ./cmd/compare','(cd services/evacuation && GOMAXPROCS=2 GOMEMLIMIT=7GiB prlimit --as=8589934592 -- taskset -c 0,1 /tmp/corodev-track-a-no-fleet --track-a-r3-no-fleet --reference ../../reports/track-a-evidence --output ../../reports/track-a-r3-no-fleet-evidence)','python3 tools/qa/track_a_fleet_report.py','```','',
              'Para reanudar la versión medida: `bash reports/track-a-r3-no-fleet-evidence/replay-frozen.sh`. El mismo binario/fuentes reanuda checkpoints; una versión distinta necesita otro directorio. El manifiesto fija fuente, recursos y referencia. Se conserva también binario/fuente congelados del control. El runner comprueba la fuente nativa original antes de avanzar. No se repitieron innecesariamente las18 R3 con flota ni las18 R2.','',
              'Archivos: [controles sin flota](track-a-r3-sin-flota.csv), [18 pares](track-a-r3-comparacion-flota.csv), [3600 transiciones individuales](track-a-r3-transiciones.csv), [curvas por turno](track-a-r3-curvas.csv), [manifiesto](track-a-r3-no-fleet-evidence/manifest.json), [integridad](track-a-r3-no-fleet-evidence/integrity.json), [resumen](track-a-r3-no-fleet-evidence/summary.json) e [informe original](track-a-experimento.md). Los datos privados permanecen en reports, ignorados por Git.']
    text='\n'.join(lines)+'\n'
    for a,b in [('las18','las 18'),('las36','las 36'),('Los18','Los 18'),('Los3600','Los 3600'),('son3600','son 3600'),('dentro de18','dentro de 18'),('conserva200','conserva 200'),('Conserva200','Conserva 200'),('completa150','completa 150'),('añaden2700','añaden 2700'),('totaliza54','totaliza 54'),('corridas/8100','corridas/8100'),('sumar2700','sumar 2700'),('seed20261028','seed 20261028'),('eventos,150','eventos, 150'),('afinidad0','afinidad 0'),('GOMAXPROCS2','GOMAXPROCS=2'),('virtual8GiB','virtual de 8 GiB'),('Go7GiB','Go de 7 GiB'),('asigna8GiB','asigna 8 GiB'),('de150','de 150'),('los200','los 200'),('en150','en 150'),('de150','de 150'),('BASE300','BASE 300'),('FULL_MANTA9179','FULL_MANTA 9179'),('registran{','registran{')]:text=text.replace(a,b)
    path=parent/'track-a-r3-flota.md';path.write_text(text);path.chmod(0o600)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('action',choices=['prepare','export'],default='export',nargs='?')
    p.add_argument('--directory',type=Path,default=ROOT/'reports/track-a-r3-no-fleet-evidence')
    p.add_argument('--reference',type=Path,default=ROOT/'reports/track-a-evidence')
    args=p.parse_args()
    if args.action=='prepare':prepare(args.directory,args.reference)
    else:export(args.directory)
