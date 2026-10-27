package decision_test

import (
	"context"
	"math"
	"reflect"
	"testing"

	"corodev/evacuation/internal/decision"
	"corodev/evacuation/internal/world"
)

func TestFloodRoadOverlayReroutesAndReopensWithoutChangingGraph(t *testing.T) {
	w := diamond()
	graphBefore := w.Graph.Clone()
	w.Scenario = &world.ScenarioSnapshot{ScenarioType: "urban_flood"}
	e := decision.New()
	if got := next(t, e, w, "A"); got.NextNode != "B" {
		t.Fatal(got)
	}
	// Omit BlockedEdges deliberately: decision safety also understands the
	// scenario overlay independently of the simulator's combined closure list.
	w.Scenario.RoadConditions = []world.RoadCondition{{EdgeID: "AB", State: "blocked", RiskSource: "urban_flood", RiskScore: .8}}
	if got := next(t, e, w, "A"); got.NextNode != "C" {
		t.Fatalf("closed avenue did not invalidate the old search: %+v", got)
	}
	w.Scenario.RoadConditions = append(w.Scenario.RoadConditions, world.RoadCondition{EdgeID: "AC", State: "blocked"})
	if got := next(t, e, w, "A"); got.NextNode != "A" || got.TargetShelterID != "" {
		t.Fatalf("isolated agent must wait alive: %+v", got)
	}
	w.Scenario.RoadConditions = []world.RoadCondition{{EdgeID: "AB", State: "passable", UpdatedAtSimulationStep: 12}}
	if got := next(t, e, w, "A"); got.NextNode != "B" {
		t.Fatalf("drained avenue did not reopen: %+v", got)
	}
	if !reflect.DeepEqual(graphBefore, w.Graph.Clone()) {
		t.Fatal("flood routing changed the original graph")
	}
}

func TestFloodCautionCostAndOnlyEffectiveChangesInvalidateCache(t *testing.T) {
	w := diamond()
	w.Scenario = &world.ScenarioSnapshot{RoadConditions: []world.RoadCondition{{EdgeID: "AB", State: "caution", CostMultiplier: 4, RiskScore: .4}}}
	e := decision.New()
	if got := next(t, e, w, "A"); got.NextNode != "C" {
		t.Fatalf("caution cost ignored: %+v", got)
	}
	initial := e.Stats()
	w.WorldVersion++
	w.Turn++
	w.Scenario.RoadConditions[0].UpdatedAtSimulationStep = w.Turn
	w.Scenario.RoadConditions[0].RiskScore = .49
	w.Scenario.RoadConditions[0].RiskSource = "synthetic_rainfall"
	w.Scenario.ShelterConditions = []world.ShelterCondition{{ShelterID: "REF-1", State: "available", RiskScore: .2}}
	_ = next(t, e, w, "A")
	if got := e.Stats(); got.Builds != initial.Builds || got.Searches != initial.Searches {
		t.Fatalf("descriptive changes repeated reverse searches: before=%+v after=%+v", initial, got)
	}
	w.Scenario.RoadConditions[0].CostMultiplier = 1
	if got := next(t, e, w, "A"); got.NextNode != "B" {
		t.Fatalf("effective cost change kept stale search: %+v", got)
	}
	if got := e.Stats(); got.Builds <= initial.Builds {
		t.Fatal("changing an effective caution cost did not invalidate routing")
	}
	for _, multiplier := range []float64{0, -1, math.NaN(), math.Inf(1)} {
		w.Scenario.RoadConditions[0].CostMultiplier = multiplier
		if got := next(t, decision.New(), w, "A"); got.NextNode != "B" || math.IsNaN(got.Cost) || math.IsInf(got.Cost, 0) {
			t.Fatalf("invalid multiplier %v produced invalid routing: %+v", multiplier, got)
		}
	}
}

func TestFloodShelterExposureInvalidatesDestinationWithoutChangingCapacity(t *testing.T) {
	w := diamond()
	w.Shelters = append(w.Shelters, shelter("REF-2", "C"))
	w.Scenario = &world.ScenarioSnapshot{}
	e := decision.New()
	if got := next(t, e, w, "A"); got.TargetShelterID != "REF-2" {
		t.Fatal(got)
	}
	for _, state := range []string{"exposed", "inaccessible"} {
		w.Scenario.ShelterConditions = []world.ShelterCondition{{ShelterID: "REF-2", State: state}}
		if got := next(t, e, w, "A"); got.TargetShelterID != "REF-1" {
			t.Fatalf("%s shelter remained a destination: %+v", state, got)
		}
	}
	w.Scenario.ShelterConditions[0].State = "available"
	if got := next(t, e, w, "A"); got.TargetShelterID != "REF-2" || w.Shelters[1].Capacity != 200 {
		t.Fatalf("shelter reopening changed capacity or retained stale routing: %+v", got)
	}
}

func TestFloodWaitingOverridesPreviousPlansAndEmergencyEscape(t *testing.T) {
	w := diamond()
	w.Scenario = &world.ScenarioSnapshot{Agents: []world.FloodAgent{{ID: "S1", State: "waiting", Behavior: "late"}}}
	v := survivor("A")
	v.TargetShelterID, v.PlannedRoute = "REF-1", []string{"A", "B", "R"}
	w.Zombies = []world.Zombie{{ID: "synthetic-danger", Type: world.Walker, CurrentNode: "A", Awake: true}}
	e := decision.New()
	if got := e.NextStep(context.Background(), w, v); got.NextNode != "A" || got.TargetShelterID != "" {
		t.Fatalf("scenario-directed waiting was bypassed: %+v", got)
	}
	if got := e.Candidates(context.Background(), w, v); len(got) != 0 {
		t.Fatalf("waiting agent requested a reservation: %+v", got)
	}
	if got := e.Escape(context.Background(), w, v); got.NextNode != "A" {
		t.Fatalf("waiting agent escaped against scenario policy: %+v", got)
	}
	w.Scenario.Agents[0].State = "evacuating"
	w.Zombies = nil
	if got := e.NextStep(context.Background(), w, v); got.NextNode != "B" {
		t.Fatalf("released agent did not follow its legal route: %+v", got)
	}
}
