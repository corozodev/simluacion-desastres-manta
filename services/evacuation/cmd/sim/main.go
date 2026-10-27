package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"corodev/evacuation/internal/application"
	"corodev/evacuation/internal/graph"
	"corodev/evacuation/internal/simulation"
	"corodev/evacuation/internal/world"
)

type report struct {
	ScenarioType      string                       `json:"scenario_type,omitempty"`
	EvacuationMetrics *world.EvacuationMetrics     `json:"evacuation_metrics,omitempty"`
	Performance       *world.SimulationPerformance `json:"performance,omitempty"`
	Scenario          string                       `json:"scenario"`
	Seed              int64                        `json:"seed"`
	GraphVersion      string                       `json:"graph_version"`
	GraphSource       string                       `json:"graph_source"`
	Nodes             int                          `json:"nodes"`
	Edges             int                          `json:"edges"`
	Survivors         int                          `json:"survivors"`
	Concurrency       int                          `json:"concurrency"`
	ElapsedMS         float64                      `json:"elapsed_ms"`
	Metrics           world.Metrics                `json:"metrics"`
}

func run() error {
	graphPath := flag.String("graph", "data/manta-v2.json", "versioned graph JSON")
	scenarioPath := flag.String("scenario", "scenarios/urban/round1.json", "scenario JSON")
	turns := flag.Int("turns", 0, "turns (0 uses scenario)")
	seed := flag.Int64("seed", 0, "seed override (0 uses scenario)")
	concurrency := flag.Int("concurrency", 0, "concurrent HTTP requests (0 uses scenario)")
	interval := flag.Duration("interval", 0, "turn interval; 0 is accelerated")
	output := flag.String("output", "", "write measured JSON report")
	initialOutput := flag.String("initial-output", "", "write initial observable snapshot for geographic audit")
	finalOutput := flag.String("final-output", "", "write final scenario overlay (urban_flood) or observable state")
	diagnosticsOutput := flag.String("diagnostics-output", "", "write private offline diagnostic report (never publish this file)")
	flag.Parse()
	if *turns < 0 || *concurrency < 0 || *interval < 0 {
		return fmt.Errorf("turns, concurrency and interval must not be negative")
	}
	g, err := graph.Load(*graphPath)
	if err != nil {
		return err
	}
	cfg, err := simulation.LoadConfig(*scenarioPath)
	if err != nil {
		return err
	}
	if *turns > 0 {
		cfg.Turns = *turns
	}
	if *seed != 0 {
		cfg.Seed = *seed
	}
	if *concurrency > 0 {
		cfg.Concurrency = *concurrency
	}
	key, err := application.EphemeralKey()
	if err != nil {
		return err
	}
	app, err := application.New(g, cfg, "127.0.0.1:0", key, nil, nil)
	if err != nil {
		return err
	}
	defer app.Close()
	if *initialOutput != "" {
		initial, err := json.MarshalIndent(app.Simulator.Snapshot(), "", "  ")
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(*initialOutput), 0755); err != nil {
			return err
		}
		if err := os.WriteFile(*initialOutput, append(initial, '\n'), 0644); err != nil {
			return err
		}
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	started := time.Now()
	if err := app.Simulator.Run(ctx, cfg.Turns, *interval); err != nil {
		return err
	}
	snapshot := app.Simulator.Snapshot()
	if *finalOutput != "" {
		var final any = snapshot
		if snapshot.Scenario != nil {
			final = snapshot.Scenario
		}
		raw, err := json.MarshalIndent(final, "", "  ")
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(*finalOutput), 0755); err != nil {
			return err
		}
		if err := os.WriteFile(*finalOutput, append(raw, '\n'), 0644); err != nil {
			return err
		}
	}
	if *diagnosticsOutput != "" {
		diagnostic, err := json.MarshalIndent(app.Simulator.Diagnostics(), "", "  ")
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(*diagnosticsOutput), 0755); err != nil {
			return err
		}
		if err := os.WriteFile(*diagnosticsOutput, append(diagnostic, '\n'), 0600); err != nil {
			return err
		}
	}
	result := report{Scenario: cfg.Name, Seed: cfg.Seed, GraphVersion: g.Version, GraphSource: g.Source, Nodes: len(g.Nodes), Edges: len(g.Edges), Survivors: len(snapshot.Survivors), Concurrency: cfg.Concurrency, ElapsedMS: float64(time.Since(started).Microseconds()) / 1000, Metrics: snapshot.Metrics}
	if snapshot.Scenario != nil {
		result.ScenarioType = snapshot.Scenario.ScenarioType
		result.EvacuationMetrics = &snapshot.Scenario.EvacuationMetrics
		result.Performance = &snapshot.Scenario.Performance
	}
	data, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	if *output != "" {
		if err := os.MkdirAll(filepath.Dir(*output), 0755); err != nil {
			return err
		}
		if err := os.WriteFile(*output, data, 0644); err != nil {
			return err
		}
	}
	fmt.Print(string(data))
	return nil
}
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
