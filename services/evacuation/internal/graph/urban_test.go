package graph

import (
	"corodev/evacuation/internal/world"
	"testing"
)

func TestUrbanMantaVariants(t *testing.T) {
	for _, tt := range []struct {
		name  string
		nodes int
	}{{"v2", 300}, {"expanded", 1000}, {"master", 0}} {
		t.Run(tt.name, func(t *testing.T) {
			g, err := Load("../../data/manta-" + tt.name + ".json")
			if err != nil {
				t.Fatal(err)
			}
			if tt.nodes > 0 && len(g.Nodes) != tt.nodes {
				t.Fatalf("nodes=%d", len(g.Nodes))
			}
			if len(g.SpawnZones) != 4 || len(g.Shelters) != 4 {
				t.Fatal("zones/shelters lost")
			}
			foundBridge := false
			for _, edge := range g.Edges {
				if len(edge.Geometry) < 2 {
					t.Fatal("real street geometry missing")
				}
				if edge.ID == "E-4420ceab96c993b4" && edge.Bridge {
					foundBridge = true
				}
			}
			if !foundBridge {
				t.Fatal("sourced physical bridge absent")
			}
		})
	}
}

func TestRejectsUnverifiedSpawnGeometryAndRoads(t *testing.T) {
	g := fixture()
	g.Edges[0].RoadType = "invented"
	if Validate(g) == nil {
		t.Fatal("unsupported road type accepted")
	}
	g = fixture()
	g.Edges[0].Geometry = []world.GeoPoint{{Lat: 5, Lng: 5}, {Lat: 6, Lng: 6}}
	if Validate(g) == nil {
		t.Fatal("geometry mismatch accepted")
	}
	g = fixture()
	g.SpawnZones = []world.SpawnZone{{ID: "z", Name: "sourced", Source: "test-only synthetic polygon", Weight: 1, Geometry: []world.GeoPoint{{Lat: -1, Lng: -1}, {Lat: -1, Lng: 1}, {Lat: 1, Lng: 1}, {Lat: 1, Lng: -1}, {Lat: -1, Lng: -1}}, NodeIDs: []string{"a"}}}
	if err := Validate(g); err != nil {
		t.Fatal(err)
	}
	g.SpawnZones[0].NodeIDs = []string{"missing"}
	if Validate(g) == nil {
		t.Fatal("missing candidate accepted")
	}
	g.SpawnZones[0].NodeIDs = []string{"a"}
	g.SpawnZones[0].Geometry[0].Lat = 2
	if Validate(g) == nil {
		t.Fatal("open polygon accepted")
	}
}
