package coordination_test

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"reflect"
	"sort"
	"sync"
	"testing"

	"corodev/evacuation/internal/coordination"
	"corodev/evacuation/internal/decision"
	"corodev/evacuation/internal/world"
)

type providerFunc func(context.Context, world.WorldSnapshot, world.Survivor) []world.DecisionResult

func (f providerFunc) Candidates(ctx context.Context, w world.WorldSnapshot, s world.Survivor) []world.DecisionResult {
	return f(ctx, w, s)
}

func star(count, capacity int) world.WorldSnapshot {
	g := &world.Graph{Version: "synthetic-test", Source: "synthetic-test-only", Nodes: []world.GraphNode{{ID: "A"}}}
	for i := 1; i <= 4; i++ {
		id := fmt.Sprintf("R%d", i)
		g.Nodes = append(g.Nodes, world.GraphNode{ID: id, Lng: float64(i) / 1000})
		g.Edges = append(g.Edges, world.GraphEdge{ID: "A" + id, From: "A", To: id, DistanceM: 100, RoadType: "residential", SpeedMPS: 1.4})
		g.Shelters = append(g.Shelters, world.Shelter{ID: id, NodeID: id, Capacity: capacity, Available: capacity})
	}
	w := world.WorldSnapshot{Turn: 1, WorldVersion: 1, GraphVersion: g.Version, Graph: g, Shelters: append([]world.Shelter{}, g.Shelters...)}
	for i := 0; i < count; i++ {
		w.Survivors = append(w.Survivors, world.Survivor{ID: fmt.Sprintf("S%03d", i), CurrentNode: "A", Status: world.Active, PlannedRoute: []string{}})
	}
	return w
}

func choices(_ context.Context, w world.WorldSnapshot, v world.Survivor) []world.DecisionResult {
	result := []world.DecisionResult{}
	for _, sh := range w.Shelters {
		result = append(result, world.DecisionResult{NextNode: sh.NodeID, TargetShelterID: sh.ID, Route: []string{v.CurrentNode, sh.NodeID}, Cost: 1})
	}
	return result
}

func assignment(w world.WorldSnapshot) map[string]string {
	result := map[string]string{}
	for _, v := range w.Survivors {
		result[v.ID] = v.TargetShelterID
	}
	return result
}

func assertCapacity(t *testing.T, w world.WorldSnapshot) {
	t.Helper()
	reservations := map[string]int{}
	for _, v := range w.Survivors {
		if v.Status == world.Active && v.TargetShelterID != "" {
			reservations[v.TargetShelterID]++
		}
	}
	for _, sh := range w.Shelters {
		if sh.Occupancy+sh.Reserved > sh.Capacity || sh.Reserved != reservations[sh.ID] || sh.Available != sh.Capacity-sh.Occupancy-sh.Reserved || sh.Available < 0 {
			t.Fatalf("inconsistent shelter: %+v actual reservations %d", sh, reservations[sh.ID])
		}
	}
}

func Test200SurvivorsBalancedWithoutOverassignmentOrMutation(t *testing.T) {
	w := star(200, 60)
	before, _ := json.Marshal(w)
	p := coordination.New(providerFunc(choices), coordination.Options{})
	got := p.Prepare(context.Background(), w)
	assertCapacity(t, got)
	for _, sh := range got.Shelters {
		if sh.Reserved != 50 || sh.Available != 10 {
			t.Fatalf("equal alternatives not balanced: %+v", sh)
		}
	}
	if stats := p.Stats(); stats.Assigned != 200 || stats.Unassigned != 0 {
		t.Fatal(stats)
	}
	after, _ := json.Marshal(w)
	if string(before) != string(after) {
		t.Fatal("planner mutated input")
	}
	got.Survivors[0].PlannedRoute[1] = "changed"
	if w.Survivors[0].TargetShelterID != "" || len(w.Survivors[0].PlannedRoute) != 0 {
		t.Fatal("returned route aliases caller")
	}
}

func TestMostConstrainedGetsSeatBeforeFlexibleSurvivor(t *testing.T) {
	w := star(2, 1)
	w.Shelters = w.Shelters[:2]
	w.Survivors[0].ID = "A-flexible"
	w.Survivors[1].ID = "Z-constrained"
	provider := providerFunc(func(ctx context.Context, w world.WorldSnapshot, v world.Survivor) []world.DecisionResult {
		all := choices(ctx, w, v)
		if v.ID == "Z-constrained" {
			return all[:1]
		}
		return all
	})
	got := coordination.New(provider, coordination.Options{}).Prepare(context.Background(), w)
	assertCapacity(t, got)
	targets := assignment(got)
	if targets["Z-constrained"] != "R1" || targets["A-flexible"] != "R2" {
		t.Fatal(targets)
	}
}

func TestReservationsReleaseOnDeathAndBecomeOccupancyOnArrival(t *testing.T) {
	w := star(4, 2)
	p := coordination.New(providerFunc(choices), coordination.Options{})
	first := p.Prepare(context.Background(), w)
	deadTarget := first.Survivors[0].TargetShelterID
	arrivedTarget := first.Survivors[1].TargetShelterID
	first.Survivors[0].Status = world.Bitten
	first.Survivors[1].Status = world.Evacuated
	for i := range first.Shelters {
		if first.Shelters[i].ID == arrivedTarget {
			first.Shelters[i].Occupancy++
		}
	}
	got := p.Prepare(context.Background(), first)
	assertCapacity(t, got)
	if got.Survivors[0].TargetShelterID != "" {
		t.Fatal("dead reservation retained")
	}
	if got.Survivors[1].TargetShelterID != arrivedTarget {
		t.Fatal("arrival lost known destination")
	}
	for _, sh := range got.Shelters {
		if sh.ID == deadTarget && sh.Reserved != 0 {
			t.Fatal("death did not release seat")
		}
		if sh.ID == arrivedTarget && sh.Occupancy != 1 {
			t.Fatal("arrival occupancy overwritten")
		}
	}
}

func TestFullOrBlockedDestinationReassignsToAlternative(t *testing.T) {
	for _, block := range []bool{false, true} {
		t.Run(fmt.Sprint(block), func(t *testing.T) {
			w := star(1, 1)
			w.Survivors[0].TargetShelterID = "R1"
			if block {
				w.BlockedEdges = []string{"AR1"}
			} else {
				w.Shelters[0].Occupancy = 1
			}
			got := coordination.New(providerFunc(choices), coordination.Options{}).Prepare(context.Background(), w)
			assertCapacity(t, got)
			if got.Survivors[0].TargetShelterID != "R2" {
				t.Fatal(got.Survivors[0])
			}
		})
	}
}

func TestHysteresisKeepsSmallCostChangesButReactsToRisk(t *testing.T) {
	w := star(1, 2)
	w.Survivors[0].TargetShelterID = "R2"
	risk := 0.0
	provider := providerFunc(func(ctx context.Context, w world.WorldSnapshot, v world.Survivor) []world.DecisionResult {
		all := choices(ctx, w, v)[:2]
		all[0].Cost = 10
		all[1].Cost = 11
		all[1].EstimatedRisk = risk
		return all
	})
	p := coordination.New(provider, coordination.Options{Stickiness: .15})
	got := p.Prepare(context.Background(), w)
	if got.Survivors[0].TargetShelterID != "R2" || p.Stats().Retained != 1 {
		t.Fatal("small cost change invalidated reservation")
	}
	risk = 1
	got = p.Prepare(context.Background(), w)
	if got.Survivors[0].TargetShelterID != "R1" || p.Stats().Reassigned != 1 {
		t.Fatal("hysteresis hid greater estimated risk")
	}
}

func TestRejectsUnsafeInvalidAndNonFiniteRoutes(t *testing.T) {
	for _, kind := range []string{"missing-edge", "opposite", "occupied", "horde-neighbor", "negative-risk", "nan-cost", "wrong-next", "cycle"} {
		t.Run(kind, func(t *testing.T) {
			w := star(1, 2)
			c := choices(context.Background(), w, w.Survivors[0])[0]
			switch kind {
			case "missing-edge":
				c.Route = []string{"A", "missing", "R1"}
			case "opposite":
				w.Zombies = []world.Zombie{{Type: world.Runner, CurrentNode: "A", Awake: true, Path: []string{"R1", "A"}}}
			case "occupied":
				w.Zombies = []world.Zombie{{Type: world.Walker, CurrentNode: "R1", Awake: true}}
			case "horde-neighbor":
				w.Graph.Nodes = append(w.Graph.Nodes, world.GraphNode{ID: "H"})
				w.Graph.Edges = append(w.Graph.Edges, world.GraphEdge{ID: "HR1", From: "H", To: "R1", Directed: true, Blocked: true})
				w.Zombies = []world.Zombie{{Type: world.Horde, CurrentNode: "H", Awake: true}}
			case "negative-risk":
				c.EstimatedRisk = -1
			case "nan-cost":
				c.Cost = math.NaN()
			case "wrong-next":
				c.NextNode = "R2"
			case "cycle":
				c.Route = []string{"A", "R2", "A", "R1"}
			}
			p := coordination.New(providerFunc(func(context.Context, world.WorldSnapshot, world.Survivor) []world.DecisionResult {
				return []world.DecisionResult{c}
			}), coordination.Options{})
			got := p.Prepare(context.Background(), w)
			assertCapacity(t, got)
			if got.Survivors[0].TargetShelterID != "" || p.Stats().RejectedCandidates != 1 {
				t.Fatalf("unsafe candidate accepted: %+v %+v", got.Survivors[0], p.Stats())
			}
		})
	}
}

func TestNoRouteAndCapacityLimitedAreDistinct(t *testing.T) {
	w := star(3, 1)
	w.Shelters = w.Shelters[:1]
	provider := providerFunc(func(ctx context.Context, w world.WorldSnapshot, v world.Survivor) []world.DecisionResult {
		if v.ID == "S002" {
			return nil
		}
		return choices(ctx, w, v)
	})
	p := coordination.New(provider, coordination.Options{})
	got := p.Prepare(context.Background(), w)
	assertCapacity(t, got)
	stats := p.Stats()
	if stats.Assigned != 1 || stats.Unassigned != 2 || stats.NoRoute != 1 || stats.CapacityLimited != 1 {
		t.Fatal(stats)
	}
}

func TestPermutationAndConcurrentPrepareStayDeterministic(t *testing.T) {
	w := star(200, 60)
	p := coordination.New(providerFunc(choices), coordination.Options{})
	expected := assignment(p.Prepare(context.Background(), w))
	reverse := w.Clone()
	sort.Slice(reverse.Survivors, func(i, j int) bool { return reverse.Survivors[i].ID > reverse.Survivors[j].ID })
	sort.Slice(reverse.Shelters, func(i, j int) bool { return reverse.Shelters[i].ID > reverse.Shelters[j].ID })
	if !reflect.DeepEqual(expected, assignment(p.Prepare(context.Background(), reverse))) {
		t.Fatal("input order altered assignment")
	}
	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			result := p.Prepare(context.Background(), w)
			if !reflect.DeepEqual(expected, assignment(result)) {
				t.Error("concurrent plan changed allocation")
			}
			assertCapacity(t, result)
			_ = p.Stats()
		}()
	}
	wg.Wait()
}

func TestCanceledPlanClearsStaleReservationsWithoutMutatingInput(t *testing.T) {
	w := star(2, 1)
	w.Survivors[0].TargetShelterID = "R1"
	w.Shelters[0].Reserved = 1
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	p := coordination.New(providerFunc(choices), coordination.Options{})
	got := p.Prepare(ctx, w)
	assertCapacity(t, got)
	if !p.Stats().Canceled || got.Survivors[0].TargetShelterID != "" || w.Survivors[0].TargetShelterID != "R1" {
		t.Fatal("cancellation returned stale allocation or mutated input")
	}
}

type emergencyProvider struct{ providerFunc }

func (emergencyProvider) Escape(_ context.Context, _ world.WorldSnapshot, s world.Survivor) world.DecisionResult {
	return world.DecisionResult{NextNode: "R2", Route: []string{s.CurrentNode, "R2"}}
}

func TestEndangeredUnassignedSurvivorCanEscapeWithoutReserving(t *testing.T) {
	w := star(1, 1)
	for i := range w.Shelters {
		w.Shelters[i].Occupancy = 1
	}
	w.Zombies = []world.Zombie{{Type: world.Walker, CurrentNode: "A", Awake: true}}
	p := coordination.New(emergencyProvider{providerFunc(choices)}, coordination.Options{})
	got := p.Prepare(context.Background(), w)
	assertCapacity(t, got)
	if got.Survivors[0].TargetShelterID != "" || !reflect.DeepEqual(got.Survivors[0].PlannedRoute, []string{"A", "R2"}) {
		t.Fatal(got.Survivors[0])
	}
	for _, sh := range got.Shelters {
		if sh.Reserved != 0 {
			t.Fatal("escape reserved a full shelter")
		}
	}
}

func TestActualEngineReadsTheCoherentCapacityPlan(t *testing.T) {
	w := star(200, 60)
	engine := decision.New()
	planned := coordination.New(engine, coordination.Options{}).Prepare(context.Background(), w)
	assertCapacity(t, planned)
	var wg sync.WaitGroup
	for _, v := range planned.Survivors {
		wg.Add(1)
		go func(v world.Survivor) {
			defer wg.Done()
			step := engine.NextStep(context.Background(), planned, v)
			if step.TargetShelterID != v.TargetShelterID || len(v.PlannedRoute) < 2 || step.NextNode != v.PlannedRoute[1] {
				t.Errorf("read diverged from coherent plan for %s: %+v", v.ID, step)
			}
		}(v)
	}
	wg.Wait()
}

func TestUnassignedSafeNodeEscapesForecastRunnerDanger(t *testing.T) {
	w := star(1, 1)
	for i := range w.Shelters {
		w.Shelters[i].Occupancy = 1
	}
	// A is not occupied or horde-excluded. The visible runner can reach it in
	// two edges next turn; R2/R3/R4 are outside that one-turn envelope.
	w.Graph.Nodes = append(w.Graph.Nodes, world.GraphNode{ID: "Z", Lng: .005})
	w.Graph.Edges = append(w.Graph.Edges, world.GraphEdge{ID: "ZR1", From: "Z", To: "R1", DistanceM: 100, RoadType: "residential", SpeedMPS: 1.4})
	w.Zombies = []world.Zombie{{ID: "runner", Type: world.Runner, CurrentNode: "Z", Awake: true, Path: []string{"Z"}}}
	engine := decision.New()
	if predicted := engine.Escape(context.Background(), w, w.Survivors[0]); predicted.NextNode == "A" {
		t.Fatal("fixture lacks a justified forecast escape")
	}
	planned := coordination.New(engine, coordination.Options{}).Prepare(context.Background(), w)
	assertCapacity(t, planned)
	v := planned.Survivors[0]
	if v.TargetShelterID != "" || len(v.PlannedRoute) != 2 || v.PlannedRoute[0] != "A" || v.PlannedRoute[1] == "A" {
		t.Fatalf("coordinator suppressed forecast escape: %+v", v)
	}
	read := engine.NextStep(context.Background(), planned, v)
	if read.NextNode != v.PlannedRoute[1] || read.TargetShelterID != "" {
		t.Fatal("HTTP decision diverged from untargeted forecast plan")
	}
	for _, sh := range planned.Shelters {
		if sh.Reserved != 0 {
			t.Fatal("forecast escape created reservation")
		}
	}
}

func TestUnassignedWithoutFutureThreatKeepsPublishedWait(t *testing.T) {
	w := star(1, 1)
	for i := range w.Shelters {
		w.Shelters[i].Occupancy = 1
	}
	engine := decision.New()
	planned := coordination.New(engine, coordination.Options{}).Prepare(context.Background(), w)
	assertCapacity(t, planned)
	v := planned.Survivors[0]
	if v.TargetShelterID != "" || !reflect.DeepEqual(v.PlannedRoute, []string{"A"}) {
		t.Fatalf("safe unassigned survivor wandered: %+v", v)
	}
	if read := engine.NextStep(context.Background(), planned, v); read.NextNode != "A" {
		t.Fatal("coherent wait was not honored")
	}
}
