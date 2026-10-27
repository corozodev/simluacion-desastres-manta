package simulation

import (
	"context"
	"reflect"
	"slices"
	"testing"

	"corodev/evacuation/internal/flood"
	"corodev/evacuation/internal/world"
)

func TestFloodCombinesIndependentClosureSourcesAndPreservesBaseGraph(t *testing.T) {
	g := chain(4)
	g.Edges = append(g.Edges, world.GraphEdge{ID: "bypass", From: "A", To: "D", DistanceM: 400, SpeedMPS: 1.4, RoadType: "residential"})
	g.Edges[1].Blocked = true // B-C has another baseline route through A-D.
	base := g.Clone()
	fc := flood.DefaultConfig()
	fc.SimulationDuration, fc.RainfallIntensity = 20, 1
	h := flood.DefaultHydrologyConfig()
	h.InitialWaterDepthM, h.DrainageMMH, h.InfiltrationMMH = .35, 100, 100
	h.SecondsPerTurn = 300
	fc.Hydrology = &h
	cfg := Config{ScenarioType: "urban_flood", Flood: &fc, InitialSurvivors: []world.Survivor{survivor("S1", "B")}, Events: []ScheduledEvent{
		{Turn: 1, EdgeID: "E3", Blocked: true},
		{Turn: 2, EdgeID: "E1", Blocked: false},
		{Turn: 2, EdgeID: "E2", Blocked: false},
	}}
	s := create(t, g, cfg, decisionFunc(stay))
	step(t, s)
	w := step(t, s)
	for _, id := range []string{"E1", "E2", "E3"} {
		if !slices.Contains(w.BlockedEdges, id) {
			t.Fatalf("external reopen erased another closure source for %s", id)
		}
	}
	for w.Turn < 20 {
		w = step(t, s)
	}
	if slices.Contains(w.BlockedEdges, "E1") || !slices.Contains(w.BlockedEdges, "E2") || !slices.Contains(w.BlockedEdges, "E3") {
		t.Fatalf("drainage must reopen only flood closures, got %v", w.BlockedEdges)
	}
	if !reflect.DeepEqual(base, g.Clone()) || !reflect.DeepEqual(base, w.Graph.Clone()) || w.Metrics.Bitten != 0 {
		t.Fatal("overlay modified baseline geography or introduced a false death")
	}
	if err := s.Step(context.Background()); err == nil || s.Snapshot().Turn != 20 {
		t.Fatal("completed flood scenario accepted an unbounded extra step")
	}
}

func TestFloodSimulatorEnforcesWaitingEvenIfDecisionClientMoves(t *testing.T) {
	fc := flood.DefaultConfig()
	fc.RainfallIntensity, fc.EvacuationBehavior, fc.SimulationDuration = 0, "late", 10
	cfg := Config{ScenarioType: "urban_flood", Flood: &fc, InitialSurvivors: []world.Survivor{survivor("S1", "A")}}
	s := create(t, chain(3), cfg, decisionFunc(func(context.Context, world.StepRequest) (world.StepResponse, error) {
		return world.StepResponse{NextNode: "B"}, nil
	}))
	for i := 0; i < 5; i++ {
		w := step(t, s)
		if w.Survivors[0].CurrentNode != "A" || w.Scenario.Agents[0].State != "waiting" {
			t.Fatal("untrusted movement bypassed the authoritative waiting policy")
		}
	}
	if w := step(t, s); w.Survivors[0].CurrentNode != "B" {
		t.Fatal("late evacuation did not start at the configured policy trigger")
	}
}
