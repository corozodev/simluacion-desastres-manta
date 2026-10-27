package coordination_test

import (
	"context"
	"testing"

	"corodev/evacuation/internal/coordination"
	"corodev/evacuation/internal/decision"
	"corodev/evacuation/internal/world"
)

func TestDisabledGlobalAssignmentStillEnforcesCapacity(t *testing.T) {
	w := star(2, 1)
	w.Shelters = w.Shelters[:2]
	w.Survivors[0].ID = "A-flexible"
	w.Survivors[1].ID = "Z-constrained"
	provider := providerFunc(func(ctx context.Context, w world.WorldSnapshot, s world.Survivor) []world.DecisionResult {
		all := choices(ctx, w, s)
		if s.ID == "Z-constrained" {
			return all[:1]
		}
		return all
	})
	on := coordination.New(provider, coordination.Options{}).Prepare(context.Background(), w)
	off := coordination.New(provider, coordination.Options{DisableAssignment: true}).Prepare(context.Background(), w)
	assertCapacity(t, on)
	assertCapacity(t, off)
	if assignment(on)["Z-constrained"] != "R1" || assignment(on)["A-flexible"] != "R2" {
		t.Fatal("global constrained assignment lost")
	}
	if assignment(off)["A-flexible"] != "R1" || assignment(off)["Z-constrained"] != "" {
		t.Fatal("independent mode did not use ID-ordered choices", assignment(off))
	}
	if off.Survivors[1].CurrentNode != "A" || len(off.Survivors[1].PlannedRoute) != 1 {
		t.Fatal("capacity-limited agent must wait", off.Survivors[1])
	}
	if off.Shelters[0].Reserved != 1 || off.Shelters[1].Reserved != 0 {
		t.Fatal("inconsistent independent reservations")
	}
}

func TestTemporalPublishedWaitRemainsCoherentThroughHTTPDecision(t *testing.T) {
	g := &world.Graph{Version: "temporal-test", Nodes: []world.GraphNode{{ID: "A"}, {ID: "B"}, {ID: "R"}, {ID: "X"}, {ID: "Y"}}}
	for _, pair := range [][2]string{{"A", "B"}, {"B", "R"}, {"X", "Y"}, {"Y", "B"}} {
		g.Edges = append(g.Edges, world.GraphEdge{ID: pair[0] + pair[1], From: pair[0], To: pair[1], DistanceM: 100, SpeedMPS: 1, RoadType: "test"})
	}
	g.Shelters = []world.Shelter{{ID: "SH", NodeID: "R", Capacity: 10}}
	w := world.WorldSnapshot{Graph: g, GraphVersion: g.Version, Shelters: g.Shelters, Zombies: []world.Zombie{{ID: "runner", Type: world.Runner, CurrentNode: "X", Awake: true}}, Survivors: []world.Survivor{{ID: "S0", CurrentNode: "B", Status: world.Active}, {ID: "S1", CurrentNode: "A", Status: world.Active}}}
	e := decision.NewWithOptions(decision.Options{Algorithm: decision.PredictiveTemporalAStar, Prediction: true, PredictionWeight: 100})
	got := coordination.New(e, coordination.Options{}).Prepare(context.Background(), w)
	assertCapacity(t, got)
	for _, s := range got.Survivors {
		if s.ID != "S1" {
			continue
		}
		if s.TargetShelterID != "" || len(s.PlannedRoute) != 1 || s.PlannedRoute[0] != "A" {
			t.Fatal("temporal wait lost during assignment", s)
		}
		step := e.NextStep(context.Background(), got, s)
		if step.NextNode != "A" || step.TargetShelterID != "" {
			t.Fatal("HTTP deviated from coherent published wait", step)
		}
	}
}

func TestOnboardPassengersRemainVisibleWithoutPedestrianAllocation(t *testing.T) {
	for _, disabled := range []bool{false, true} {
		w := star(3, 2)
		w.Shelters = w.Shelters[:1]
		// Simulator reserves the passenger's real seat as effective occupancy in
		// this planner-only input. It does not hide observable prey from engines.
		w.Shelters[0].Occupancy = 1
		passenger := &w.Survivors[0]
		passenger.VehicleID = "TRUCK-1"
		passenger.TargetShelterID = "R1"
		passenger.PlannedRoute = []string{passenger.CurrentNode}
		w.Zombies = []world.Zombie{{ID: "runner", Type: world.Runner, CurrentNode: "R2", Awake: true}}
		calls := 0
		provider := providerFunc(func(ctx context.Context, input world.WorldSnapshot, s world.Survivor) []world.DecisionResult {
			calls++
			if s.VehicleID != "" {
				t.Fatal("passenger entered pedestrian allocation")
			}
			if len(input.Survivors) != 3 || input.Survivors[0].VehicleID != "TRUCK-1" {
				t.Fatal("passenger hidden from observable input")
			}
			forecast := decision.NewRunnerPredictor(2).Predict(ctx, input)
			if len(forecast.TargetPaths) == 0 || forecast.TargetPaths[0].TargetID != passenger.ID {
				t.Fatal("observable passenger not considered as runner prey", forecast.TargetPaths)
			}
			return choices(ctx, input, s)
		})
		planner := coordination.New(provider, coordination.Options{DisableAssignment: disabled})
		got := planner.Prepare(context.Background(), w)
		if calls != 2 {
			t.Fatalf("expected two pedestrian requests, got %d", calls)
		}
		stats := planner.Stats()
		if stats.Active != 2 || stats.Assigned != 1 || stats.Unassigned != 1 {
			t.Fatal("passenger contaminated pedestrian statistics", stats)
		}
		if got.Survivors[0].VehicleID != passenger.VehicleID || got.Survivors[0].TargetShelterID != passenger.TargetShelterID {
			t.Fatal("passenger reservation changed", got.Survivors[0])
		}
		if got.Shelters[0].Occupancy != 1 || got.Shelters[0].Reserved != 1 || got.Shelters[0].Available != 0 {
			t.Fatal("effective onboard occupancy not respected", got.Shelters[0])
		}
		assigned := 0
		for _, s := range got.Survivors {
			if s.VehicleID == "" && s.TargetShelterID != "" {
				assigned++
			}
		}
		if assigned != 1 {
			t.Fatal("onboard seat allocated a second time", assigned)
		}
	}
}
