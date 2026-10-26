"""Geographic evidence for the urban source and both honest junction budgets."""
import collections
import gzip
import hashlib
import json
from pathlib import Path
import unittest

import urban_manta as geo
from audit_graph import critical, adjacency, distances


class UrbanMantaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw=json.loads(gzip.decompress((geo.DATA/'manta-urban.osm.json.gz').read_bytes()))
        cls.boundaries=json.loads((geo.DATA/'manta-boundaries.json').read_text())
        cls.graphs={name:json.loads((geo.DATA/f'manta-{name}.json').read_text()) for name in ['master','v2','expanded']}
        cls.provenance={name:json.loads((geo.DATA/f'manta-{name}.provenance.json').read_text()) for name in cls.graphs}
        cls.source_segments={frozenset((a,b)) for way in cls.raw['ways'] for a,b in zip(way['nodes'],way['nodes'][1:])}

    def test_all_current_urban_parishes_present_in_master(self):
        graph=self.graphs['master']
        self.assertGreater(len(graph['nodes']),300)
        self.assertEqual(len(self.boundaries['urban_features']),6)
        for f in self.boundaries['urban_features']:
            self.assertTrue(any(geo.point_in_geometry(n['lng'],n['lat'],f['geometry']) for n in graph['nodes']),f['properties']['name'])
        self.assertTrue(any(n['lng']<-.80 for n in graph['nodes']),'western San Mateo was silently dropped')
        self.assertTrue(any(n['lat']<-1 for n in graph['nodes']),'southern urban source missing')
        self.assertTrue(all(source['url'].startswith('https://api.openstreetmap.org/api/0.6/map?bbox=') for source in self.raw['sources']))
        self.assertTrue(all(source['url'].startswith('https://geo.manta.gob.ec/') for source in self.boundaries['sources']))

    def test_edges_trace_real_osm_geometry_without_hidden_junctions(self):
        for name,graph in self.graphs.items():
            meta=self.provenance[name];junctions=set(meta['source_junction_ids'])
            self.assertEqual(meta['osm_raw_sha256'],hashlib.sha256(geo.canonical(self.raw)).hexdigest())
            for edge in graph['edges']:
                path=meta['edges'][edge['id']]['osm_node_path']
                self.assertEqual(edge['from'],'OSM-'+path[0]);self.assertEqual(edge['to'],'OSM-'+path[-1])
                self.assertFalse(junctions.intersection(path[1:-1]),(name,edge['id']))
                expected=[{'lat':self.raw['nodes'][n][0],'lng':self.raw['nodes'][n][1]} for n in path]
                self.assertEqual(edge['geometry'],expected)
                self.assertTrue(all(frozenset((a,b)) in self.source_segments for a,b in zip(path,path[1:])))
                length=sum(geo.distance(self.raw['nodes'][a],self.raw['nodes'][b]) for a,b in zip(path,path[1:]))
                self.assertAlmostEqual(edge['distance_m'],length,delta=.00051)
                self.assertEqual(edge['bridge'],bool(meta['edges'][edge['id']]['bridge_way_ids']))
                self.assertIn(edge['road_type'],geo.URBAN_HIGHWAYS)

    def test_competition_and_experimental_networks_connected_and_zones_sourced(self):
        for name,expected in [('v2',300),('expanded',1000)]:
            graph=self.graphs[name];adj=adjacency(graph)
            self.assertEqual(len(adj),expected)
            self.assertEqual(len(distances(adj,[graph['nodes'][0]['id']])),expected)
            refuges={s['node_id'] for s in graph['shelters']}
            self.assertEqual(len(refuges),4)
            self.assertEqual(sum(s['capacity'] for s in graph['shelters']),240)
            self.assertEqual({z['id'] for z in graph['spawn_zones']},{'tarqui','los-esteros','barbasquillo','jocay'})
            positions={n['id']:n for n in graph['nodes']}
            for zone in graph['spawn_zones']:
                self.assertGreater(len(set(zone['node_ids'])-refuges),0)
                self.assertEqual(zone['geometry'][0],zone['geometry'][-1])
                source=next(z for z in self.boundaries['spawn_zones'] if z['id']==zone['id'])
                for n in zone['node_ids']:
                    self.assertTrue(geo.point_in_geometry(positions[n]['lng'],positions[n]['lat'],source['geometry']))
            self.assertTrue(any(e['id']=='E-4420ceab96c993b4' and e['bridge'] for e in graph['edges']))

    def test_fase1_assets_stay_byte_identical(self):
        for suffix in ['json','provenance.json','osm.json.gz']:
            self.assertEqual((geo.DATA/f'manta.{suffix}').read_bytes(),(geo.DATA/f'manta-v1.{suffix}').read_bytes())

    def test_offline_reproduction(self):
        speeds=json.loads(Path(__file__).with_name('speeds.json').read_text())
        built=geo.build(self.raw,self.boundaries,speeds)
        for name,(graph,meta) in built.items():
            self.assertEqual(graph,self.graphs[name],name)
            self.assertEqual(meta,self.provenance[name],name)

    def test_parser_respects_public_foot_access_and_retains_real_arterial(self):
        xml=b'''<osm><node id="1" lat="0" lon="0"/><node id="2" lat="0" lon="0.001"/><way id="1"><nd ref="1"/><nd ref="2"/><tag k="highway" v="trunk"/><tag k="foot" v="permissive"/><tag k="oneway" v="yes"/></way><way id="2"><nd ref="1"/><nd ref="2"/><tag k="highway" v="trunk"/><tag k="foot" v="no"/></way><way id="3"><nd ref="1"/><nd ref="2"/><tag k="highway" v="residential"/><tag k="access" v="private"/><tag k="foot" v="yes"/><tag k="oneway:foot" v="yes"/></way></osm>'''
        nodes,ways,_=geo.parse_urban_xml(xml)
        self.assertEqual(set(ways),{'1','3'})
        self.assertEqual(ways['1']['vehicle_oneway'],'yes')
        self.assertEqual(ways['3']['foot_oneway'],'yes')
        self.assertEqual(set(nodes),{'1','2'})

    def test_articulation_algorithm_and_no_synthetic_connectors(self):
        adj={'a':{'b','c'},'b':{'a','c'},'c':{'a','b','d'},'d':{'c'}}
        articulations,bridges=critical(adj)
        self.assertEqual(articulations,['c']);self.assertEqual(bridges,[['c','d']])
        # Every connector used between administrative polygon pieces consists
        # of actual OSM adjacent node pairs; no boundary-to-boundary straight line.
        meta=self.provenance['master']['master_statistics']
        for path in meta.get('connector_paths',[]):
            self.assertTrue(all(frozenset((a,b)) in self.source_segments for a,b in zip(path,path[1:])))

if __name__=='__main__':unittest.main()
