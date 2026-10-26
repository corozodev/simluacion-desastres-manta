#!/usr/bin/env python3
"""Deterministic graph vulnerability evidence; no network calls or scenario edits."""
import argparse
import collections
from collections import deque
import json
import math
from pathlib import Path


def adjacency(graph, blocked_edges=(), blocked_nodes=()):
    closed, denied=set(blocked_edges),set(blocked_nodes)
    result={n['id']:set() for n in graph['nodes'] if n['id'] not in denied}
    for e in graph['edges']:
        if e['blocked'] or e['id'] in closed or e['from'] not in result or e['to'] not in result:continue
        result[e['from']].add(e['to'])
        if not e['directed']:result[e['to']].add(e['from'])
    return result


def distances(adj, starts):
    found={n:0 for n in starts if n in adj};queue=deque(found)
    while queue:
        n=queue.popleft()
        for v in sorted(adj[n]):
            if v not in found:found[v]=found[n]+1;queue.append(v)
    return found


def components(adj):
    remaining=set(adj);out=[]
    while remaining:
        seen=set(distances(adj,[min(remaining)]));remaining-=seen;out.append(seen)
    return sorted(out,key=lambda c:(-len(c),min(c)))


def critical(adj):
    # Iterative Tarjan supports the large urban master without recursion limits.
    timer=0;tin={};low={};parent={};children={};articulations=set();bridges=[]
    for start in sorted(adj):
        if start in tin:continue
        timer+=1;tin[start]=low[start]=timer;children[start]=0
        stack=[(start,iter(sorted(adj[start])))]
        while stack:
            u,neighbors=stack[-1]
            try:v=next(neighbors)
            except StopIteration:
                stack.pop()
                if u not in parent:
                    if children[u]>1:articulations.add(u)
                    continue
                p=parent[u];low[p]=min(low[p],low[u])
                if low[u]>tin[p]:bridges.append([p,u])
                if p in parent and low[u]>=tin[p]:articulations.add(p)
                continue
            if parent.get(u)==v:continue
            if v in tin:low[u]=min(low[u],tin[v]);continue
            parent[v]=u;children[u]+=1;children[v]=0
            timer+=1;tin[v]=low[v]=timer;stack.append((v,iter(sorted(adj[v]))))
    return sorted(articulations),sorted(bridges)


def quantiles(values):
    values=sorted(values)
    return {str(p):values[max(0,math.ceil(len(values)*p)-1)] for p in [0,.5,.95,.99,1]} if values else {}


def scenario_impact(graph, blocked_edges=(), blocked_nodes=()):
    adj=adjacency(graph,blocked_edges,blocked_nodes);cs=components(adj)
    reverse={n:set() for n in adj}
    for n,vs in adj.items():
        for v in vs:reverse[v].add(n)
    reachable=distances(reverse,[s['node_id'] for s in graph['shelters']])
    return {'components':len(cs),'component_sizes':[len(c) for c in cs],
            'blocked_nodes':len(set(blocked_nodes)), 'nodes_without_any_shelter':len(graph['nodes'])-len(reachable),
            'nodes_without_any_shelter_fraction':(len(graph['nodes'])-len(reachable))/len(graph['nodes'])}


def audit(graph, initial=None):
    directed=adjacency(graph);physical={n:set(v) for n,v in directed.items()}
    for n,vs in directed.items():
        for v in vs:physical[v].add(n)
    aps,bridges=critical(physical)
    cs=components(physical);degrees=[len(v) for v in physical.values()]
    shelter_distances={s['id']:distances(physical,[s['node_id']]) for s in graph['shelters']}
    nearest=[min(d.get(n,math.inf) for d in shelter_distances.values()) for n in physical]
    lookup={frozenset([e['from'],e['to']]):e['id'] for e in graph['edges']}
    important=sorted(graph['edges'],key=lambda e:(e['road_type'] not in ['primary','secondary'], -e['distance_m'],e['id']))[0]['id']
    multiplicity=collections.Counter(frozenset((e['from'],e['to'])) for e in graph['edges'])
    bridges=[pair for pair in bridges if multiplicity[frozenset(pair)]==1]
    critical_edges=[lookup[frozenset(pair)] for pair in bridges]
    single=[]
    for eid in (critical_edges if len(physical)<=1500 else []):
        r=scenario_impact(graph,[eid]);single.append((r['nodes_without_any_shelter'],eid))
    worst=sorted(single,key=lambda x:(-x[0],x[1]))
    horde=None
    if initial:
        zombies=initial.get('zombies',initial.get('initial_zombies',[]))
        denied={z['current_node'] for z in zombies if z['type']=='horde'}
        denied|={v for n in tuple(denied) for v in physical.get(n,[])}
        runners={z['current_node'] for z in zombies if z['type']=='runner'}
        horde={'horde_only':scenario_impact(graph,blocked_nodes=denied),'horde_and_visible_runner_positions':scenario_impact(graph,blocked_nodes=denied|runners),'initial_horde_nodes':sorted({z['current_node'] for z in zombies if z['type']=='horde'})}
    vulnerable=[]
    for n in (physical if len(physical)<=1500 else []):
        vulnerable.append((scenario_impact(graph,blocked_nodes={n}|physical[n])['nodes_without_any_shelter'],n))
    return {'graph_version':graph['version'],'nodes':len(physical),'edges':len(graph['edges']),
            'directed_edges':sum(e['directed'] for e in graph['edges']),
            'components':len(cs),'component_sizes':[len(c) for c in cs],
            'mean_degree':2*len(graph['edges'])/len(physical),'mean_distinct_neighbors':sum(degrees)/len(degrees),'degree_distribution':{str(d):degrees.count(d) for d in sorted(set(degrees))},
            'articulation_nodes':aps,'articulation_count':len(aps),'graph_bridges':critical_edges,'graph_bridge_count':len(bridges),
            'cycle_rank':len(graph['edges'])-len(physical)+len(cs),
            'edge_length_m':quantiles([e['distance_m'] for e in graph['edges']]),
            'nearest_shelter_hops':quantiles(nearest),'shelter_pair_hops':{a:{b:ds.get(s['node_id']) for b,s in [(s['id'],s) for s in graph['shelters']]} for a,ds in shelter_distances.items()},
            'static_access':scenario_impact(graph),'important_street_closed':{'edge_id':important,**scenario_impact(graph,[important])},
            'two_most_disconnecting_edges_closed':({'edge_ids':[p[1] for p in worst[:2]],**scenario_impact(graph,[p[1] for p in worst[:2]])} if len(physical)<=1500 else {'not_run':'exhaustive operational-cut stress skipped for source master >1500nodes'}),
            'worst_single_edge_closure':{'edge_id':worst[0][1],**scenario_impact(graph,[worst[0][1]])} if worst else None,
            'worst_horde_closed_neighborhood':({'node_id':max(vulnerable)[1],**scenario_impact(graph,blocked_nodes={max(vulnerable)[1]}|physical[max(vulnerable)[1]])} if vulnerable else {'not_run':'exhaustive per-node stress skipped for source master >1500nodes; operational variants measured'}),
            'actual_initial_hordes':horde,
            'bounds':[min(n['lng'] for n in graph['nodes']),min(n['lat'] for n in graph['nodes']),max(n['lng'] for n in graph['nodes']),max(n['lat'] for n in graph['nodes'])]}


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('graph',type=Path);p.add_argument('--initial',type=Path);p.add_argument('--output',type=Path)
    args=p.parse_args();g=json.loads(args.graph.read_text());initial=json.loads(args.initial.read_text()) if args.initial else None
    result=audit(g,initial);text=json.dumps(result,ensure_ascii=False,indent=2)+'\n'
    if args.output:args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(text)
    print(json.dumps({k:result[k] for k in ['graph_version','nodes','edges','mean_degree','articulation_count','graph_bridge_count','cycle_rank','edge_length_m','nearest_shelter_hops','static_access','two_most_disconnecting_edges_closed','worst_horde_closed_neighborhood']},ensure_ascii=False))

if __name__=='__main__':main()
