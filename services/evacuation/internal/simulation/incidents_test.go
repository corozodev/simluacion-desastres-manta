package simulation

import (
	"context"
	"errors"
	"reflect"
	"slices"
	"testing"

	"corodev/evacuation/internal/coordination"
	decisionengine "corodev/evacuation/internal/decision"
	"corodev/evacuation/internal/flood"
	"corodev/evacuation/internal/world"
)

func overlaySimulator(t *testing.T, g *world.Graph) *Simulator {
	t.Helper()
	fc := flood.DefaultConfig()
	fc.RainfallIntensity = 0
	fc.SimulationDuration = 10
	s := create(t, g, Config{ScenarioType: "urban_flood", Flood: &fc, InitialSurvivors: []world.Survivor{survivor("S1", "A")}}, decisionFunc(stay))
	s.SetPlanner(coordination.New(decisionengine.New(), coordination.Options{}))
	return s
}
func TestExperimentalOverlayReplansWithoutMovingAndHasPersistenceBarrier(t *testing.T) {
	g := chain(4)
	g.Edges = append(g.Edges, world.GraphEdge{ID: "bypass", From: "A", To: "D", DistanceM: 400, SpeedMPS: 1.4, RoadType: "residential"})
	s := overlaySimulator(t, g)
	base := g.Clone()
	before := s.Snapshot()
	input := ExperimentalRoadOverlay{IncidentID: "citizen-observation", EdgeIDs: []string{"bypass"}, Effect: "blocked", DurationSteps: 2}
	diskErr := errors.New("disk unavailable")
	if _, err := s.ApplyExperimentalRoadOverlay(context.Background(), input, func(OverlayResult) error { return diskErr }); !errors.Is(err, diskErr) {
		t.Fatal("disk barrier error not returned", err)
	}
	after := s.Snapshot()
	if after.WorldVersion != before.WorldVersion || !reflect.DeepEqual(before.Survivors, after.Survivors) || !reflect.DeepEqual(before.BlockedEdges, after.BlockedEdges) {
		t.Fatal("failed disk transaction changed world")
	}
	called := 0
	result, err := s.ApplyExperimentalRoadOverlay(context.Background(), input, func(r OverlayResult) error {
		called++
		if r.WorldVersion != before.WorldVersion+1 || r.SimulationStep != 0 || r.ExpiresAtSimulationStep != 3 {
			t.Fatal(r)
		}
		return nil
	})
	if err != nil || called != 1 {
		t.Fatal(result, err)
	}
	after = s.Snapshot()
	if after.Turn != before.Turn || after.WorldVersion != before.WorldVersion+1 || after.Survivors[0].CurrentNode != before.Survivors[0].CurrentNode || !slices.Contains(after.BlockedEdges, "bypass") || reflect.DeepEqual(before.Survivors[0].PlannedRoute, after.Survivors[0].PlannedRoute) || !reflect.DeepEqual(after.Survivors[0].PlannedRoute, []string{"A", "B", "C", "D"}) {
		t.Fatalf("overlay did not replan without movement: before=%+v after=%+v", before.Survivors, after.Survivors)
	}
	if !reflect.DeepEqual(base, g.Clone()) || !reflect.DeepEqual(base, after.Graph.Clone()) {
		t.Fatal("experimental closure modified baseline graph")
	}
	if _, err = s.ApplyExperimentalRoadOverlay(context.Background(), input, func(OverlayResult) error { called++; return nil }); err != nil || called != 1 || s.Snapshot().WorldVersion != after.WorldVersion {
		t.Fatal("repeat application changed world", err)
	}
	input.Effect = "caution"
	if _, err = s.ApplyExperimentalRoadOverlay(context.Background(), input, func(OverlayResult) error { return nil }); err == nil {
		t.Fatal("same incident accepted another effect")
	}
}

func TestExperimentalOverlaysExpireIndependentlyAndPreserveBaseClosure(t *testing.T) {
	g := chain(4)
	g.Edges = append(g.Edges, world.GraphEdge{ID: "bypass", From: "A", To: "D", DistanceM: 400, SpeedMPS: 1.4, RoadType: "residential"})
	g.Edges[1].Blocked = true
	s := overlaySimulator(t, g)
	for _, input := range []ExperimentalRoadOverlay{{"one", []string{"E1"}, "blocked", 1}, {"three", []string{"E1", "E2"}, "blocked", 3}, {"caution", []string{"E3"}, "caution", 1}} {
		if _, err := s.ApplyExperimentalRoadOverlay(context.Background(), input, func(OverlayResult) error { return nil }); err != nil {
			t.Fatal(err)
		}
	}
	for _, road := range s.Snapshot().Scenario.RoadConditions {
		if road.EdgeID == "E3" && (road.State != "caution" || road.CostMultiplier < 2) {
			t.Fatal("caution did not change route cost", road)
		}
	}
	w := step(t, s)
	if !slices.Contains(w.BlockedEdges, "E1") {
		t.Fatal("duration1 did not last a movement turn")
	}
	w = step(t, s)
	if !slices.Contains(w.BlockedEdges, "E1") {
		t.Fatal("one incident expiry erased overlapping incident")
	}
	for _, road := range w.Scenario.RoadConditions {
		if road.EdgeID == "E3" && road.State != "passable" {
			t.Fatal("expired caution survived", road)
		}
	}
	step(t, s)
	w = step(t, s)
	if slices.Contains(w.BlockedEdges, "E1") || !slices.Contains(w.BlockedEdges, "E2") {
		t.Fatal("expiry removed base closure or failed to reopen incident-only road", w.BlockedEdges)
	}
}

func TestExperimentalOverlayRejectsZombieUnknownEdgesAndCancelledContext(t *testing.T) {
	z := create(t, chain(4), Config{InitialSurvivors: []world.Survivor{survivor("S1", "B")}, InitialZombies: []world.Zombie{zombie(world.Walker, "A")}}, decisionFunc(stay))
	before := z.Snapshot()
	input := ExperimentalRoadOverlay{"report", []string{"E1"}, "blocked", 1}
	called := false
	barrier := func(OverlayResult) error { called = true; return nil }
	if _, err := z.ApplyExperimentalRoadOverlay(context.Background(), input, barrier); err == nil || called || !reflect.DeepEqual(before, z.Snapshot()) {
		t.Fatal("zombie world accepted/mutated by incident overlay", err)
	}
	s := overlaySimulator(t, chain(4))
	input.EdgeIDs = []string{"invented"}
	if _, err := s.ApplyExperimentalRoadOverlay(context.Background(), input, barrier); err == nil || called {
		t.Fatal("invented road reached persistence barrier")
	}
	input.EdgeIDs = []string{"E1"}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := s.ApplyExperimentalRoadOverlay(ctx, input, barrier); !errors.Is(err, context.Canceled) || called {
		t.Fatal("cancelled request changed world", err)
	}
}
