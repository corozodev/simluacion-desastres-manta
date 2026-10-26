package decision_test

import (
	"context"
	"reflect"
	"sync"
	"testing"

	"corodev/evacuation/internal/decision"
	"corodev/evacuation/internal/evaluation/phase1"
	"corodev/evacuation/internal/world"
)

// B and C have equal current runner proximity, but B is the expected next chase
// endpoint while C is merely in the low-weight alternative reachable envelope.
func forecastWorld() world.WorldSnapshot {
	w := diamond()
	w.Graph.Nodes = append(w.Graph.Nodes, world.GraphNode{ID: "X"}, world.GraphNode{ID: "Y"}, world.GraphNode{ID: "V"})
	w.Graph.Edges = append(w.Graph.Edges, road("XY", "X", "Y", 100, 1), road("YB", "Y", "B", 100, 1), road("XV", "X", "V", 100, 1), road("VC", "V", "C", 100, 1))
	w.Zombies = []world.Zombie{{ID: "runner", Type: world.Runner, CurrentNode: "X", Awake: true, Path: []string{"X"}}}
	w.Survivors = []world.Survivor{{ID: "S0", CurrentNode: "B", Status: world.Active}, {ID: "S1", CurrentNode: "A", Status: world.Active}}
	return w
}

func TestPredictionAvoidsTheOriginalEnginesLikelyChaseEndpoint(t *testing.T) {
	w := forecastWorld()
	s := survivor("A")
	old := phase1.New().NextStep(context.Background(), w, s)
	off := decision.NewWithOptions(decision.Options{Prediction: false}).NextStep(context.Background(), w, s)
	on := decision.NewWithOptions(decision.Options{Prediction: true}).NextStep(context.Background(), w, s)
	if old.NextNode != "B" || off.NextNode != "B" || on.NextNode != "C" {
		t.Fatalf("prediction ablation: old=%+v off=%+v on=%+v", old, off, on)
	}
	forecast := decision.NewRunnerPredictor(2).Predict(context.Background(), w)
	if forecast.OneTurnNodes["B"] <= forecast.OneTurnNodes["C"] {
		t.Fatal("target endpoint is not distinguished from mere reachability")
	}
	if len(forecast.TargetPaths) == 0 || forecast.TargetPaths[0].TargetID != "S0" || !reflect.DeepEqual(forecast.TargetPaths[0].Nodes, []string{"X", "Y", "B"}) {
		t.Fatal(forecast.TargetPaths)
	}
}

func TestFutureRunnerRiskDoesNotDiscourageImmediateSafeRefugeAdmission(t *testing.T) {
	w := forecastWorld()
	w.Shelters = append(w.Shelters, shelter("REF-NOW", "B"))
	w.Graph.Shelters = w.Shelters
	forecast := decision.NewRunnerPredictor(2).Predict(context.Background(), w)
	if forecast.OneTurnNodes["B"] <= forecast.OneTurnNodes["C"] {
		t.Fatal("fixture must forecast a runner at B next turn")
	}
	got := next(t, decision.New(), w, "A")
	if got.NextNode != "B" || got.TargetShelterID != "REF-NOW" {
		t.Fatal("forecast deterred safe evacuation completed before the future threat", got)
	}
}

func TestPredictionReactsToObservableTargetChangesAndClosures(t *testing.T) {
	w := forecastWorld()
	e := decision.New()
	if got := next(t, e, w, "A"); got.NextNode != "C" {
		t.Fatal(got)
	}
	// Version intentionally reused: actual target position must invalidate cache.
	w.Survivors[0].CurrentNode = "C"
	if got := next(t, e, w, "A"); got.NextNode != "B" {
		t.Fatal("target movement did not alter forecast", got)
	}
	before := e.Stats().Builds
	w.BlockedEdges = []string{"XY"}
	forecast := decision.NewRunnerPredictor(1).Predict(context.Background(), w)
	for _, path := range forecast.TargetPaths {
		for i := 1; i < len(path.Nodes); i++ {
			if path.Nodes[i-1] == "X" && path.Nodes[i] == "Y" {
				t.Fatal("predicted runner crossed a closure")
			}
		}
	}
	next(t, e, w, "A")
	if e.Stats().Builds <= before {
		t.Fatal("street closure did not rebuild routing inputs")
	}
}

func TestPredictorIsObservableBoundedAndCancellationAware(t *testing.T) {
	w := forecastWorld()
	a := decision.NewRunnerPredictor(2).Predict(context.Background(), w)
	hidden := world.Zombie{ID: "hidden", Type: world.Sleeper, CurrentNode: "C", Awake: false, Path: []string{"C"}}
	w.Zombies = append(w.Zombies, hidden)
	b := decision.NewRunnerPredictor(2).Predict(context.Background(), w)
	if !reflect.DeepEqual(a, b) {
		t.Fatal("dormant sleeper leaked into prediction")
	}
	if a.TwoTurnNodes["R"] == 0 || len(a.OneTurnNodes) == 0 {
		t.Fatal("one/two-turn reachable envelopes missing")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if got := decision.NewRunnerPredictor(2).Predict(ctx, w); len(got.OneTurnNodes) != 0 {
		t.Fatal("canceled forecast performed work")
	}
}

func TestCandidatesRespectOccupancyAndIgnorePreviousReservations(t *testing.T) {
	w := diamond()
	w.Shelters = append(w.Shelters, shelter("REF-2", "C"))
	w.Graph.Shelters = w.Shelters
	e := decision.New()
	s := survivor("A")
	candidates := e.Candidates(context.Background(), w, s)
	if len(candidates) != 2 {
		t.Fatalf("expected one route per open refuge: %+v", candidates)
	}
	w.Shelters[0].Reserved = w.Shelters[0].Capacity
	w.Shelters[0].Available = 0
	if got := e.Candidates(context.Background(), w, s); len(got) != 2 {
		t.Fatal("old reservations incorrectly removed global allocation candidates", got)
	}
	w.Shelters[0].Occupancy = w.Shelters[0].Capacity
	if got := e.Candidates(context.Background(), w, s); len(got) != 1 || got[0].TargetShelterID != "REF-2" {
		t.Fatal("actually full refuge remained a candidate", got)
	}
}

func TestPublishedAssignmentIsReadOnlyAndHardSafetyWins(t *testing.T) {
	w := diamond().Clone()
	s := survivor("A")
	s.TargetShelterID = "REF-1"
	s.PlannedRoute = []string{"A", "C", "R"}
	e := decision.New()
	got := e.NextStep(context.Background(), w, s)
	if got.NextNode != "C" {
		t.Fatal("HTTP diverged from coherent published route", got)
	}
	got.Route[1] = "changed"
	if s.PlannedRoute[1] != "C" {
		t.Fatal("route escaped mutable references")
	}
	w.BlockedEdges = []string{"AC"}
	if got := e.NextStep(context.Background(), w, s); got.NextNode != "B" {
		t.Fatal("compromised published route was reused", got)
	}
	w.BlockedEdges = nil
	s.TargetShelterID = ""
	s.PlannedRoute = []string{"A", "C"}
	if got := e.NextStep(context.Background(), w, s); got.NextNode != "C" || got.TargetShelterID != "" {
		t.Fatal("coherent one-hop emergency was not honored", got)
	}
	s.PlannedRoute = []string{"A"}
	if got := e.NextStep(context.Background(), w, s); got.NextNode != "A" || got.TargetShelterID != "" {
		t.Fatal("published capacity-limited wait diverged in HTTP", got)
	}
}

func TestRouteHysteresisAndStaticProgressDoNotOscillate(t *testing.T) {
	w := diamond()
	for i := range w.Graph.Edges {
		if w.Graph.Edges[i].From == "A" && w.Graph.Edges[i].To == "C" || w.Graph.Edges[i].From == "C" && w.Graph.Edges[i].To == "R" {
			w.Graph.Edges[i].DistanceM = 102
		}
	}
	s := survivor("A")
	s.TargetShelterID = "REF-1"
	s.PlannedRoute = []string{"A", "C", "R"}
	e := decision.New()
	if got := e.Candidates(context.Background(), w, s); len(got) != 1 || got[0].NextNode != "C" {
		t.Fatal("small cost change caused unnecessary route oscillation", got)
	}
	for i := range w.Graph.Edges {
		if w.Graph.Edges[i].To == "C" || w.Graph.Edges[i].From == "C" {
			w.Graph.Edges[i].DistanceM = 1000
		}
	}
	if got := e.Candidates(context.Background(), w, s); len(got) != 1 || got[0].NextNode != "B" {
		t.Fatal("hysteresis prevented a material improvement", got)
	}
	s = survivor("A")
	first := e.NextStep(context.Background(), w, s)
	s.CurrentNode = first.NextNode
	second := e.NextStep(context.Background(), w, s)
	if second.NextNode != "R" {
		t.Fatal("static route reversed rather than reaching the refuge", first, second)
	}
}

func TestSharedPlanCacheIsBoundedAndConcurrentCandidatesOwnTheirRoutes(t *testing.T) {
	w := diamond().Clone()
	w.Shelters = append(w.Shelters, shelter("REF-2", "C"))
	w.Graph.Shelters = w.Shelters
	w = w.Clone()
	e := decision.New()
	before := w.Clone()
	var wg sync.WaitGroup
	for i := 0; i < 200; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r := e.Candidates(context.Background(), w, survivor("A"))
			if len(r) != 2 {
				t.Error(r)
				return
			}
			r[0].Route[0] = "changed"
		}()
	}
	wg.Wait()
	if !reflect.DeepEqual(w, before) {
		t.Fatal("concurrent candidates mutated snapshot")
	}
	stats := e.Stats()
	if stats.Builds != 1 || stats.Searches != 2 || stats.CacheHits < 199 {
		t.Fatalf("shared snapshot did not share searches: %+v", stats)
	}
	if got := e.Candidates(context.Background(), w, survivor("A")); got[0].Route[0] != "A" {
		t.Fatal("caller corrupted cached paths")
	}
}

func TestPublicationVersionsDoNotInvalidateUnchangedRoutingContent(t *testing.T) {
	w := diamond()
	e := decision.New()
	next(t, e, w, "A")
	before := e.Stats()
	w.WorldVersion += 100
	w.Turn += 50
	next(t, e, w, "A")
	if after := e.Stats(); after.Builds != before.Builds || after.Searches != before.Searches || after.CacheHits <= before.CacheHits {
		t.Fatalf("metadata-only publication rebuilt searches: before=%+v after=%+v", before, after)
	}
	// No runners means moving survivor targets cannot change any forecast.
	w.Survivors = []world.Survivor{survivor("C")}
	next(t, e, w, "A")
	if e.Stats().Builds != before.Builds {
		t.Fatal("irrelevant survivor position rebuilt plans without runners")
	}
}

func TestTargetOnlyChangesRefreshForecastWithoutRepeatingSearches(t *testing.T) {
	w := forecastWorld()
	e := decision.New()
	next(t, e, w, "A")
	before := e.Stats()
	w.Survivors[0].CurrentNode = "C"
	next(t, e, w, "A")
	after := e.Stats()
	if after.Builds <= before.Builds || after.Predictions <= before.Predictions || after.Searches != before.Searches || after.ReusedSearches <= before.ReusedSearches {
		t.Fatalf("target-only invalidation failed selective reuse: before=%+v after=%+v", before, after)
	}
}
