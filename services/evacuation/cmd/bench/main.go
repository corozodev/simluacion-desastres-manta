package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"math"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"sync"
	"time"

	"corodev/evacuation/internal/application"
	"corodev/evacuation/internal/graph"
	"corodev/evacuation/internal/simulation"
	"corodev/evacuation/internal/world"
)

type measurement struct {
	elapsed time.Duration
	err     error
	valid   bool
}

func run() error {
	graphPath := flag.String("graph", "data/manta-v2.json", "offline graph")
	scenarioPath := flag.String("scenario", "scenarios/urban/round3.json", "initial observable world")
	count := flag.Int("requests", 10000, "measured HTTP requests")
	workers := flag.Int("concurrency", 16, "bounded concurrent requests")
	burst := flag.Bool("burst", false, "synchronize each batch of concurrent requests behind a barrier")
	output := flag.String("output", "", "JSON report path")
	flag.Parse()
	if *count < 1 || *workers < 1 || *workers > 200 {
		return fmt.Errorf("requests must be positive; concurrency between 1 and 200")
	}
	g, err := graph.Load(*graphPath)
	if err != nil {
		return err
	}
	index, err := graph.New(g)
	if err != nil {
		return err
	}
	cfg, err := simulation.LoadConfig(*scenarioPath)
	if err != nil {
		return err
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
	client, err := simulation.NewHTTPDecisionClient(app.BaseURL, key, 500*time.Millisecond)
	if err != nil {
		return err
	}
	defer client.CloseIdleConnections()
	w := app.Simulator.Snapshot()
	active := []world.Survivor{}
	for _, s := range w.Survivors {
		if s.Status == world.Active {
			active = append(active, s)
		}
	}
	if len(active) == 0 {
		return fmt.Errorf("benchmark requires active survivors")
	}
	blocked := map[string]bool{}
	for _, id := range w.BlockedEdges {
		blocked[id] = true
	}
	// Warm up all survivor starting positions. This is an unchanged snapshot
	// workload; dynamic invalidation is measured by the full scenario commands.
	for _, s := range active {
		if _, err := client.NextStep(context.Background(), world.StepRequest{SurvivorID: s.ID, CurrentNode: s.CurrentNode, Turn: w.Turn}); err != nil {
			return fmt.Errorf("warmup failed: %w", err)
		}
	}
	results := make([]measurement, *count)
	started := time.Now()
	requestOne := func(i int) {
		s := active[i%len(active)]
		start := time.Now()
		response, err := client.NextStep(context.Background(), world.StepRequest{SurvivorID: s.ID, CurrentNode: s.CurrentNode, Turn: w.Turn})
		results[i] = measurement{elapsed: time.Since(start), err: err, valid: err == nil && index.CanMove(s.CurrentNode, response.NextNode, blocked)}
	}
	if *burst {
		for batch := 0; batch < *count; batch += *workers {
			begin := make(chan struct{})
			var ready, done sync.WaitGroup
			end := batch + *workers
			if end > *count {
				end = *count
			}
			for i := batch; i < end; i++ {
				ready.Add(1)
				done.Add(1)
				go func(i int) { defer done.Done(); ready.Done(); <-begin; requestOne(i) }(i)
			}
			ready.Wait()
			close(begin)
			done.Wait()
		}
	} else {
		jobs := make(chan int)
		var wg sync.WaitGroup
		for n := 0; n < *workers; n++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				for i := range jobs {
					requestOne(i)
				}
			}()
		}
		for i := 0; i < *count; i++ {
			jobs <- i
		}
		close(jobs)
		wg.Wait()
	}
	elapsed := time.Since(started)
	latencies := make([]time.Duration, len(results))
	success, invalid, timedOut := 0, 0, 0
	for i, r := range results {
		latencies[i] = r.elapsed
		var netErr net.Error
		if errors.Is(r.err, context.DeadlineExceeded) || (errors.As(r.err, &netErr) && netErr.Timeout()) || r.elapsed > 500*time.Millisecond {
			timedOut++
		} else if r.valid {
			success++
		} else {
			invalid++
		}
	}
	sort.Slice(latencies, func(i, j int) bool { return latencies[i] < latencies[j] })
	percentile := func(p float64) float64 {
		return float64(latencies[int(math.Ceil(p*float64(len(latencies))))-1]) / float64(time.Millisecond)
	}
	result := map[string]any{"methodology": "real loopback HTTP /paso; initial unchanged observable snapshot; one warmup per active survivor; latency includes transport and decoding; nearest-rank percentiles; full scenarios measure invalidation separately", "scenario": cfg.Name, "seed": cfg.Seed, "go": runtime.Version(), "os": runtime.GOOS, "arch": runtime.GOARCH, "gomaxprocs": runtime.GOMAXPROCS(0), "nodes": len(g.Nodes), "edges": len(g.Edges), "survivors": len(active), "concurrency": *workers, "requests": *count, "requests_success": success, "requests_invalid": invalid, "requests_timeout": timedOut, "availability": float64(success) / float64(*count), "elapsed_ms": float64(elapsed) / float64(time.Millisecond), "requests_per_second": float64(*count) / elapsed.Seconds(), "http_p50_ms": percentile(.5), "http_p95_ms": percentile(.95), "http_p99_ms": percentile(.99), "http_max_ms": percentile(1)}
	result["synchronized_bursts"] = *burst
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
	if success != *count {
		return fmt.Errorf("benchmark had %d invalid and %d timeout requests", invalid, timedOut)
	}
	return nil
}
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
