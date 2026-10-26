"""Offline evidence that published geometry and topology derive from cached OSM."""
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest

MODULE_PATH=Path(__file__).with_name('import_manta.py')
SPEC=importlib.util.spec_from_file_location('import_manta',MODULE_PATH)
geo=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(geo)


class ImportMantaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw=json.loads(gzip.decompress((geo.DATA/'manta.osm.json.gz').read_bytes()))
        cls.graph=json.loads((geo.DATA/'manta.json').read_text())
        cls.meta=json.loads((geo.DATA/'manta.provenance.json').read_text())

    def test_offline_reproduction(self):
        speeds=json.loads(MODULE_PATH.with_name('speeds.json').read_text())
        graph,meta=geo.import_graph(self.raw,300,speeds)
        self.assertEqual(graph,self.graph)
        self.assertEqual(meta,self.meta)
        self.assertEqual(hashlib.sha256(geo.canonical(self.raw)).hexdigest(),self.meta['raw_sha256'])

    def test_original_coordinates_and_real_neighbor_paths(self):
        segments={frozenset((a,b)) for way in self.raw['ways'] for a,b in zip(way['nodes'],way['nodes'][1:])}
        ways={w['id']:w for w in self.raw['ways']}
        for node in self.graph['nodes']:
            self.assertEqual([node['lat'],node['lng']],self.raw['nodes'][node['id'].removeprefix('OSM-')])
        for edge in self.graph['edges']:
            path=self.meta['edges'][edge['id']]['osm_node_path']
            self.assertEqual({path[0],path[-1]},{edge['from'].removeprefix('OSM-'),edge['to'].removeprefix('OSM-')})
            length=0
            for a,b in zip(path,path[1:]):
                self.assertIn(frozenset((a,b)),segments)
                length+=geo.distance(self.raw['nodes'][a],self.raw['nodes'][b])
            self.assertAlmostEqual(length,edge['distance_m'],delta=.00051)
            for wid in self.meta['edges'][edge['id']]['bridge_way_ids']:
                self.assertNotIn(ways[wid]['bridge'],['','no'])
        self.assertEqual(len(self.graph['nodes']),300)
        self.assertEqual(len(self.graph['shelters']),4)
        self.assertEqual(set(self.meta['neighborhood_places']),{'Barbasquillo','Tarqui Centro','Jocay','Los Esteros'})

    def test_access_filter_and_metadata_minimization(self):
        raw=b'''<osm><node id="1" lat="0" lon="0" user="discard"/><node id="2" lat="0" lon="0.001"/>
        <way id="1"><nd ref="1"/><nd ref="2"/><tag k="highway" v="primary"/><tag k="foot" v="no"/></way>
        <way id="2"><nd ref="1"/><nd ref="2"/><tag k="highway" v="residential"/><tag k="access" v="private"/></way>
        <way id="3"><nd ref="1"/><nd ref="2"/><tag k="highway" v="footway"/><tag k="bridge" v="yes"/></way></osm>'''
        nodes,ways,_=geo.parse_xml(raw)
        self.assertEqual(set(ways),{'3'})
        self.assertEqual(nodes['1'],[0.0,0.0])
        self.assertNotIn('discard',str(nodes))


if __name__=='__main__':unittest.main()
