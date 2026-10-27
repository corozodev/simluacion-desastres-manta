package main

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"corodev/evacuation/internal/world"
)

func validWaitingSnapshot() world.WorldSnapshot {
	return world.WorldSnapshot{
		Survivors: []world.Survivor{{ID: "A", CurrentNode: "N", Status: world.Active}},
		Shelters:  []world.Shelter{{ID: "R", NodeID: "RN", Capacity: 1, Available: 1}},
		Metrics:   world.Metrics{Active: 1},
		Scenario: &world.ScenarioSnapshot{
			ScenarioType:      "urban_flood",
			Agents:            []world.FloodAgent{{ID: "A", CurrentNode: "N", State: "waiting"}},
			EvacuationMetrics: world.EvacuationMetrics{TotalAgents: 1, WaitingAgents: 1},
		},
	}
}

func TestDeterministicOutputExcludesTimingAndPreservesObservableChanges(t *testing.T) {
	w := validWaitingSnapshot()
	first, err := stableSnapshot(w)
	if err != nil {
		t.Fatal(err)
	}
	w.Metrics.HTTPP50MS, w.Metrics.HTTPP95MS, w.Metrics.HTTPP99MS = 1, 5, 9
	w.Scenario.Performance = world.SimulationPerformance{SimulationStepLatencyMS: 8, SimulationTotalDurationMS: 20}
	w.Simulation = &world.SimulationInfo{RunID: "random-run", StartedAt: "wall-time"}
	second, err := stableSnapshot(w)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(first, second) {
		t.Fatal("timing or process metadata changed deterministic output")
	}
	if w.Scenario.Performance.SimulationStepLatencyMS != 8 || w.Metrics.HTTPP95MS != 5 {
		t.Fatal("hash preparation mutated observable state")
	}
	w.Scenario.EvacuationMetrics.RerouteCount++
	third, err := stableSnapshot(w)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(first, third) {
		t.Fatal("deterministic output lost an actual simulation outcome")
	}
}

func TestValidationAcceptsLivingWaitingAndIsolatedAgents(t *testing.T) {
	w := validWaitingSnapshot()
	ids, baseline := map[string]bool{"A": true}, map[string]int{"R": 0}
	if err := validateSnapshot(w, ids, baseline); err != nil {
		t.Fatal(err)
	}
	w.Scenario.Agents[0].State = "isolated"
	w.Scenario.EvacuationMetrics.WaitingAgents = 0
	w.Scenario.EvacuationMetrics.IsolatedAgents = 1
	if err := validateSnapshot(w, ids, baseline); err != nil {
		t.Fatal(err)
	}
}

func TestValidationRejectsPopulationCapacityAndTransportFailures(t *testing.T) {
	tests := map[string]func(*world.WorldSnapshot){
		"missing population": func(w *world.WorldSnapshot) { w.Survivors = nil },
		"unknown agent":      func(w *world.WorldSnapshot) { w.Scenario.Agents[0].ID = "unknown" },
		"capacity exceeded":  func(w *world.WorldSnapshot) { w.Shelters[0].Reserved = 2 },
		"invented occupancy": func(w *world.WorldSnapshot) { w.Shelters[0].Occupancy = 1; w.Shelters[0].Available = 0 },
		"orphan reservation": func(w *world.WorldSnapshot) { w.Survivors[0].TargetShelterID = "missing" },
		"invalid response":   func(w *world.WorldSnapshot) { w.Metrics.RequestsInvalid = 1 },
		"timeout":            func(w *world.WorldSnapshot) { w.Metrics.RequestsTimeout = 1 },
		"zombie outcome":     func(w *world.WorldSnapshot) { w.Metrics.Bitten = 1 },
		"unknown outcome":    func(w *world.WorldSnapshot) { w.Survivors[0].Status = "dead" },
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			w := validWaitingSnapshot()
			mutate(&w)
			if err := validateSnapshot(w, map[string]bool{"A": true}, map[string]int{"R": 0}); err == nil {
				t.Fatal("broken invariant was accepted")
			}
		})
	}
}

func TestEvidenceFileIsPrivateEvenWhenReplacingExistingFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "report.json")
	if err := os.WriteFile(path, []byte("old"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := writePrivate(path, map[string]bool{"valid": true}); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0600 {
		t.Fatalf("private evidence permissions=%o", info.Mode().Perm())
	}
}
