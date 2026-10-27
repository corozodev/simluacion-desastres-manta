package world

import (
	"sync"
	"testing"
)

func TestStoreOwnsAllMutableSnapshotData(t *testing.T) {
	store := NewStore()
	if _, ready := store.Load(); ready {
		t.Fatal("empty store ready")
	}
	input := WorldSnapshot{Graph: &Graph{Nodes: []GraphNode{{ID: "n"}}},
		Zombies:      []Zombie{{ID: "z", Type: Walker, Path: []string{"n"}}},
		Survivors:    []Survivor{{ID: "s", PlannedRoute: []string{"n"}}},
		BlockedEdges: []string{"e"}, Events: []Event{{Type: "initial"}}}
	store.Publish(input)
	input.Graph.Nodes[0].ID = "changed"
	input.Zombies[0].Path[0] = "changed"
	input.Survivors[0].PlannedRoute[0] = "changed"
	first, ready := store.Load()
	if !ready || first.Graph.Nodes[0].ID != "n" || first.Zombies[0].Path[0] != "n" || first.Survivors[0].PlannedRoute[0] != "n" {
		t.Fatal("publisher mutated stored data")
	}
	first.Graph.Nodes[0].ID = "changed"
	first.Zombies[0].Path[0] = "changed"
	first.Survivors[0].PlannedRoute[0] = "changed"
	first.BlockedEdges[0] = "changed"
	first.Events[0].Type = "changed"
	second, _ := store.Load()
	if second.Graph.Nodes[0].ID != "n" || second.Zombies[0].Path[0] != "n" || second.Survivors[0].PlannedRoute[0] != "n" || second.BlockedEdges[0] != "e" || second.Events[0].Type != "initial" {
		t.Fatal("reader mutated stored data")
	}
}

func TestStoreNeverPublishesDormantSleepers(t *testing.T) {
	store := NewStore()
	store.Publish(WorldSnapshot{Zombies: []Zombie{{ID: "hidden", Type: Sleeper}, {ID: "awake", Type: Sleeper, Awake: true}, {ID: "walker", Type: Walker}}})
	snapshot, _ := store.Load()
	if len(snapshot.Zombies) != 2 || snapshot.Zombies[0].ID != "awake" || snapshot.Zombies[1].ID != "walker" {
		t.Fatalf("unexpected observable zombies: %+v", snapshot.Zombies)
	}
}

func TestStoreConcurrentPublishAndLoad(t *testing.T) {
	store := NewStore()
	var wg sync.WaitGroup
	for worker := 0; worker < 8; worker++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for turn := 0; turn < 50; turn++ {
				store.Publish(WorldSnapshot{Turn: turn})
				store.Load()
			}
		}()
	}
	wg.Wait()
}

func TestGeographyAndReservationsRemainImmutable(t *testing.T) {
	g := &Graph{Edges: []GraphEdge{{ID: "e", Geometry: []GeoPoint{{Lat: -.95, Lng: -80.7}}}}, SpawnZones: []SpawnZone{{ID: "tarqui", Geometry: []GeoPoint{{Lat: -.95, Lng: -80.7}}, NodeIDs: []string{"n"}}}, Coverage: []GeoPoint{{Lat: -.9, Lng: -80.8}}}
	input := WorldSnapshot{Graph: g, Shelters: []Shelter{{ID: "R1", Capacity: 60, Occupancy: 10, Reserved: 20, Available: 999}}}
	store := NewStore()
	store.Publish(input)
	g.Edges[0].Geometry[0].Lat = 42
	g.SpawnZones[0].Geometry[0].Lat = 42
	g.SpawnZones[0].NodeIDs[0] = "changed"
	g.Coverage[0].Lat = 42
	got, _ := store.Load()
	if got.Graph.Edges[0].Geometry[0].Lat != -.95 || got.Graph.SpawnZones[0].Geometry[0].Lat != -.95 || got.Graph.SpawnZones[0].NodeIDs[0] != "n" || got.Graph.Coverage[0].Lat != -.9 {
		t.Fatal("geographic slices leaked mutable references")
	}
	if got.Shelters[0].Available != 30 {
		t.Fatal("availability must derive from real occupancy and reservations")
	}
	got.Graph.SpawnZones[0].NodeIDs[0] = "reader"
	again, _ := store.Load()
	if again.Graph.SpawnZones[0].NodeIDs[0] != "n" {
		t.Fatal("reader mutated stored geographic zone")
	}
}

func TestCompactAndDecisionViewsOwnDynamicState(t *testing.T) {
	store := NewStore()
	store.Publish(WorldSnapshot{Graph: &Graph{Version: "v1", Nodes: []GraphNode{{ID: "n"}}}, Survivors: []Survivor{{ID: "s", PlannedRoute: []string{"n"}}}, Shelters: []Shelter{{ID: "r", Capacity: 2}}, Scenario: &ScenarioSnapshot{Agents: []FloodAgent{{ID: "s", PlannedRoute: []string{"n"}}}, RoadConditions: []RoadCondition{{EdgeID: "e", State: "passable"}}}})
	compact, ready := store.LoadCompact()
	if !ready || compact.Graph != nil {
		t.Fatal("compact state contains topology")
	}
	decision, _ := store.LoadForDecision()
	nextDecision, _ := store.LoadForDecision()
	if decision.Graph == nil || decision.Graph != nextDecision.Graph {
		t.Fatal("decision topology should be shared immutable input")
	}
	compact.Survivors[0].PlannedRoute[0] = "tampered"
	compact.Scenario.Agents[0].PlannedRoute[0] = "tampered"
	decision.Shelters[0].Occupancy = 999
	decision.Scenario.RoadConditions[0].State = "blocked"
	decision.Survivors[0].CurrentNode = "tampered"
	own, _ := store.Load()
	if own.Survivors[0].PlannedRoute[0] != "n" || own.Survivors[0].CurrentNode == "tampered" || own.Shelters[0].Occupancy != 0 || own.Scenario.Agents[0].PlannedRoute[0] != "n" || own.Scenario.RoadConditions[0].State != "passable" {
		t.Fatal("observer changed authoritative data")
	}
}
