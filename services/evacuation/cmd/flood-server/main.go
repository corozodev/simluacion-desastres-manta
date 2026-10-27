// Command flood-server exposes the experimental flood scenario for local polling.
// The competition server and its approved catalog remain independent.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"corodev/evacuation/internal/application"
	"corodev/evacuation/internal/graph"
	"corodev/evacuation/internal/simulation"
)

func run() error {
	graphPath := flag.String("graph", "data/manta-v2.json", "local graph JSON")
	scenarioPath := flag.String("scenario", "scenarios/flood/urban-storm.json", "urban_flood configuration")
	listen := flag.String("listen", "127.0.0.1:8081", "HTTP polling address")
	interval := flag.Duration("interval", time.Second, "wall clock step interval; 0 accelerates")
	origin := flag.String("origin", "http://localhost:5173,http://127.0.0.1:5173", "comma-separated browser origins")
	flag.Parse()
	if *interval < 0 {
		return fmt.Errorf("interval must be nonnegative")
	}
	g, err := graph.Load(*graphPath)
	if err != nil {
		return err
	}
	cfg, err := simulation.LoadConfig(*scenarioPath)
	if err != nil {
		return err
	}
	if cfg.ScenarioType != "urban_flood" {
		return fmt.Errorf("flood-server requires scenario_type urban_flood")
	}
	key := os.Getenv("API_KEY")
	if key == "" {
		key, err = application.EphemeralKey()
		if err != nil {
			return err
		}
	}
	app, err := application.New(g, cfg, *listen, key, strings.Split(*origin, ","), nil)
	if err != nil {
		return err
	}
	defer app.Close()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	encoder := json.NewEncoder(os.Stdout)
	if err := encoder.Encode(map[string]any{"event": "ready", "url": app.BaseURL, "scenario_type": cfg.ScenarioType, "seed": cfg.Seed, "turn_limit": cfg.Turns, "nodes": len(g.Nodes), "edges": len(g.Edges)}); err != nil {
		return err
	}
	done := make(chan error, 1)
	go func() { done <- app.Simulator.Run(ctx, cfg.Turns, *interval) }()
	select {
	case err := <-done:
		if err != nil && ctx.Err() == nil {
			return err
		}
		if ctx.Err() != nil {
			return nil
		}
		if err := encoder.Encode(map[string]any{"event": "complete", "scenario": app.Simulator.Snapshot().Scenario}); err != nil {
			return err
		}
		// Keep the final snapshot available for React polling until interrupted.
		<-ctx.Done()
	case <-ctx.Done():
		<-done
	}
	return nil
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
