package evaluation_test

import (
	"context"
	"testing"

	"corodev/evacuation/internal/decision"
	"corodev/evacuation/internal/evaluation"
	"corodev/evacuation/internal/evaluation/phase1"
	"corodev/evacuation/internal/graph"
	"corodev/evacuation/internal/simulation"
)

func TestHistoricalBaselineSurvivesInstrumentedReplay(t *testing.T) {
	g, err := graph.Load("../../data/manta-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	cfg, err := simulation.LoadConfig("../../scenarios/round3.json")
	if err != nil {
		t.Fatal(err)
	}
	initial, err := evaluation.Capture(g, cfg)
	if err != nil {
		t.Fatal(err)
	}
	replayed, replayConfig, remaps, err := evaluation.Replay(g, g, cfg, initial)
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range remaps {
		if r.DistanceM != 0 {
			t.Fatalf("same graph moved %s by %fm", r.EntityID, r.DistanceM)
		}
	}
	result, err := evaluation.Run(context.Background(), replayed, replayConfig, "regression", "phase1", phase1.New(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if result.Metrics.Evacuated != 38 || result.Metrics.Bitten != 150 || result.Metrics.Active != 12 {
		t.Fatalf("historical baseline changed: %+v", result.Metrics)
	}
	if result.Metrics.RequestsInvalid != 0 || result.Metrics.RequestsTimeout != 0 {
		t.Fatal("baseline HTTP failed")
	}
	if result.PredictionAudit.Turns != 150 {
		t.Fatal("prediction audit was not run against complete actual observations")
	}
}

func TestAlgorithmsReceiveIdenticalGeographicInitialState(t *testing.T) {
	g, err := graph.Load("../../data/manta-v2.json")
	if err != nil {
		t.Fatal(err)
	}
	cfg, err := simulation.LoadConfig("../../scenarios/urban/round1.json")
	if err != nil {
		t.Fatal(err)
	}
	cfg.Turns = 3
	a, err := evaluation.Run(context.Background(), g, cfg, "urban", "phase1", phase1.New(), nil)
	if err != nil {
		t.Fatal(err)
	}
	b, err := evaluation.Run(context.Background(), g, cfg, "urban", "no-prediction", decision.NewWithOptions(decision.Options{Prediction: false}), nil)
	if err != nil {
		t.Fatal(err)
	}
	if a.InitialStateSHA256 != b.InitialStateSHA256 || a.GraphSHA256 != b.GraphSHA256 {
		t.Fatal("algorithm comparison changed initial conditions")
	}
	if len(a.Diagnostics.InitialSurvivors) != 20 || len(a.Diagnostics.InitialZombies) != 8 {
		t.Fatal("incorrect comparison populations")
	}
}
