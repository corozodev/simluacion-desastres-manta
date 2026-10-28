package floodlab

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"

	"corodev/evacuation/internal/flood"
	"corodev/evacuation/internal/runlimits"
	"corodev/evacuation/internal/simulation"
	"corodev/evacuation/internal/world"
)

func TestDurationValidationAndHydraulicInputsHTTP(t *testing.T) {
	m := newManager(t)
	server := httptest.NewServer(m)
	defer server.Close()
	if m.Catalog().DurationLimits != runlimits.Duration() {
		t.Fatal("duration bounds not centralized")
	}
	for _, duration := range []float64{0, 29, 30.5, 3001} {
		cfg := compactConfig(m)
		cfg.SimulationDuration = duration
		code, _, _ := labPublicRequest(t, server, "POST", "/lab/runs", RunRequest{Config: cfg, ExpectedRunID: m.State().RunID}, "")
		if code != 400 {
			t.Fatalf("accepted duration %g: HTTP%d", duration, code)
		}
	}
	cfg := compactConfig(m)
	cfg.HydraulicModel = "legacy"
	code, _, _ := labPublicRequest(t, server, "POST", "/lab/runs", RunRequest{Config: cfg, ExpectedRunID: m.State().RunID}, "")
	if code != 400 {
		t.Fatal("retired radial motor still selectable")
	}
	cfg.HydraulicModel = "compound_flood_2d"
	h := flood.DefaultHydrologyConfig()
	h.InitialSaturation = .8
	h.InitialWaterDepthM = .1
	h.SeaLevelM = 1
	h.ChannelInflowM3S = 2
	cfg.Hydrology = &h
	cfg.IntervalMS = 1000
	code, raw, _ := labPublicRequest(t, server, "POST", "/lab/runs", RunRequest{Config: cfg, ExpectedRunID: m.State().RunID}, "")
	var running State
	if code != 200 || json.Unmarshal(raw, &running) != nil || running.Scenario.Hydraulic == nil || running.Config.HydraulicModel != cfg.HydraulicModel {
		t.Fatalf("hydrology not integrated: HTTP%d %s", code, raw)
	}
	cfg.Hydrology.InitialWaterDepthM = 1.8
	if m.State().Config.Hydrology.InitialWaterDepthM != .1 {
		t.Fatal("mutable request aliased run hydrology")
	}
	code, raw, _ = labPublicRequest(t, server, "POST", "/lab/actions", Action{Action: "cancel", ExpectedRunID: running.RunID}, "")
	var cancelled State
	if code != 200 || json.Unmarshal(raw, &cancelled) != nil || cancelled.State != "cancelled" {
		t.Fatal("long run cannot be cancelled")
	}
	before := m.State()
	after := m.State()
	if before.Scenario.SimulationStep != after.Scenario.SimulationStep || before.RuntimeElapsedMS != after.RuntimeElapsedMS {
		t.Fatal("cancelled execution kept advancing")
	}
	code, _, _ = labPublicRequest(t, server, "POST", "/lab/actions", Action{Action: "cancel", ExpectedRunID: cancelled.RunID}, "")
	if code != 200 {
		t.Fatal("repeated cancellation did not preserve the final run")
	}
	code, raw, _ = labPublicRequest(t, server, "POST", "/lab/actions", Action{Action: "restart", ExpectedRunID: cancelled.RunID}, "")
	var restarted State
	if code != 200 || json.Unmarshal(raw, &restarted) != nil || restarted.State != "idle" || restarted.RunID == cancelled.RunID || restarted.Scenario.SimulationStep != 0 {
		t.Fatal("cancelled run could not release its resources and restart")
	}
}

func TestFloodDurationsCompleteReproduciblyAndBoundTimeline(t *testing.T) {
	m := newManager(t)
	server := httptest.NewServer(m)
	defer server.Close()
	for _, duration := range []int{30, 150, 300, 600, 1200, 3000} {
		t.Run(fmt.Sprint(duration), func(t *testing.T) {
			cfg := compactConfig(m)
			cfg.Agents = 1
			cfg.SimulationDuration = float64(duration)
			cfg.IntervalMS = 0
			h := flood.DefaultHydrologyConfig()
			h.CellSizeM = 400
			h.SecondsPerTurn = 2
			cfg.Hydrology = &h
			var previous *world.ScenarioSnapshot
			for replay := 0; replay < 2; replay++ {
				// Both initialization and every movement decision cross actual HTTP.
				var body any = RunRequest{Config: cfg, ExpectedRunID: m.State().RunID}
				path := "/lab/runs"
				if replay == 1 {
					path = "/lab/actions"
					body = Action{Action: "repeat", ExpectedRunID: m.State().RunID}
				}
				code, raw, _ := labPublicRequest(t, server, "POST", path, body, "")
				var created State
				if code != 200 || json.Unmarshal(raw, &created) != nil {
					t.Fatalf("HTTP%d %s", code, raw)
				}
				var final State
				deadline := time.Now().Add(3 * time.Minute)
				for {
					final = m.State()
					if final.State == "finished" || final.State == "failed" {
						break
					}
					if time.Now().After(deadline) {
						t.Fatalf("long run did not terminate: %s turn%d", final.State, final.Scenario.SimulationStep)
					}
					time.Sleep(20 * time.Millisecond)
				}
				if final.State != "finished" || final.Scenario.SimulationStep != duration || final.Scenario.SimulationTime != float64(duration) || final.Scenario.SimulationDuration != float64(duration) {
					t.Fatalf("incorrect horizon: %s step%d time%g/%g", final.State, final.Scenario.SimulationStep, final.Scenario.SimulationTime, final.Scenario.SimulationDuration)
				}
				if len(final.Timeline) > 512 || final.Timeline[0].Step != 0 || final.Timeline[len(final.Timeline)-1].Step != duration {
					t.Fatal("timeline unbounded or dropped endpoints")
				}
				hydraulic := final.Scenario.Hydraulic
				if hydraulic == nil || len(hydraulic.DepthsM) > flood.MaxHydraulicCells || hydraulic.HydrologicalTimeSeconds != float64(duration)*h.SecondsPerTurn || math.Abs(hydraulic.MassBalance.ResidualM3) > 1e-4 {
					t.Fatal("long hydraulic state invalid", hydraulic)
				}
				for _, depth := range hydraulic.DepthsM {
					if depth < 0 || math.IsNaN(depth) || math.IsInf(depth, 0) {
						t.Fatal("nonphysical stored depth")
					}
				}
				logical := final.Scenario.Clone()
				logical.Performance = world.SimulationPerformance{}
				if replay == 1 && !reflect.DeepEqual(previous, logical) {
					t.Fatal("same configuration/seed changed long outcome")
				}
				previous = logical
			}
		})
	}
}

func TestRainProfilesAndEvacuationBehaviorsRemainCompatible(t *testing.T) {
	m := newManager(t)
	for _, profile := range []string{"storm", "constant", "pulse"} {
		for _, behavior := range []string{"preventive", "late", "adaptive"} {
			t.Run(profile+"/"+behavior, func(t *testing.T) {
				cfg := compactConfig(m)
				cfg.RainfallProfile = profile
				cfg.EvacuationBehavior = behavior
				cfg.RainfallIntensity = 1
				h := flood.DefaultHydrologyConfig()
				h.InitialWaterDepthM = .35
				h.InitialSaturation = .8
				cfg.Hydrology = &h
				run, err := m.prepare(cfg)
				if err != nil {
					t.Fatal(err)
				}
				defer run.app.Close()
				for turn := 0; turn < run.turns; turn++ {
					if err := run.app.Simulator.Step(context.Background()); err != nil {
						t.Fatal(err)
					}
				}
				snapshot := run.app.Simulator.Snapshot()
				if snapshot.Metrics.Bitten != 0 || snapshot.Metrics.RequestsInvalid != 0 || snapshot.Metrics.RequestsTimeout != 0 {
					t.Fatal("hydrology introduced arbitrary deaths or illegal movements")
				}
				for _, agent := range snapshot.Scenario.Agents {
					if agent.Behavior != behavior {
						t.Fatal("evacuation behavior was renamed")
					}
				}
				for _, shelter := range snapshot.Shelters {
					if shelter.Occupancy+shelter.Reserved > shelter.Capacity {
						t.Fatal("hydrology exceeded shelter capacity")
					}
				}
			})
		}
	}
}

func TestHydraulicCohortPreservesHistoricalSeededSpawn(t *testing.T) {
	m := newManager(t)
	cfg := compactConfig(m)
	cohort, _, err := m.freeze(cfg, m.graphs["competition"])
	if err != nil {
		t.Fatal(err)
	}
	fc := flood.DefaultConfig()
	previous, err := simulation.New(m.graphs["competition"], world.NewStore(), simulation.Config{ScenarioType: "urban_flood", Flood: &fc, Seed: cfg.Seed, Survivors: cfg.Agents, UseSpawnZones: true}, initialClient{})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(cohort, previous.Snapshot().Survivors) {
		t.Fatal("cohort changed seeded initial survivor population")
	}
}
