package decision_test

import (
	"context"
	"math"
	"reflect"
	"sync"
	"testing"

	"corodev/evacuation/internal/decision"
	"corodev/evacuation/internal/world"
)

func algorithms() []string {
	return []string{decision.BaselineShortestPath, decision.DynamicRiskAStar, decision.PredictiveTemporalAStar}
}

func TestPhase7LegacySelectionPreservesBaseline(t *testing.T) {
	w := forecastWorld()
	for _, pred := range []bool{false, true} {
		implicit := decision.NewWithOptions(decision.Options{Prediction: pred})
		explicit := decision.NewWithOptions(decision.Options{Algorithm: decision.LegacyCurrent, Prediction: pred})
		for _, at := range []string{"A", "B", "C", "R"} {
			a, b := implicit.NextStep(context.Background(), w, survivor(at)), explicit.NextStep(context.Background(), w, survivor(at))
			if !reflect.DeepEqual(a, b) {
				t.Fatalf("legacy changed: %+v %+v", a, b)
			}
		}
	}
	if decision.ValidAlgorithm("unknown") || !decision.ValidAlgorithm("") {
		t.Fatal("algorithm validation")
	}
}

func TestPhase7PlannersUseWeightedEdgesAndHardSafety(t *testing.T) {
	for _, algorithm := range algorithms() {
		t.Run(algorithm, func(t *testing.T) {
			w := diamond()
			e := decision.NewWithOptions(decision.Options{Algorithm: algorithm, Prediction: true})
			if got := next(t, e, w, "A"); got.NextNode != "B" {
				t.Fatal(got)
			}
			w.Graph.Edges[0].DistanceM = 10000
			if got := next(t, e, w, "A"); got.NextNode != "C" {
				t.Fatal("weighted cost cache", got)
			}
			w.BlockedEdges = []string{"AC"}
			if got := next(t, e, w, "A"); got.NextNode != "B" {
				t.Fatal("dynamic closure", got)
			}
			w.BlockedEdges = nil
			w.Zombies = []world.Zombie{{ID: "h", Type: world.Horde, CurrentNode: "B", Awake: true}}
			if got := next(t, e, w, "A"); got.NextNode != "C" || got.TargetShelterID != "" {
				t.Fatal("horde must prevent target R", got)
			}
			w.Zombies = []world.Zombie{{ID: "r", Type: world.Runner, CurrentNode: "A", Awake: true, Path: []string{"R", "C", "A"}}}
			if got := next(t, e, w, "A"); got.NextNode != "B" {
				t.Fatal("opposite crossing", got)
			}
			w.BlockedEdges = []string{"AB", "AC"}
			if got := next(t, e, w, "A"); got.NextNode != "A" {
				t.Fatal("no legal exit must wait", got)
			}
		})
	}
}

func TestPhase7BaselineAblationSeparatesRiskFromGeography(t *testing.T) {
	w := diamond()
	w.Graph.Nodes = append(w.Graph.Nodes, world.GraphNode{ID: "Z"})
	w.Graph.Edges = append(w.Graph.Edges, road("ZB", "Z", "B", 50, 1))
	w.Zombies = []world.Zombie{{ID: "walker", Type: world.Walker, CurrentNode: "Z", Awake: true}}
	baseline := decision.NewWithOptions(decision.Options{Algorithm: decision.BaselineShortestPath})
	dynamic := decision.NewWithOptions(decision.Options{Algorithm: decision.DynamicRiskAStar})
	if a, b := next(t, baseline, w, "A"), next(t, dynamic, w, "A"); a.NextNode != "B" || b.NextNode != "C" {
		t.Fatalf("algorithm ablation: %+v %+v", a, b)
	}
	w.Zombies[0] = world.Zombie{ID: "hidden", Type: world.Sleeper, CurrentNode: "C", Awake: false}
	if got := next(t, dynamic, w, "A"); got.NextNode != "B" {
		t.Fatal("hidden sleeper influenced search", got)
	}
}

func TestPhase7TemporalSearchUsesObservableForecastAndCanWait(t *testing.T) {
	w := forecastWorld()
	e := decision.NewWithOptions(decision.Options{Algorithm: decision.PredictiveTemporalAStar, Prediction: true})
	on := next(t, e, w, "A")
	off := next(t, decision.NewWithOptions(decision.Options{Algorithm: decision.DynamicRiskAStar}), w, "A")
	if on.NextNode != "C" || off.NextNode != "B" {
		t.Fatal("forecast not used", on, off)
	}
	// A single safe corridor has a forecast runner collision at B. Waiting at
	// A for a turn shifts entry beyond that high-probability first horizon.
	w.Graph.Edges = append(w.Graph.Edges[:2], w.Graph.Edges[4:]...)
	got := next(t, decision.NewWithOptions(decision.Options{Algorithm: decision.PredictiveTemporalAStar, Prediction: true, PredictionWeight: 100}), w, "A")
	if got.NextNode != "A" || got.TargetShelterID != "" || !reflect.DeepEqual(got.Route, []string{"A"}) {
		t.Fatal("expected explicit bounded wait", got)
	}
	// A hard-safe refuge one step away is admitted in this turn: no future
	// forecast may force waiting instead of completing evacuation now.
	w.Shelters = append(w.Shelters, shelter("NOW", "B"))
	if got := next(t, decision.NewWithOptions(decision.Options{Algorithm: decision.PredictiveTemporalAStar, Prediction: true, PredictionWeight: 100}), w, "A"); got.NextNode != "B" {
		t.Fatal("future forecast prevented admission", got)
	}
}

func TestPhase7AlgorithmCacheIsSnapshotScopedAndDefensive(t *testing.T) {
	for _, algorithm := range algorithms() {
		t.Run(algorithm, func(t *testing.T) {
			w := diamond().Clone()
			before := w.Clone()
			e := decision.NewWithOptions(decision.Options{Algorithm: algorithm, Prediction: true})
			var wg sync.WaitGroup
			for i := 0; i < 100; i++ {
				wg.Add(1)
				go func() {
					defer wg.Done()
					got := e.Candidates(context.Background(), w, survivor("A"))
					if len(got) != 1 || got[0].NextNode != "B" {
						t.Error(got)
						return
					}
					got[0].Route[0] = "mutated"
				}()
			}
			wg.Wait()
			if !reflect.DeepEqual(w, before) {
				t.Fatal("snapshot mutated")
			}
			other := w.Clone()
			other.Graph.Edges[0].Blocked = true
			if got := next(t, e, other, "A"); got.NextNode != "C" {
				t.Fatal("incompatible world content reused cache", got)
			}
			if got := next(t, e, w, "A"); got.NextNode != "B" {
				t.Fatal("session state contaminated", got)
			}
			ctx, cancel := context.WithCancel(context.Background())
			cancel()
			if got := e.NextStep(ctx, w, survivor("A")); got.NextNode != "A" {
				t.Fatal("cancellation did not wait", got)
			}
		})
	}
}

func TestRunnerProbabilityMassAndBoundsAreReproducible(t *testing.T) {
	w := forecastWorld()
	predictor := decision.NewRunnerPredictor(2)
	prediction := predictor.Probabilities(context.Background(), w)
	for name, values := range map[string]map[string]float64{"one": prediction.OneTurnNodes, "two": prediction.TwoTurnNodes} {
		sum := 0.
		for _, p := range values {
			if p < 0 || p > 1 || math.IsNaN(p) {
				t.Fatal("probability out of range", p)
			}
			sum += p
		}
		if math.Abs(sum-1) > 1e-12 {
			t.Fatalf("%s individual runner probability mass = %g", name, sum)
		}
	}
	for _, p := range prediction.EdgeRisk {
		if p < 0 || p > 1 {
			t.Fatal("edge probability", p)
		}
	}
	for i := 0; i < 20; i++ {
		if got := predictor.Probabilities(context.Background(), w); !reflect.DeepEqual(got, prediction) {
			t.Fatal("map-order-sensitive forecast")
		}
	}
	w.Zombies = append(w.Zombies, world.Zombie{ID: "hidden", Type: world.Sleeper, Awake: false, CurrentNode: "A"})
	if got := predictor.Probabilities(context.Background(), w); !reflect.DeepEqual(got, prediction) {
		t.Fatal("private sleeper influenced probability")
	}
	w.Zombies = append(w.Zombies, world.Zombie{ID: "runner2", Type: world.Runner, Awake: true, CurrentNode: "X"})
	combined := predictor.Probabilities(context.Background(), w)
	for node, p := range prediction.OneTurnNodes {
		want := 1 - (1-p)*(1-p)
		if combined.OneTurnNodes[node] != want {
			t.Fatal("incorrect multi-runner union")
		}
	}
}

func TestRunnerProbabilityHonorsClosuresAndRetainsTrappedMass(t *testing.T) {
	w := forecastWorld()
	w.BlockedEdges = []string{"XY", "XV"}
	got := decision.NewRunnerPredictor(2).Probabilities(context.Background(), w)
	if len(got.OneTurnNodes) != 1 || got.OneTurnNodes["X"] != 1 || len(got.EdgeRisk) != 0 {
		t.Fatal("runner crossed blocked street", got)
	}
	w.BlockedEdges = nil
	w.Scenario = &world.ScenarioSnapshot{RoadConditions: []world.RoadCondition{{EdgeID: "XY", State: "blocked"}, {EdgeID: "XV", State: "blocked"}}}
	got = decision.NewRunnerPredictor(2).Probabilities(context.Background(), w)
	if got.OneTurnNodes["X"] != 1 || len(got.EdgeRisk) != 0 {
		t.Fatal("overlay closure ignored", got)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if got := decision.NewRunnerPredictor(2).Probabilities(ctx, w); len(got.OneTurnNodes) > 0 {
		t.Fatal("canceled probability work")
	}
}
