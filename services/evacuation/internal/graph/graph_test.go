package graph

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"testing"

	"corodev/evacuation/internal/world"
)

func fixture() *world.Graph {
	return &world.Graph{Version: "test-v1", Source: "synthetic-test-only", Nodes: []world.GraphNode{{ID: "a", Lat: 0, Lng: 0}, {ID: "b", Lat: 0, Lng: 0.001}, {ID: "c", Lat: 0.001, Lng: 0.001}}, Edges: []world.GraphEdge{{ID: "ab", From: "a", To: "b", DistanceM: 111, RoadType: "residential", SpeedMPS: 1.4}, {ID: "bc", From: "b", To: "c", DistanceM: 111, RoadType: "residential", SpeedMPS: 1.4}}, Shelters: []world.Shelter{{ID: "R1", NodeID: "c", Capacity: 10}}}
}

func TestNeighborsAndBlocks(t *testing.T) {
	idx, err := New(fixture())
	if err != nil {
		t.Fatal(err)
	}
	neighbors := idx.Neighbors("b", nil)
	if len(neighbors) != 2 || neighbors[0].To != "a" || neighbors[1].To != "c" {
		t.Fatalf("neighbors: %+v", neighbors)
	}
	neighbors[0].To = "mutated"
	if !idx.CanMove("b", "a", nil) {
		t.Fatal("returned slices mutate index")
	}
	if idx.CanMove("a", "c", nil) || idx.CanMove("missing", "missing", nil) {
		t.Fatal("invalid nonneighbor move accepted")
	}
	if !idx.CanMove("b", "b", map[string]bool{"ab": true, "bc": true}) {
		t.Fatal("wait rejected")
	}
	if idx.CanMove("a", "b", map[string]bool{"ab": true}) || len(idx.Neighbors("a", map[string]bool{"ab": true})) != 0 {
		t.Fatal("dynamic block ignored")
	}
}

func TestDirectedReachability(t *testing.T) {
	g := fixture()
	g.Edges[0].Directed = true
	g.Edges[1].Directed = true
	idx, err := New(g)
	if err != nil {
		t.Fatal(err)
	}
	if idx.CanMove("b", "a", nil) || !idx.CanMove("a", "b", nil) {
		t.Fatal("direction ignored")
	}
	g.Shelters[0].NodeID = "a"
	if Validate(g) == nil {
		t.Fatal("unreachable shelter accepted")
	}
}

func TestGraphValidation(t *testing.T) {
	cases := map[string]func(*world.Graph){
		"duplicate-node":    func(g *world.Graph) { g.Nodes = append(g.Nodes, g.Nodes[0]) },
		"duplicate-edge-id": func(g *world.Graph) { g.Edges = append(g.Edges, g.Edges[0]) },
		"duplicate-edge-reversed": func(g *world.Graph) {
			e := g.Edges[0]
			e.ID = "other"
			e.From, e.To = e.To, e.From
			g.Edges = append(g.Edges, e)
		},
		"nonexistent-node":  func(g *world.Graph) { g.Edges[0].To = "missing" },
		"zero-distance":     func(g *world.Graph) { g.Edges[0].DistanceM = 0 },
		"nan-distance":      func(g *world.Graph) { g.Edges[0].DistanceM = math.NaN() },
		"zero-speed":        func(g *world.Graph) { g.Edges[0].SpeedMPS = 0 },
		"invalid-lat":       func(g *world.Graph) { g.Nodes[0].Lat = 91 },
		"nan-lng":           func(g *world.Graph) { g.Nodes[0].Lng = math.NaN() },
		"disconnected":      func(g *world.Graph) { g.Edges = g.Edges[:1] },
		"static-block":      func(g *world.Graph) { g.Edges[0].Blocked = true },
		"missing-shelter":   func(g *world.Graph) { g.Shelters[0].NodeID = "missing" },
		"capacity":          func(g *world.Graph) { g.Shelters[0].Occupancy = 11 },
		"negative-reserved": func(g *world.Graph) { g.Shelters[0].Reserved = -1 },
		"over-reserved":     func(g *world.Graph) { g.Shelters[0].Occupancy = 8; g.Shelters[0].Reserved = 3 },
		"duplicate-shelter": func(g *world.Graph) { g.Shelters = append(g.Shelters, g.Shelters[0]) },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			g := fixture()
			mutate(g)
			if Validate(g) == nil {
				t.Fatal("invalid graph accepted")
			}
		})
	}
}

func TestLoadStrictJSON(t *testing.T) {
	data, err := json.Marshal(fixture())
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "graph.json")
	for _, bad := range []string{string(data) + "{}", string(data[:len(data)-1]) + `,"unexpected":true}`} {
		if err := os.WriteFile(path, []byte(bad), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := Load(path); err == nil {
			t.Fatal("invalid JSON accepted")
		}
	}
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(path); err != nil {
		t.Fatal(err)
	}
}

func TestVersionedMantaAsset(t *testing.T) {
	path := "../../data/manta.json"
	if _, err := os.Stat(path); os.IsNotExist(err) {
		t.Skip("OSM asset unavailable; importer documented")
	}
	g, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(g.Shelters) != 4 {
		t.Fatalf("shelters=%d", len(g.Shelters))
	}
	if len(g.Nodes) < 250 || len(g.Nodes) > 500 {
		t.Fatalf("unexpected Manta junction count: %d", len(g.Nodes))
	}
	if g.Source == "synthetic-test-only" {
		t.Fatal("production asset must be real OSM")
	}
	for _, n := range g.Nodes {
		if n.Lat < -1.1 || n.Lat > -.8 || n.Lng < -80.9 || n.Lng > -80.5 {
			t.Fatalf("outside Manta: %+v", n)
		}
	}
}
