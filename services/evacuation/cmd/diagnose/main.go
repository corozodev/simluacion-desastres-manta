// Command diagnose measures the existing internal observation hooks offline.
// It never connects to AWS or exports private scenario diagnostics.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"time"

	"corodev/evacuation/internal/application"
	"corodev/evacuation/internal/coordination"
	"corodev/evacuation/internal/decision"
	"corodev/evacuation/internal/diagnostics"
	"corodev/evacuation/internal/graph"
	"corodev/evacuation/internal/httpapi"
	"corodev/evacuation/internal/simulation"
	"corodev/evacuation/internal/world"
)

type observation struct {
	mu                        sync.Mutex
	snapshot, decision, total []time.Duration
}

func (o *observation) observe(t httpapi.RequestTiming) {
	if t.Path != "/paso" {
		return
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	o.snapshot = append(o.snapshot, time.Duration(t.SnapshotMS*float64(time.Millisecond)))
	o.decision = append(o.decision, time.Duration(t.DecisionMS*float64(time.Millisecond)))
	o.total = append(o.total, time.Duration(t.TotalMS*float64(time.Millisecond)))
}
func (o *observation) reset() {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.snapshot = nil
	o.decision = nil
	o.total = nil
}
func (o *observation) summary() map[string]diagnostics.Timing {
	o.mu.Lock()
	defer o.mu.Unlock()
	return map[string]diagnostics.Timing{"snapshot_clone": diagnostics.Measure(o.snapshot), "engine_next_step": diagnostics.Measure(o.decision), "handler": diagnostics.Measure(o.total)}
}

func run() error {
	gp := flag.String("graph", "data/manta-v2.json", "validated offline graph")
	sp := flag.String("scenario", "scenarios/urban/round3.json", "validated scenario")
	count := flag.Int("requests", 1000, "stable snapshot measurements (1..10000)")
	turns := flag.Int("turns", 0, "optional offline simulation turns, 0..150; never resets the live service")
	stableAfter := flag.Int("stable-after-turns", 0, "advance the isolated world before stable measurements; incompatible with -turns")
	simConcurrency := flag.Int("simulation-concurrency", 0, "override scenario simulation workers, 1..200; zero keeps scenario configuration")
	workers := flag.Int("concurrency", 1, "HTTP workers, 1..16")
	output := flag.String("output", "", "private JSON output")
	flag.Parse()
	if *count < 1 || *count > 10000 || *turns < 0 || *turns > 150 || *stableAfter < 0 || *stableAfter > 150 || (*stableAfter > 0 && *turns > 0) || *simConcurrency < 0 || *simConcurrency > 200 || *workers < 1 || *workers > 16 || *output == "" {
		return errors.New("require output, requests 1..10000, turns 0..150 and concurrency 1..16")
	}
	g, err := graph.Load(*gp)
	if err != nil {
		return err
	}
	cfg, err := simulation.LoadConfig(*sp)
	if err != nil {
		return err
	}
	if *simConcurrency > 0 {
		cfg.Concurrency = *simConcurrency
	}
	key, err := application.EphemeralKey()
	if err != nil {
		return err
	}
	engine := decision.New()
	o := &observation{}
	app, err := application.NewWithOptions(g, cfg, "127.0.0.1:0", key, nil, nil, application.Options{Engine: engine, Planner: coordination.New(engine, coordination.Options{}), Observe: o.observe})
	if err != nil {
		return err
	}
	defer app.Close()
	client, err := simulation.NewHTTPDecisionClient(app.BaseURL, key, 500*time.Millisecond)
	if err != nil {
		return err
	}
	defer client.CloseIdleConnections()
	runSimulation := func(n int) (map[string]any, error) {
		o.reset()
		if err := app.Simulator.Run(context.Background(), n, 0); err != nil {
			return nil, err
		}
		d := app.Simulator.Diagnostics()
		return map[string]any{"turns": n, "interval": "accelerated isolated process, no sleep", "simulation_concurrency": cfg.Concurrency, "server_observed": o.summary(), "timings": d.Timings, "metrics": app.Simulator.Snapshot().Metrics, "engine_stats": engine.Stats(), "limitations": "planning includes initial preparation and reservation reconciliation; publication includes initialization; turn includes internal HTTP/diagnostics; engine_next_step includes cache-key calculation and plan selection, not only a map read"}, nil
	}
	var dynamic map[string]any
	if *stableAfter > 0 {
		dynamic, err = runSimulation(*stableAfter)
		if err != nil {
			return err
		}
	}
	w := app.Simulator.Snapshot()
	active := []world.Survivor{}
	for _, s := range w.Survivors {
		if s.Status == world.Active {
			active = append(active, s)
		}
	}
	if len(active) == 0 {
		return errors.New("no active survivors")
	}
	for _, s := range active {
		if _, err = client.NextStep(context.Background(), world.StepRequest{SurvivorID: s.ID, CurrentNode: s.CurrentNode, Turn: w.Turn}); err != nil {
			return errors.New("HTTP warmup failed")
		}
	}
	snapshotTimes, decisionTimes := make([]time.Duration, *count), make([]time.Duration, *count)
	for i := 0; i < *count; i++ {
		start := time.Now()
		_, ready := app.Store.Load()
		snapshotTimes[i] = time.Since(start)
		if !ready {
			return errors.New("snapshot unavailable")
		}
	}
	for i := 0; i < *count; i++ {
		s := active[i%len(active)]
		start := time.Now()
		result := engine.NextStep(context.Background(), w, s)
		decisionTimes[i] = time.Since(start)
		if result.NextNode == "" {
			return errors.New("empty direct decision")
		}
	}
	o.reset()
	httpTimes := make([]time.Duration, *count)
	errs := make([]error, *count)
	jobs := make(chan int)
	var wg sync.WaitGroup
	for n := 0; n < *workers; n++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range jobs {
				s := active[i%len(active)]
				start := time.Now()
				_, errs[i] = client.NextStep(context.Background(), world.StepRequest{SurvivorID: s.ID, CurrentNode: s.CurrentNode, Turn: w.Turn})
				httpTimes[i] = time.Since(start)
			}
		}()
	}
	for i := 0; i < *count; i++ {
		jobs <- i
	}
	close(jobs)
	wg.Wait()
	failures := 0
	for _, e := range errs {
		if e != nil {
			failures++
		}
	}
	report := map[string]any{"recorded_at": time.Now().UTC().Format(time.RFC3339Nano), "phase": "3B.1", "scope": "offline process; no AWS calls and no live-service restart", "go": runtime.Version(), "os": runtime.GOOS, "arch": runtime.GOARCH, "gomaxprocs": runtime.GOMAXPROCS(0), "scenario": cfg.Name, "seed": cfg.Seed, "nodes": len(g.Nodes), "edges": len(g.Edges), "survivors": len(active), "survivors_total": len(w.Survivors), "concurrency": *workers, "simulation_concurrency": cfg.Concurrency, "stable_after_turns": *stableAfter, "requests": *count, "http_failures": failures, "stable_snapshot": map[string]any{"turn": w.Turn, "world_version": w.WorldVersion, "active": len(active), "direct_snapshot_clone": diagnostics.Measure(snapshotTimes), "direct_engine_next_step": diagnostics.Measure(decisionTimes), "server_observed": o.summary(), "loopback_http": diagnostics.Measure(httpTimes)}, "engine_stats": engine.Stats(), "instrumentation": "existing in-process Observe and simulator diagnostics; no OTel/exporter; durations in existing diagnostic milliseconds; no private initial positions exported"}
	if *turns > 0 {
		dynamic, err = runSimulation(*turns)
		if err != nil {
			return err
		}
	}
	if dynamic != nil {
		report["dynamic_simulation"] = dynamic
	}
	b, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(*output), 0700); err != nil {
		return err
	}
	if err = os.WriteFile(*output, append(b, '\n'), 0600); err != nil {
		return err
	}
	if err = os.Chmod(*output, 0600); err != nil {
		return err
	}
	fmt.Println(string(b))
	if failures > 0 {
		return errors.New("HTTP benchmark has failures; inspect report")
	}
	return nil
}
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "internal diagnostic failed:", err)
		os.Exit(1)
	}
}
