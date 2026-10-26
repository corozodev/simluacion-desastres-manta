#!/usr/bin/env python3
"""Build a verified urban Manta master and representative competition subnetworks.

Offline by default. --download refreshes public GeoManta boundaries and OSM Map
API tiles; dense tiles are split automatically. FASE 1 assets remain untouched.
"""
import argparse
import collections
import concurrent.futures
import datetime
import gzip
import hashlib
import heapq
import json
import math
from pathlib import Path
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

from import_manta import canonical, distance, HIGHWAYS, PRIORITY, DATA

BOUNDARY_BASE='https://geo.manta.gob.ec/geoserver-proxy/workspace_geomanta/ows?'
URBAN_HIGHWAYS=HIGHWAYS|{'trunk','trunk_link'}
URBAN_PRIORITY=dict(PRIORITY, trunk=0, trunk_link=0)
ZONE_SPECS=[('tarqui','Tarqui','Tarqui Centro'),('los-esteros','Los Esteros',None),('barbasquillo','Barbasquillo','Barbasquillo'),('jocay','Jocay','Jocay')]


def point_in_ring(lng,lat,ring):
    inside=False
    for a,b in zip(ring,ring[1:]):
        if ((a[1]>lat)!=(b[1]>lat)) and lng<(b[0]-a[0])*(lat-a[1])/(b[1]-a[1])+a[0]:inside=not inside
    return inside


def polygons(geom):
    return geom['coordinates'] if geom['type']=='MultiPolygon' else [geom['coordinates']]


def geometry_bounds(geom):
    pts=[point for poly in polygons(geom) for point in poly[0]]
    return min(p[0] for p in pts),min(p[1] for p in pts),max(p[0] for p in pts),max(p[1] for p in pts)


def point_in_geometry(lng,lat,geom):
    for poly in polygons(geom):
        xs=[p[0] for p in poly[0]];ys=[p[1] for p in poly[0]]
        if not min(xs)<=lng<=max(xs) or not min(ys)<=lat<=max(ys):continue
        if point_in_ring(lng,lat,poly[0]) and not any(point_in_ring(lng,lat,hole) for hole in poly[1:]):return True
    return False


def prepared_geometries(features):
    return [(geometry_bounds(f['geometry']),f['geometry']) for f in features]


def covered(point,prepared):
    lat,lng=point
    return any(b[0]<=lng<=b[2] and b[1]<=lat<=b[3] and point_in_geometry(lng,lat,g) for b,g in prepared)


def boundary_url(layer):
    return BOUNDARY_BASE+urllib.parse.urlencode({'service':'WFS','version':'1.0.0','request':'GetFeature','typeName':'workspace_geomanta:'+layer,'outputFormat':'application/json','srsName':'EPSG:4326','maxFeatures':1000})


def get_url(url,limit=64<<20):
    req=urllib.request.Request(url,headers={'User-Agent':'CoroDev-Manta-offline-geography/2.0','Accept':'application/xml,application/json'})
    with urllib.request.urlopen(req,timeout=40) as response:
        data=response.read(limit+1)
    if len(data)>limit:raise ValueError('source response exceeds bounded import limit')
    return data


def download_boundaries():
    parishes=json.loads(get_url(boundary_url('geo_parroquia')))
    barrios=json.loads(get_url(boundary_url('geo_barrio')))
    urban=[f for f in parishes['features'] if f['properties'].get('descripcio')=='Urbano']
    if len(urban)<5:raise ValueError('municipal urban parish classification changed; review geometry')
    lookup={f['properties'].get('text'):f for f in barrios['features']}
    zones=[]
    for zid,name,source_name in ZONE_SPECS:
        f=lookup[source_name] if source_name else next(f for f in urban if f['properties']['name']=='LOS ESTEROS')
        zones.append({'id':zid,'name':name,'source_feature_id':f['id'],'source_layer':'geo_barrio' if source_name else 'geo_parroquia','source_name':source_name or 'LOS ESTEROS','geometry':f['geometry'],'weight':1.0})
    return {'license':'municipal-public-geographic-service; no licensing claim beyond public access','retrieved_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'sources':[{'url':boundary_url(n),'layer':n} for n in ['geo_parroquia','geo_barrio']],
            'urban_features':urban,'spawn_zones':zones,
            'urban_filter':'descripcio == Urbano; six current published urban parishes; excludes Rural and unnamed peripheral remainder'}


def tiles_for(boundaries):
    pts=[p for f in boundaries['urban_features'] for poly in polygons(f['geometry']) for p in poly[0]]
    west,south,east,north=min(p[0] for p in pts),min(p[1] for p in pts),max(p[0] for p in pts),max(p[1] for p in pts)
    result=[];step=.025
    for i in range(math.ceil((east-west)/step)):
        for j in range(math.ceil((north-south)/step)):
            x,y=west+i*step,south+j*step
            box=[round(x-.00001,8),round(y-.00001,8),round(min(x+step,east)+.00001,8),round(min(y+step,north)+.00001,8)]
            corners=[(box[0],box[1]),(box[0],box[3]),(box[2],box[1]),(box[2],box[3]),((box[0]+box[2])/2,(box[1]+box[3])/2)]
            if any(box[0]<=p[0]<=box[2] and box[1]<=p[1]<=box[3] for p in pts) or any(point_in_geometry(a,b,f['geometry']) for a,b in corners for f in boundaries['urban_features']):result.append(box)
    return result


def parse_urban_xml(raw):
    root=ET.fromstring(raw);nodes={};ways={};places={}
    for e in root.findall('node'):
        nid=e.attrib['id'];nodes[nid]=[float(e.attrib['lat']),float(e.attrib['lon'])]
        tags={t.attrib['k']:t.attrib['v'] for t in e.findall('tag')}
        if 'place' in tags and 'name' in tags:places[nid]={'id':nid,'name':tags['name'],'lat':nodes[nid][0],'lng':nodes[nid][1]}
    for e in root.findall('way'):
        tags={t.attrib['k']:t.attrib['v'] for t in e.findall('tag')};foot=tags.get('foot')
        if tags.get('highway') not in URBAN_HIGHWAYS or foot=='no' or (tags.get('access') in {'private','no'} and foot not in {'yes','designated','permissive'}):continue
        refs=[n.attrib['ref'] for n in e.findall('nd')]
        if len(refs)<2 or any(n not in nodes for n in refs):continue
        ways[e.attrib['id']]={'id':e.attrib['id'],'nodes':refs,'road_type':tags['highway'],'name':tags.get('name',''),'vehicle_oneway':tags.get('oneway',''),'foot_oneway':tags.get('oneway:foot',''),'foot_access':foot or '', 'access':tags.get('access',''),'bridge':tags.get('bridge','')}
    used={n for w in ways.values() for n in w['nodes']}
    return {n:p for n,p in nodes.items() if n in used},ways,places


def download_osm(boundaries,cache):
    cache.mkdir(parents=True,exist_ok=True)
    def tile(box,label,depth=0):
        url='https://api.openstreetmap.org/api/0.6/map?bbox='+','.join(map(str,box))
        path=cache/('tile-'+label+'.osm')
        try:
            raw=path.read_bytes() if path.exists() else get_url(url)
            if not path.exists():path.write_bytes(raw)
        except urllib.error.HTTPError as e:
            if e.code!=400 or depth>=3:raise
            x0,y0,x1,y1=box;xm,ym=(x0+x1)/2,(y0+y1)/2
            results=[]
            for k,b in enumerate([[x0,y0,xm,ym],[xm,y0,x1,ym],[x0,ym,xm,y1],[xm,ym,x1,y1]]):results+=tile(b,label+'-'+str(k),depth+1)
            return results
        n,w,p=parse_urban_xml(raw)
        print(json.dumps({'tile':label,'bytes':len(raw),'road_nodes':len(n)}),flush=True)
        return [(n,w,p,{'url':url,'bbox':box})]
    nodes={};ways={};places={};sources=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        for results in pool.map(lambda item:tile(item[1],str(item[0])),enumerate(tiles_for(boundaries))):
            for n,w,p,source in results:nodes.update(n);ways.update(w);places.update(p);sources.append(source)
    return {'license':'ODbL-1.0','attribution':'© OpenStreetMap contributors','retrieved_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sources':sources,
            'nodes':nodes,'ways':[ways[k] for k in sorted(ways,key=int)],'places':[places[k] for k in sorted(places,key=int)]}


def components(adj):
    remaining=set(adj);out=[]
    while remaining:
        first=min(remaining,key=int);seen={first};queue=[first]
        for n in queue:
            for v in adj[n]:
                if v not in seen:seen.add(v);queue.append(v)
        remaining-=seen;out.append(seen)
    return sorted(out,key=lambda x:(-len(x),min(map(int,x))))


def make_master(raw,boundaries):
    nodes=raw['nodes'];alladj=collections.defaultdict(dict)
    for way in raw['ways']:
        for a,b in zip(way['nodes'],way['nodes'][1:]):
            if a==b:continue
            d=distance(nodes[a],nodes[b])
            if d<=0:continue
            edge={'distance_m':d,'road_type':way['road_type'],'way_ids':[way['id']],'bridge_way_ids':[way['id']] if way.get('bridge') not in {'','no',None} else [],'foot_oneway':way.get('foot_oneway','')}
            if edge['foot_oneway']=='-1':a,b=b,a;edge['foot_oneway']='yes'
            edge['forward']=(a,b)
            if b not in alladj[a] or URBAN_PRIORITY[edge['road_type']]<URBAN_PRIORITY[alladj[a][b]['road_type']]:alladj[a][b]=edge;alladj[b][a]=edge
    prepared=prepared_geometries(boundaries['urban_features'])
    inside={n for n,p in nodes.items() if covered(p,prepared)}
    # Municipal urban polygons are not a topological fence: a real street can
    # cross a small unclassified gap and reconnect two urban areas. Preserve
    # sourced connecting corridors rather than silently dropping San Mateo.
    pts=[p for f in boundaries['urban_features'] for poly in polygons(f['geometry']) for p in poly[0]]
    box=(min(p[0] for p in pts),min(p[1] for p in pts),max(p[0] for p in pts),max(p[1] for p in pts))
    relevant={n for n,p in nodes.items() if box[0]-.0001<=p[1]<=box[2]+.0001 and box[1]-.0001<=p[0]<=box[3]+.0001}
    full={n:{v:e for v,e in vs.items() if v in relevant} for n,vs in alladj.items() if n in relevant}
    largest_full=components(full)[0]
    inside &= largest_full
    urban_adj={n:{v:e for v,e in alladj[n].items() if v in inside} for n in inside}
    groups=components(urban_adj);component=set(groups[0]);connector_paths=[]
    relevant_adj={n:{v:e for v,e in full[n].items() if v in largest_full} for n in largest_full}
    for group in groups[1:]:
        if group<=component:continue
        route=shortest(relevant_adj,min(group,key=int),component)
        if not route:raise ValueError('an urban source component has no valid connecting street')
        connector_paths.append(route)
        component.update(group);component.update(route)
    adj={n:{v:e for v,e in alladj[n].items() if v in component} for n in component}
    original_junctions={n for n in alladj if len(alladj[n])!=2}
    foot_direction_nodes={n for way in raw['ways'] if way.get('foot_oneway') in {'yes','1','true','-1'} for n in way['nodes']}
    junctions={n for n in component if len(adj[n])!=2 or n in original_junctions or n in foot_direction_nodes}
    # Official spawn polygons must contain real graph nodes. Pick anchors from
    # junctions; no place label is silently substituted for municipal geometry.
    zone_anchors={}
    for zone in boundaries['spawn_zones']:
        candidates=[n for n in junctions if point_in_geometry(nodes[n][1],nodes[n][0],zone['geometry'])]
        if not candidates:raise ValueError('urban component lacks spawn zone '+zone['id'])
        ring=max(polygons(zone['geometry']),key=lambda p:len(p[0]))[0]
        center=[sum(p[1] for p in ring)/len(ring),sum(p[0] for p in ring)/len(ring)]
        zone_anchors[zone['id']]=min(candidates,key=lambda n:(distance(nodes[n],center),int(n)))
    junctions|=set(zone_anchors.values())
    compressed={n:{} for n in junctions};traversed=set();traces={}
    for start in sorted(junctions,key=int):
        for first,e in sorted(adj[start].items(),key=lambda p:int(p[0])):
            if frozenset((start,first)) in traversed:continue
            path=[start,first];segments=[e];previous,current=start,first;traversed.add(frozenset((start,first)))
            while current not in junctions:
                nxt=next(v for v in adj[current] if v!=previous)
                segments.append(adj[current][nxt]);path.append(nxt);traversed.add(frozenset((current,nxt)));previous,current=current,nxt
            if current==start:continue
            total=sum(seg['distance_m'] for seg in segments);types=collections.defaultdict(float)
            for seg in segments:types[seg['road_type']]+=seg['distance_m']
            typ=min(types,key=lambda t:(-types[t],URBAN_PRIORITY[t],t))
            directed=any(seg['foot_oneway'] in {'yes','1','true'} for seg in segments)
            if directed and segments[0]['forward']!=(path[0],path[1]):path=path[::-1]
            a,b=path[0],path[-1]
            if int(a)>int(b) and not directed:path=path[::-1];a,b=b,a
            eid='E-'+hashlib.sha256(canonical(path)).hexdigest()[:16]
            trace={'osm_node_path':path,'osm_way_ids':sorted({w for seg in segments for w in seg['way_ids']},key=int),'bridge_way_ids':sorted({w for seg in segments for w in seg['bridge_way_ids']},key=int)}
            item={'id':eid,'from':a,'to':b,'distance_m':total,'road_type':typ,'directed':directed,'path':path}
            # Multiple real parallel streets remain separate edges. Adjacency
            # selects the shortest only for selecting node corridors.
            trace.update({'distance_m':total,'road_type':typ,'directed':directed})
            traces[eid]=trace
            if b not in compressed[a] or total<compressed[a][b]['distance_m']:compressed[a][b]=item;compressed[b][a]=item
    return nodes,compressed,traces,junctions,zone_anchors,{'raw_public_nodes':len(alladj),'inside_urban_nodes':len(inside),'urban_components':len(groups),'retained_component_nodes':len(component),'connected_urban_component_sizes':[len(c) for c in groups], 'connector_paths':connector_paths,'connector_nodes_outside_urban':len(component-inside),'discarded_unreachable_raw_component_sizes':[len(c) for c in components(full)[1:]],'original_junction_ids':sorted(original_junctions,key=int)}


def shortest(adj,start,goals,forbidden=()):
    goals=set(goals);forbidden=set(forbidden);queue=[(0,int(start),start)];cost={start:0};prev={}
    while queue:
        d,_,n=heapq.heappop(queue)
        if d!=cost[n]:continue
        if n in goals:
            path=[n]
            while n in prev:n=prev[n];path.append(n)
            return path[::-1]
        for v,e in sorted(adj[n].items(),key=lambda p:int(p[0])):
            if v in forbidden:continue
            nd=d+1+e['distance_m']/100000
            if nd<cost.get(v,math.inf):cost[v]=nd;prev[v]=n;heapq.heappush(queue,(nd,int(v),v))
    return []


def select_nodes(nodes,adj,zone_anchors,boundaries,target,traces):
    selected={zone_anchors['tarqui']}
    mandatory=[]
    for anchor in zone_anchors.values():
        if anchor not in selected:
            path=shortest(adj,anchor,selected);selected.update(path);mandatory.append({'kind':'spawn_zone','node_id':'OSM-'+anchor,'added':len(path)-1})
    bridge=next((e for vs in adj.values() for e in vs.values() if '32491400' in traces[e['id']]['bridge_way_ids']),None)
    if bridge:
        for anchor in [bridge['from'],bridge['to']]:selected.update(shortest(adj,anchor,selected))
    minimum=len(selected)
    if minimum>target:raise ValueError(f'four zones require {minimum} actual junction nodes; cannot fit target {target} without hidden intersections')
    # Connect geographic centers of all published urban parishes when budget
    # permits. Never replace a real multi-junction path by a shortcut.
    centers=[]
    for feature in boundaries['urban_features']:
        candidates=[n for n in adj if point_in_geometry(nodes[n][1],nodes[n][0],feature['geometry'])]
        if not candidates:continue
        box=geometry_bounds(feature['geometry']);center=[(box[1]+box[3])/2,(box[0]+box[2])/2]
        anchor=min(candidates,key=lambda n:(distance(nodes[n],center),int(n)))
        path=shortest(adj,anchor,selected);added=set(path)-selected
        if len(selected|added)<=int(target*.8):selected|=added;centers.append({'parish':feature['properties']['name'],'node_id':'OSM-'+anchor,'added':len(added)})
        else:centers.append({'parish':feature['properties']['name'],'node_id':'OSM-'+anchor,'omitted_reason':'honest junction budget','required_additional_nodes':len(added)})
    # A bypass outside the selected network creates a real cycle. Enumerate
    # short detours, favor many new links per added junction, then fill boundary.
    while len(selected)<target:
        remaining=target-len(selected);best=None
        boundary=sorted({v for n in selected for v in adj[n] if v not in selected},key=int)
        for start in boundary:
            neighbors=sorted(set(adj[start])&selected,key=int)
            if len(neighbors)>=2:
                value=(-len(neighbors),1,int(start),[start])
                if best is None or value[:3]<best[:3]:best=value
        if best is not None:selected.add(best[3][0]);continue
        # Search a bounded bypass from each frontier node to a second selected
        # endpoint; this prioritizes closing actual street blocks over spurs.
        for start in boundary[:160]:
            origin=set(adj[start])&selected;queue=collections.deque([(start,[start])]);seen={start}
            found=None
            while queue:
                n,path=queue.popleft()
                if len(path)>min(remaining,8):continue
                exits=(set(adj[n])&selected)-origin
                if exits:found=path;break
                for v in sorted(adj[n],key=int):
                    if v not in selected and v not in seen:seen.add(v);queue.append((v,path+[v]))
            if found:
                value=(len(found),int(start),found)
                if best is None or value[:2]<best[:2]:best=value
        if best is not None:selected.update(best[-1]);continue
        if not boundary:break
        # Last-resort valid expansion prioritizes junction degree and source
        # arterials, never proximity without a real edge.
        n=min(boundary,key=lambda n:(-len(adj[n]),min(URBAN_PRIORITY[e['road_type']] for e in adj[n].values()),int(n)))
        selected.add(n)
    return selected,{'minimum_nodes_to_connect_spawn_anchors':minimum,'urban_parish_anchor_attempts':centers,'method':'real junction corridor union plus shortest cycle-closing bypasses; no hidden junction contractions'}


def hull(points):
    points=sorted(set(points))
    def cross(o,a,b):return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0])
    lower=[]
    for p in points:
        while len(lower)>=2 and cross(lower[-2],lower[-1],p)<=0:lower.pop()
        lower.append(p)
    upper=[]
    for p in reversed(points):
        while len(upper)>=2 and cross(upper[-2],upper[-1],p)<=0:upper.pop()
        upper.append(p)
    ring=lower[:-1]+upper[:-1]
    return ring+[ring[0]]


def export_graph(nodes,adj,traces,selected,boundaries,speeds,variant,master_meta,selection_meta):
    output_nodes=[{'id':'OSM-'+n,'lat':nodes[n][0],'lng':nodes[n][1]} for n in sorted(selected,key=int)]
    edge_ids={e['id'] for a in selected for b,e in adj[a].items() if b in selected}
    # Preserve all parallel source paths, not only the path used by the selector.
    for eid,trace in traces.items():
        if trace['osm_node_path'][0] in selected and trace['osm_node_path'][-1] in selected:edge_ids.add(eid)
    all_by_id={e['id']:e for vs in adj.values() for e in vs.values()}
    output_edges=[]
    for eid in sorted(edge_ids):
        trace=traces[eid];path=trace['osm_node_path'];item=all_by_id.get(eid) or dict(trace,**{'from':path[0],'to':path[-1]})
        output_edges.append({'id':eid,'from':'OSM-'+item['from'],'to':'OSM-'+item['to'],'distance_m':round(item['distance_m'],3),'road_type':item['road_type'],'speed_mps':speeds[item['road_type']],'blocked':False,'directed':item['directed'],'bridge':bool(trace['bridge_way_ids']),'geometry':[{'lat':nodes[n][0],'lng':nodes[n][1]} for n in path]})
    zones=[]
    for zone in boundaries['spawn_zones']:
        ids=[n['id'] for n in output_nodes if point_in_geometry(n['lng'],n['lat'],zone['geometry'])]
        if not ids:raise ValueError('selected subnetwork does not cover '+zone['id'])
        poly=max(polygons(zone['geometry']),key=lambda p:len(p[0]))[0]
        zones.append({'id':zone['id'],'name':zone['name'],'source':boundary_url(zone['source_layer'])+'; feature='+zone['source_feature_id']+'; '+zone['source_name'],
                      'geometry':[{'lat':p[1],'lng':p[0]} for p in poly],'node_ids':ids,'weight':zone['weight']})
    # Farthest-point refuges chosen once from geography only, not zombie seeds.
    # Prefer at least3 neighbors to reduce arbitrary cul-de-sac destinations.
    candidates=[n for n in selected if sum(v in selected for v in adj[n])>=3]
    if len(candidates)<4:candidates=sorted(selected,key=int)
    chosen=[]
    points=[nodes[n] for n in selected];center=[sum(p[0] for p in points)/len(points),sum(p[1] for p in points)/len(points)]
    chosen.append(min(candidates,key=lambda n:(distance(nodes[n],center),int(n))))
    while len(chosen)<4:
        chosen.append(min((n for n in candidates if n not in chosen),key=lambda n:(-min(distance(nodes[n],nodes[c]) for c in chosen),int(n))))
    shelters=[{'id':'R-'+str(i+1),'node_id':'OSM-'+n,'capacity':60,'occupancy':0} for i,n in enumerate(chosen)]
    allpoints=[(p[0],p[1]) for f in boundaries['urban_features'] for poly in polygons(f['geometry']) for p in poly[0]]
    coverage=[{'lat':p[1],'lng':p[0]} for p in hull(allpoints)]
    graph={'source':'© OpenStreetMap contributors; ODbL-1.0; urban Manta '+variant+'; municipal GeoManta spawn polygons; fictitious shelters',
           'nodes':output_nodes,'edges':output_edges,'shelters':shelters,'spawn_zones':zones,'coverage':coverage}
    graph['version']='manta-'+variant+'-'+hashlib.sha256(canonical(graph)).hexdigest()[:12]
    metadata={'graph_version':graph['version'],'variant':variant,'license':'ODbL-1.0 for OSM-derived road data; municipal boundaries retain source terms',
              'master_statistics':{k:v for k,v in master_meta.items() if k!='original_junction_ids'},'selection':selection_meta,
              'nodes':len(output_nodes),'edges_count':len(output_edges),'source_junction_ids':master_meta['original_junction_ids'],
              'edges':{e['id']:traces[e['id']] for e in output_edges},'physical_bridge_edges':[e['id'] for e in output_edges if traces[e['id']]['bridge_way_ids']],
              'shelter_selection':'fictitious geography-only farthest-point sampling among selected degree>=3 junctions; first nearest network centroid;60places each',
              'shelters':[dict(s,lat=nodes[s['node_id'][4:]][0],lng=nodes[s['node_id'][4:]][1]) for s in shelters],
              'coverage_warning':'coverage is a display envelope of municipal urban parishes, NOT a claim that the selected graph covers every street or the envelope area'}
    return graph,metadata


def build(raw,boundaries,speeds,targets=(300,1000)):
    nodes,adj,traces,junctions,anchors,meta=make_master(raw,boundaries)
    result={}
    graph,provenance=export_graph(nodes,adj,traces,junctions,boundaries,speeds,'master',meta,{'method':'all relevant genuine junctions in largest connected public pedestrian component of current municipal urban parishes'})
    result['master']=(graph,provenance)
    for name,target in zip(['v2','expanded'],targets):
        selected,selection=select_nodes(nodes,adj,anchors,boundaries,target,traces)
        result[name]=export_graph(nodes,adj,traces,selected,boundaries,speeds,name,meta,selection)
    for name,(graph,p) in result.items():
        p['osm_sources']=raw['sources'];p['osm_retrieved_at_utc']=raw['retrieved_at_utc'];p['osm_raw_sha256']=hashlib.sha256(canonical(raw)).hexdigest();p['boundary_sources']=boundaries['sources'];p['boundary_sha256']=hashlib.sha256(canonical(boundaries)).hexdigest()
    return result


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--download',action='store_true');p.add_argument('--cache',type=Path,default=Path(tempfile.gettempdir())/'corodev-urban-osm-tiles');p.add_argument('--target-nodes',type=int,default=300);p.add_argument('--expanded-nodes',type=int,default=1000)
    args=p.parse_args()
    if args.target_nodes<4 or args.expanded_nodes<args.target_nodes:p.error('invalid graph sizes')
    if args.download:
        boundaries=download_boundaries();raw=download_osm(boundaries,args.cache)
        (DATA/'manta-boundaries.json').write_text(json.dumps(boundaries,ensure_ascii=False,indent=2)+'\n')
        (DATA/'manta-urban.osm.json.gz').write_bytes(gzip.compress(canonical(raw),mtime=0))
    else:boundaries=json.loads((DATA/'manta-boundaries.json').read_text());raw=json.loads(gzip.decompress((DATA/'manta-urban.osm.json.gz').read_bytes()))
    speeds=json.loads(Path(__file__).with_name('speeds.json').read_text())
    for name,(graph,provenance) in build(raw,boundaries,speeds,(args.target_nodes,args.expanded_nodes)).items():
        (DATA/('manta-'+name+'.json')).write_text(json.dumps(graph,ensure_ascii=False,indent=2)+'\n')
        (DATA/('manta-'+name+'.provenance.json')).write_text(json.dumps(provenance,ensure_ascii=False,indent=2)+'\n')
        print(json.dumps({'variant':name,'version':graph['version'],'nodes':len(graph['nodes']),'edges':len(graph['edges']),'zones':[(z['id'],len(z['node_ids'])) for z in graph['spawn_zones']],'selection':provenance['selection'],'bridges':provenance['physical_bridge_edges']}),flush=True)

if __name__=='__main__':main()
