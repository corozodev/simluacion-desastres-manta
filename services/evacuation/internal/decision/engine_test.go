package decision_test

import (
	"context"
	"reflect"
	"sync"
	"testing"

	"corodev/evacuation/internal/decision"
	"corodev/evacuation/internal/graph"
	"corodev/evacuation/internal/world"
)

func road(id, from, to string, distance, speed float64) world.GraphEdge {
	return world.GraphEdge{ID: id, From: from, To: to, DistanceM: distance, SpeedMPS: speed, RoadType: "residential"}
}
func snapshot(ids []string, edges []world.GraphEdge, shelters []world.Shelter) world.WorldSnapshot {
	nodes := make([]world.GraphNode, len(ids))
	for i, id := range ids {
		nodes[i] = world.GraphNode{ID: id, Lat: 0, Lng: float64(i) / 1000}
	}
	g := &world.Graph{Version: "synthetic-test", Source: "synthetic-test-only", Nodes: nodes, Edges: edges, Shelters: shelters}
	return world.WorldSnapshot{Turn: 1, WorldVersion: 1, GraphVersion: g.Version, Graph: g, Shelters: shelters}
}
func survivor(at string) world.Survivor {
	return world.Survivor{ID: "S1", CurrentNode: at, Status: world.Active}
}
func shelter(id, node string) world.Shelter {
	return world.Shelter{ID: id, NodeID: node, Capacity: 200}
}
func diamond() world.WorldSnapshot {
	return snapshot([]string{"A", "B", "C", "R"}, []world.GraphEdge{road("AB", "A", "B", 100, 1), road("BR", "B", "R", 100, 1), road("AC", "A", "C", 200, 1), road("CR", "C", "R", 200, 1)}, []world.Shelter{shelter("REF-1", "R")})
}
func next(t *testing.T, e *decision.DeterministicEngine, w world.WorldSnapshot, at string) world.DecisionResult {
	t.Helper()
	result := e.NextStep(context.Background(), w, survivor(at))
	index, err := graph.New(w.Graph)
	if err != nil {
		t.Fatal(err)
	}
	blocked := map[string]bool{}
	for _, id := range w.BlockedEdges {
		blocked[id] = true
	}
	if !index.CanMove(at, result.NextNode, blocked) {
		t.Fatalf("invalid movement %s -> %s", at, result.NextNode)
	}
	return result
}

func TestShortestLegalRouteAndSingleMovement(t *testing.T) {
	w := diamond()
	e := decision.New()
	result := next(t, e, w, "A")
	if result.NextNode != "B" || result.TargetShelterID != "REF-1" || !reflect.DeepEqual(result.Route, []string{"A", "B", "R"}) {
		t.Fatalf("unexpected route %+v", result)
	}
	if got := next(t, e, w, "R"); got.NextNode != "R" || got.TargetShelterID != "REF-1" {
		t.Fatalf("shelter arrival %+v", got)
	}
}

func TestDistanceSpeedAndMovementCosts(t *testing.T) {
	w := diamond()
	w.Graph.Edges[2].DistanceM = 100
	w.Graph.Edges[3].DistanceM = 100
	w.Graph.Edges[2].SpeedMPS = 4
	w.Graph.Edges[3].SpeedMPS = 4
	if got := next(t, decision.New(), w, "A"); got.NextNode != "C" {
		t.Fatalf("road speed ignored: %+v", got)
	}
	w.Graph.Edges = append(w.Graph.Edges, road("AR", "A", "R", 100, 4))
	if got := next(t, decision.New(), w, "A"); got.NextNode != "R" || len(got.Route) != 2 {
		t.Fatalf("one movement direct route expected: %+v", got)
	}
}

func TestBlockedEdgesInvalidateCachedPlanEvenWithReusedVersion(t *testing.T) {
	w := diamond()
	e := decision.New()
	if got := next(t, e, w, "A"); got.NextNode != "B" {
		t.Fatal(got)
	}
	w.BlockedEdges = []string{"AB"}
	if got := next(t, e, w, "A"); got.NextNode != "C" {
		t.Fatalf("cached compromised route: %+v", got)
	}
	w.BlockedEdges = []string{"AB", "AC"}
	w.WorldVersion++
	if got := next(t, e, w, "A"); got.NextNode != "A" {
		t.Fatalf("must wait without route: %+v", got)
	}
	w.BlockedEdges = nil
	w.Graph.Edges[0].Blocked = true
	if got := next(t, e, w, "A"); got.NextNode != "C" {
		t.Fatalf("static block ignored: %+v", got)
	}
}

func TestVisibleZombiesAndDormantSleeperIsolation(t *testing.T) {
	w := diamond()
	e := decision.New()
	w.Zombies = []world.Zombie{{ID: "Z1", Type: world.Walker, CurrentNode: "B", Awake: true}}
	if got := next(t, e, w, "A"); got.NextNode != "C" {
		t.Fatalf("entered visible zombie: %+v", got)
	}
	w.Zombies[0].Type = world.Sleeper
	w.Zombies[0].Awake = false
	if got := next(t, e, w, "A"); got.NextNode != "B" {
		t.Fatalf("dormant sleeper leaked into policy: %+v", got)
	}
	w.Zombies[0].Awake = true
	if got := next(t, e, w, "A"); got.NextNode != "C" {
		t.Fatalf("awake sleeper ignored: %+v", got)
	}
}

func TestHordeBlocksAllPhysicalNeighborsIncludingIncomingClosedStreet(t *testing.T) {
	w := diamond()
	w.Graph.Nodes = append(w.Graph.Nodes, world.GraphNode{ID: "H"}, world.GraphNode{ID: "Y"})
	hb := road("HB", "H", "B", 100, 1)
	hb.Directed = true
	w.Graph.Edges = append(w.Graph.Edges, hb, road("HY", "H", "Y", 100, 1), road("YR", "Y", "R", 100, 1))
	w.Zombies = []world.Zombie{{ID: "H1", Type: world.Horde, CurrentNode: "H", Awake: true}}
	w.BlockedEdges = []string{"HB"}
	if got := next(t, decision.New(), w, "A"); got.NextNode != "C" {
		t.Fatalf("horde incoming neighbor allowed: %+v", got)
	}
	// A horde at B blocks A and R. A survivor already in the exclusion area
	// cannot route into R, but can escape one hop to the safe node C.
	w = diamond()
	w.Zombies = []world.Zombie{{Type: world.Horde, CurrentNode: "B", Awake: true}}
	if got := next(t, decision.New(), w, "A"); got.NextNode != "C" || got.TargetShelterID != "" {
		t.Fatalf("horde shelter exclusion ignored: %+v", got)
	}
}

func TestEndangeredSurvivorEscapesWithoutAvailableShelter(t *testing.T) {
	w := diamond()
	w.Shelters[0].Occupancy = w.Shelters[0].Capacity
	w.Zombies = []world.Zombie{{ID: "walker", Type: world.Walker, CurrentNode: "A", Awake: true}}
	e := decision.New()
	got := next(t, e, w, "A")
	if got.NextNode != "B" || got.TargetShelterID != "" || !reflect.DeepEqual(got.Route, []string{"A", "B"}) {
		t.Fatalf("expected one-hop emergency escape without shelter target: %+v", got)
	}
	// A safe survivor still waits when all shelters are full, rather than
	// following another endangered node's emergency escape as a route.
	if safe := next(t, e, w, "C"); safe.NextNode != "C" || safe.TargetShelterID != "" {
		t.Fatalf("safe survivor wandered without a shelter: %+v", safe)
	}
}

func TestEmergencyEscapeRespectsBlocksCrossingsAndHordes(t *testing.T) {
	for _, tt := range []struct {
		name    string
		blocked []string
		path    []string
		horde   string
		want    string
	}{
		{name: "dynamic block", blocked: []string{"AB"}, want: "C"},
		{name: "opposite crossing", path: []string{"B", "A"}, want: "C"},
		{name: "no safe exit", blocked: []string{"AB", "AC"}, want: "A"},
		{name: "horde neighbor", horde: "B", want: "C"},
		{name: "horde excludes every exit", horde: "A", want: "A"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			w := diamond()
			w.Shelters[0].Occupancy = w.Shelters[0].Capacity
			w.BlockedEdges = tt.blocked
			w.Zombies = []world.Zombie{{ID: "walker", Type: world.Walker, CurrentNode: "A", Awake: true, Path: tt.path}}
			if tt.horde != "" {
				w.Zombies = append(w.Zombies, world.Zombie{ID: "horde", Type: world.Horde, CurrentNode: tt.horde, Awake: true})
			}
			got := next(t, decision.New(), w, "A")
			if got.NextNode != tt.want || got.TargetShelterID != "" {
				t.Fatalf("unsafe emergency movement: %+v", got)
			}
		})
	}
}

func TestEmergencyEscapeChoosesLowerRiskBeforeDistance(t *testing.T) {
	w := diamond()
	w.Shelters[0].Occupancy = w.Shelters[0].Capacity
	w.Graph.Nodes = append(w.Graph.Nodes, world.GraphNode{ID: "Z"})
	w.Graph.Edges = append(w.Graph.Edges, road("ZB", "Z", "B", 50, 1))
	w.Zombies = []world.Zombie{{ID: "occupying", Type: world.Walker, CurrentNode: "A", Awake: true}, {ID: "nearby", Type: world.Runner, CurrentNode: "Z", Awake: true}}
	if got := next(t, decision.New(), w, "A"); got.NextNode != "C" || got.TargetShelterID != "" {
		t.Fatalf("emergency distance saving overrode safety: %+v", got)
	}
}

func TestRunnerIntermediateOppositeCrossingForbidden(t *testing.T) {
	w := diamond()
	// Runner moved R -> B -> A. Its final node A can be escaped, but
	// A -> B crosses its second segment in the opposite direction.
	w.Zombies = []world.Zombie{{ID: "runner", Type: world.Runner, CurrentNode: "A", Awake: true, Path: []string{"R", "B", "A"}}}
	if got := next(t, decision.New(), w, "A"); got.NextNode != "C" {
		t.Fatalf("opposite crossing allowed: %+v", got)
	}
	// The first segment also matters although neither endpoint is the
	// runner's final node. From B -> R would cross R -> B in reverse.
	w.Graph.Shelters = append(w.Graph.Shelters, shelter("REF-2", "C"))
	w.Shelters = w.Graph.Shelters
	got := next(t, decision.New(), w, "B")
	if got.NextNode == "R" {
		t.Fatalf("runner intermediate segment ignored: %+v", got)
	}
}

func TestSaferRoutePreferredOverSmallDistanceSaving(t *testing.T) {
	w := diamond()
	w.Graph.Nodes = append(w.Graph.Nodes, world.GraphNode{ID: "Z"})
	w.Graph.Edges = append(w.Graph.Edges, road("ZB", "Z", "B", 50, 1))
	w.Zombies = []world.Zombie{{ID: "walker", Type: world.Walker, CurrentNode: "Z", Awake: true}}
	if got := next(t, decision.New(), w, "A"); got.NextNode != "C" {
		t.Fatalf("risk must precede marginal distance: %+v", got)
	}
}

func TestFullSheltersAreNotTargetsAndOccupancyInvalidatesCache(t *testing.T) {
	w := diamond()
	w.Graph.Shelters = append(w.Graph.Shelters, shelter("REF-2", "C"))
	w.Shelters = append([]world.Shelter{}, w.Graph.Shelters...)
	e := decision.New()
	got := next(t, e, w, "A")
	if got.TargetShelterID != "REF-2" || got.NextNode != "C" {
		t.Fatal(got)
	}
	w.Shelters[1].Occupancy = w.Shelters[1].Capacity
	got = next(t, e, w, "A")
	if got.TargetShelterID != "REF-1" || got.NextNode != "B" {
		t.Fatalf("full target cached: %+v", got)
	}
	w.Shelters[0].Occupancy = w.Shelters[0].Capacity
	got = next(t, e, w, "A")
	if got.NextNode != "A" {
		t.Fatal(got)
	}
}

func TestDirectedEdgesAndDeterministicTieBreaking(t *testing.T) {
	w := diamond()
	w.Graph.Edges[2].DistanceM = 100
	w.Graph.Edges[3].DistanceM = 100
	for i := 0; i < 30; i++ {
		if got := next(t, decision.New(), w, "A"); got.NextNode != "B" {
			t.Fatalf("unstable tie: %+v", got)
		}
	}
	for i := range w.Graph.Edges {
		w.Graph.Edges[i].Directed = true
	}
	if got := next(t, decision.New(), w, "B"); got.NextNode != "R" {
		t.Fatal(got)
	}
	// An engine that ignores direction would escape R toward A, but A is
	// not reachable against these arrows. No shelter route must be returned.
	w.Shelters = []world.Shelter{shelter("REF-3", "A")}
	got := decision.New().NextStep(context.Background(), w, survivor("R"))
	if got.NextNode != "R" {
		t.Fatalf("one-way edge violated: %+v", got)
	}
}

func TestCanceledAndInactiveRequestsWait(t *testing.T) {
	w := diamond()
	e := decision.New()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if got := e.NextStep(ctx, w, survivor("A")); got.NextNode != "A" {
		t.Fatal(got)
	}
	s := survivor("A")
	s.Status = world.Evacuated
	if got := e.NextStep(context.Background(), w, s); got.NextNode != "A" {
		t.Fatal(got)
	}
	w.Graph = nil
	if got := e.NextStep(context.Background(), w, survivor("A")); got.NextNode != "A" {
		t.Fatal(got)
	}
}

func TestConcurrentSnapshotRoutingDoesNotMutateInputs(t *testing.T) {
	w := diamond().Clone()
	before := w.Clone()
	e := decision.New()
	var wg sync.WaitGroup
	for i := 0; i < 200; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			result := e.NextStep(context.Background(), w, survivor("A"))
			if result.NextNode != "B" {
				t.Error(result)
			}
			result.Route[0] = "mutated-result"
		}()
	}
	wg.Wait()
	if !reflect.DeepEqual(w, before) {
		t.Fatal("engine mutated world input")
	}
	if got := next(t, e, w, "A"); got.Route[0] != "A" {
		t.Fatal("shared result cache mutated")
	}
}
