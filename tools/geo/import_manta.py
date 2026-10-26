#!/usr/bin/env python3
"""Import a real OSM pedestrian road subnetwork without runtime dependencies.

Default: offline conversion of the checked-in filtered OSM snapshot. --download
refreshes four modest Map API tiles (one acquisition, never called by Go).
All published coordinates remain original OSM node coordinates. Junctions along
unselected side streets are omitted; edges never jump across an omitted junction.
"""
import argparse
import collections
import datetime
import gzip
import hashlib
import heapq
import json
import math
from pathlib import Path
import urllib.request
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "services/evacuation/data"
TILES = [(-80.77,-0.965,-80.74,-0.94),(-80.745,-0.965,-80.725,-0.935),
         (-80.73,-0.96,-80.70,-0.93),(-80.705,-0.965,-80.69,-0.935)]
HIGHWAYS = {"primary", "primary_link", "secondary", "secondary_link", "tertiary",
            "tertiary_link", "unclassified", "residential", "living_street", "service",
            "pedestrian", "footway", "path", "steps"}
SPEEDS = {"primary":1.5,"primary_link":1.5,"secondary":1.45,"secondary_link":1.45,
          "tertiary":1.4,"tertiary_link":1.4,"residential":1.35,"unclassified":1.35,
          "living_street":1.3,"service":1.2,"pedestrian":1.4,"footway":1.3,"path":1.1,"steps":0.7}
PRIORITY = {"primary":0,"primary_link":0,"secondary":1,"secondary_link":1,
            "tertiary":2,"tertiary_link":2,"unclassified":3,"residential":4,
            "living_street":4,"pedestrian":4,"service":5,"footway":6,"path":7,"steps":8}


def canonical(value):
    return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(",", ":")).encode()


def distance(a,b):
    lat1,lon1,lat2,lon2=map(math.radians,(*a,*b))
    h=math.sin((lat2-lat1)/2)**2+math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2
    return 6371008.8 * 2 * math.asin(min(1,math.sqrt(h)))


def parse_xml(raw):
    """Retain only road data and named places, discarding user/POI metadata."""
    root=ET.fromstring(raw)
    nodes={}
    places={}
    ways={}
    for element in root.findall("node"):
        nid=element.attrib["id"]
        nodes[nid]=[float(element.attrib["lat"]),float(element.attrib["lon"])]
        tags={t.attrib["k"]:t.attrib["v"] for t in element.findall("tag")}
        if "place" in tags and "name" in tags:
            places[nid]={"id":nid,"name":tags["name"],"lat":nodes[nid][0],"lng":nodes[nid][1]}
    for element in root.findall("way"):
        tags={t.attrib["k"]:t.attrib["v"] for t in element.findall("tag")}
        if tags.get("highway") not in HIGHWAYS or tags.get("access") in {"private","no"} or tags.get("foot") == "no":
            continue
        # Explicit foot=yes can override general access restrictions in a future importer.
        refs=[n.attrib["ref"] for n in element.findall("nd")]
        if len(refs)<2 or any(n not in nodes for n in refs):
            continue
        ways[element.attrib["id"]]={"id":element.attrib["id"],"nodes":refs,"road_type":tags["highway"],
                                      "name":tags.get("name",""),"vehicle_oneway":tags.get("oneway",""),"bridge":tags.get("bridge","")}
    used={n for w in ways.values() for n in w["nodes"]}
    return {n:v for n,v in nodes.items() if n in used},ways,places


def acquire(paths=None):
    nodes,ways,places={},{},{}
    sources=[]
    for index,bbox in enumerate(TILES):
        url="https://api.openstreetmap.org/api/0.6/map?bbox="+",".join(map(str,bbox))
        if paths:
            raw=Path(paths[index]).read_bytes()
        else:
            req=urllib.request.Request(url,headers={"User-Agent":"CoroDev-evacuation-local-graph-import/1.0","Accept":"application/xml"})
            with urllib.request.urlopen(req,timeout=45) as response:
                raw=response.read(40<<20)
        n,w,p=parse_xml(raw)
        nodes.update(n);ways.update(w);places.update(p)
        sources.append({"url":url,"bbox":bbox})
    return {"license":"ODbL-1.0","attribution":"© OpenStreetMap contributors",
            "retrieved_at_utc":datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "sources":sources,"nodes":nodes,"ways":[ways[k] for k in sorted(ways,key=int)],
            "places":[places[k] for k in sorted(places,key=int)]}


def largest_component(adjacency):
    remaining=set(adjacency)
    largest=set()
    while remaining:
        start=min(remaining,key=int)
        seen={start};q=[start]
        for n in q:
            for other in adjacency[n]:
                if other not in seen:
                    seen.add(other);q.append(other)
        remaining-=seen
        if len(seen)>len(largest):largest=seen
    return largest


def shortest_path(adjacency,start,goal):
    queue=[(0,start)];cost={start:0};previous={}
    while queue:
        c,n=heapq.heappop(queue)
        if c != cost[n]:continue
        if n==goal:
            route=[n]
            while n in previous:n=previous[n];route.append(n)
            return route[::-1]
        for other,e in sorted(adjacency[n].items()):
            # Prefer road backbone when distances are comparable.
            candidate=c+e["distance_m"]*(1+PRIORITY.get(e["road_type"],5)*0.08)
            if candidate<cost.get(other,float("inf")):
                cost[other]=candidate;previous[other]=n;heapq.heappush(queue,(candidate,other))
    raise ValueError("disconnected neighborhood anchors")


def import_graph(raw,target,speeds):
    nodes=raw["nodes"]
    adjacency=collections.defaultdict(dict)
    for way in raw["ways"]:
        for a,b in zip(way["nodes"],way["nodes"][1:]):
            if a==b:continue
            d=distance(nodes[a],nodes[b])
            if d<=0:continue
            edge={"distance_m":d,"road_type":way["road_type"],"osm_way_ids":[way["id"]],"bridge_way_ids":[way["id"]] if way.get("bridge") not in {"", "no", None} else []}
            # Merge identical segment references shared by multiple OSM ways.
            if b not in adjacency[a] or PRIORITY[edge["road_type"]]<PRIORITY[adjacency[a][b]["road_type"]]:
                adjacency[a][b]=edge;adjacency[b][a]=edge
    component=largest_component(adjacency)
    adjacency={n:{o:e for o,e in adjacency[n].items() if o in component} for n in component}
    anchor_names=["Barbasquillo","Tarqui Centro","Jocay","Los Esteros"]
    anchors={}
    anchor_places={}
    for name in anchor_names:
        exact=[p for p in raw["places"] if p["name"].casefold()==name.casefold()]
        if not exact:
            exact=[p for p in raw["places"] if name.casefold() in p["name"].casefold()]
        if not exact:
            raise ValueError("OSM snapshot lacks named neighborhood "+name)
        place=sorted(exact,key=lambda p:int(p["id"]))[0]
        anchor=min(component,key=lambda n:(distance(nodes[n],[place["lat"],place["lng"]]),int(n)))
        anchors[name]=anchor;anchor_places[name]=place
    junctions={n for n in component if len(adjacency[n])!=2}|set(anchors.values())
    compressed=collections.defaultdict(dict)
    provenance={}
    traversed=set()
    for start in sorted(junctions,key=int):
        for neighbor,initial in sorted(adjacency[start].items(),key=lambda p:int(p[0])):
            if frozenset((start,neighbor)) in traversed:continue
            path=[start,neighbor];prev,current=start,neighbor;segments=[initial]
            traversed.add(frozenset((start,neighbor)))
            while current not in junctions:
                next_node=next(n for n in adjacency[current] if n!=prev)
                segments.append(adjacency[current][next_node]);path.append(next_node)
                traversed.add(frozenset((current,next_node)))
                prev,current=current,next_node
            if start==current:continue
            types=collections.defaultdict(float)
            for segment in segments:types[segment["road_type"]]+=segment["distance_m"]
            road_type=min(types,key=lambda t:(-types[t],PRIORITY[t],t))
            length=sum(e["distance_m"] for e in segments)
            edge={"distance_m":length,"road_type":road_type,"osm_node_path":path,
                  "osm_way_ids":sorted({wid for seg in segments for wid in seg["osm_way_ids"]},key=int),
                  "bridge_way_ids":sorted({wid for seg in segments for wid in seg["bridge_way_ids"]},key=int)}
            if current not in compressed[start] or length<compressed[start][current]["distance_m"]:
                compressed[start][current]=edge;compressed[current][start]=edge
    selected={anchors[anchor_names[0]]}
    for name in anchor_names[1:]:selected.update(shortest_path(compressed,anchors[anchor_names[0]],anchors[name]))
    if len(selected)>target:raise ValueError(f"neighborhood connecting corridors need {len(selected)} nodes; increase --target-nodes")
    # Grow a connected, reproducible corridor subnetwork. Keep main road links
    # first; tie breaks prefer points near all four neighborhood centers.
    def frontier_key(node,edge):
        near=min(distance(nodes[node],nodes[a]) for a in anchors.values())
        return (PRIORITY.get(edge["road_type"],5),near,int(node),node)
    frontier=[]
    def extend(n):
        for other,e in compressed[n].items():
            if other not in selected:heapq.heappush(frontier,frontier_key(other,e))
    for n in sorted(selected,key=int):extend(n)
    while frontier and len(selected)<target:
        *_,n=heapq.heappop(frontier)
        if n in selected:continue
        selected.add(n);extend(n)
    output_nodes=[{"id":"OSM-"+n,"lat":nodes[n][0],"lng":nodes[n][1]} for n in sorted(selected,key=int)]
    output_edges=[]
    for a in sorted(selected,key=int):
        for b,e in sorted(compressed[a].items(),key=lambda p:int(p[0])):
            if b not in selected or int(a)>=int(b):continue
            eid="E-"+hashlib.sha256(canonical(e["osm_node_path"])).hexdigest()[:16]
            output_edges.append({"id":eid,"from":"OSM-"+a,"to":"OSM-"+b,"distance_m":round(e["distance_m"],3),
                                 "road_type":e["road_type"],"speed_mps":speeds[e["road_type"]],"blocked":False,"directed":False})
            provenance[eid]={"osm_node_path":e["osm_node_path"],"osm_way_ids":e["osm_way_ids"],"bridge_way_ids":e["bridge_way_ids"]}
    shelters=[{"id":"R-"+str(i+1),"node_id":"OSM-"+anchors[name],"capacity":60,"occupancy":0} for i,name in enumerate(anchor_names)]
    graph={"source":"© OpenStreetMap contributors; ODbL-1.0; pedestrian corridor subnetwork", "nodes":output_nodes,"edges":output_edges,"shelters":shelters}
    graph["version"]="manta-osm-"+hashlib.sha256(canonical(graph)).hexdigest()[:12]
    metadata={"attribution":raw["attribution"],"license":raw["license"],"sources":raw["sources"],
              "retrieved_at_utc":raw["retrieved_at_utc"],"graph_version":graph["version"],
              "raw_sha256":hashlib.sha256(canonical(raw)).hexdigest(),"full_connected_road_nodes":len(component),
              "full_junction_nodes":len(junctions),"selected_nodes":len(output_nodes),"selected_edges":len(output_edges),
              "neighborhood_places":anchor_places,"shelter_neighborhoods":{s["id"]:name for s,name in zip(shelters,anchor_names)},
              "method":"Connected ~300-junction corridor subnetwork; degree-2 geometry contracted; side streets omitted; original OSM coordinates; undirected pedestrian travel; each edge path retained below.",
              "edges":provenance}
    return graph,metadata


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--download",action="store_true")
    parser.add_argument("--raw",type=Path,default=DATA/"manta.osm.json.gz")
    parser.add_argument("--output",type=Path,default=DATA/"manta.json")
    parser.add_argument("--target-nodes",type=int,default=300)
    parser.add_argument("--speeds",type=Path,default=Path(__file__).with_name("speeds.json"))
    parser.add_argument("--xml-tiles",nargs=4,help=argparse.SUPPRESS)
    args=parser.parse_args()
    if args.target_nodes<4:parser.error("--target-nodes must be >=4")
    if args.download or args.xml_tiles:
        raw=acquire(args.xml_tiles)
        args.raw.parent.mkdir(parents=True,exist_ok=True)
        args.raw.write_bytes(gzip.compress(canonical(raw),mtime=0))
    else:
        raw=json.loads(gzip.decompress(args.raw.read_bytes()))
    speeds=json.loads(args.speeds.read_text())
    if set(HIGHWAYS)-speeds.keys() or any(not isinstance(x,(int,float)) or not math.isfinite(x) or x<=0 for x in speeds.values()):
        parser.error("all highway speeds must be finite positive numbers")
    graph,metadata=import_graph(raw,args.target_nodes,speeds)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(graph,ensure_ascii=False,indent=2)+"\n")
    args.output.with_suffix(".provenance.json").write_text(json.dumps(metadata,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps({"graph":str(args.output),"version":graph["version"],"nodes":len(graph["nodes"]),"edges":len(graph["edges"]),"shelters":len(graph["shelters"]),"raw_sha256":metadata["raw_sha256"]}))


if __name__=="__main__":main()
