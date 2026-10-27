// Command multigraph-bench measures reviewed presets in an isolated process.
// It never contacts AWS, changes a running service or exports hidden spawns.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"sync"
	"syscall"
	"time"

	"corodev/evacuation/internal/application"
	"corodev/evacuation/internal/catalog"
	"corodev/evacuation/internal/diagnostics"
	"corodev/evacuation/internal/graph"
	"corodev/evacuation/internal/simulation"
	"corodev/evacuation/internal/world"
)

func usage() syscall.Rusage {
	var r syscall.Rusage
	_ = syscall.Getrusage(syscall.RUSAGE_SELF, &r)
	return r
}
func cpu(r syscall.Rusage) float64 {
	return float64(r.Utime.Sec+r.Stime.Sec) + float64(r.Utime.Usec+r.Stime.Usec)/1e6
}
func run() error {
	mode := flag.String("mode", "competition", "approved graph preset")
	round := flag.String("round", "round3", "approved round")
	phase := flag.String("phase", "round", "round or http")
	interval := flag.Duration("interval", 2*time.Second, "round pacing, 0 is explicitly accelerated")
	workers := flag.Int("workers", 200, "HTTP stress concurrency")
	count := flag.Int("requests", 1000, "HTTP stress requests")
	output := flag.String("output", "", "private summary JSON")
	flag.Parse()
	if *output == "" || *interval < 0 || *workers < 1 || *workers > 200 || *count < 200 || *count > 10000 || (*phase != "round" && *phase != "http") {
		return errors.New("invalid bounded benchmark settings")
	}
	initialUsage := usage()
	started := time.Now()
	c, err := catalog.New("data", "scenarios/urban", catalog.Options{EnableFull: true, EnableExpanded: true, Concurrency: 16})
	if err != nil {
		return err
	}
	g, err := c.Graph(*mode)
	if err != nil {
		return err
	}
	cfg, err := c.Config(*mode, *round, nil)
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
	report := map[string]any{"recorded_at": time.Now().UTC().Format(time.RFC3339Nano), "phase": "3B.2", "measurement": *phase, "mode": *mode, "round": *round, "graph_version": g.Version, "nodes": len(g.Nodes), "edges": len(g.Edges), "seed": cfg.Seed, "survivors": cfg.Survivors, "turn_limit": cfg.Turns, "simulation_concurrency": cfg.Concurrency, "go": runtime.Version(), "gomaxprocs": runtime.GOMAXPROCS(0), "os": runtime.GOOS, "arch": runtime.GOARCH, "production_touched": false, "events": cfg.Events}
	failed := false
	if *phase == "round" {
		runStart := time.Now()
		err = app.Simulator.Run(context.Background(), cfg.Turns, *interval)
		elapsed := time.Since(runStart)
		if err != nil {
			return err
		}
		state := app.Simulator.Snapshot()
		d := app.Simulator.Diagnostics()
		report["interval"] = interval.String()
		report["round_elapsed_ms"] = float64(elapsed) / float64(time.Millisecond)
		report["metrics"] = state.Metrics
		report["summary"] = d.Summary
		report["timings"] = d.Timings
		report["failures"] = d.Failures
		report["accelerated"] = *interval == 0
		failed = state.Metrics.RequestsInvalid+state.Metrics.RequestsTimeout > 0
	} else {
		idx, err := graph.New(g)
		if err != nil {
			return err
		}
		client, err := simulation.NewHTTPDecisionClient(app.BaseURL, key, 500*time.Millisecond)
		if err != nil {
			return err
		}
		defer client.CloseIdleConnections()
		state := app.Simulator.Snapshot()
		active := []world.Survivor{}
		for _, s := range state.Survivors {
			if s.Status == world.Active {
				active = append(active, s)
			}
		}
		if len(active) != cfg.Survivors {
			return errors.New("initial population not ready")
		}
		for _, s := range active {
			if _, err := client.NextStep(context.Background(), world.StepRequest{SurvivorID: s.ID, CurrentNode: s.CurrentNode, Turn: state.Turn}); err != nil {
				return errors.New("warmup failed")
			}
		}
		type measurement struct {
			elapsed time.Duration
			err     error
			valid   bool
		}
		results := make([]measurement, *count)
		jobs := make(chan int)
		var wg sync.WaitGroup
		begin := time.Now()
		for n := 0; n < *workers; n++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				for i := range jobs {
					s := active[i%len(active)]
					start := time.Now()
					out, err := client.NextStep(context.Background(), world.StepRequest{SurvivorID: s.ID, CurrentNode: s.CurrentNode, Turn: state.Turn})
					results[i] = measurement{time.Since(start), err, err == nil && idx.CanMove(s.CurrentNode, out.NextNode, nil)}
				}
			}()
		}
		for i := 0; i < *count; i++ {
			jobs <- i
		}
		close(jobs)
		wg.Wait()
		elapsed := time.Since(begin)
		latencies := make([]time.Duration, len(results))
		success, invalid, timeouts, over500 := 0, 0, 0, 0
		for i, r := range results {
			latencies[i] = r.elapsed
			var ne net.Error
			if r.elapsed >= 500*time.Millisecond {
				over500++
			}
			if errors.Is(r.err, context.DeadlineExceeded) || errors.As(r.err, &ne) && ne.Timeout() {
				timeouts++
			} else if r.valid {
				success++
			} else {
				invalid++
			}
		}
		sort.Slice(latencies, func(i, j int) bool { return latencies[i] < latencies[j] })
		timing := diagnostics.Measure(latencies)
		failureRate := float64(invalid+timeouts) / float64(*count)
		report["http"] = map[string]any{"method": "real authenticated loopback HTTP /paso; stable initial snapshot; 200 survivors for round3; persistent HTTP; nearest-rank over ALL attempts", "requests": *count, "workers": *workers, "success": success, "invalid": invalid, "timeouts": timeouts, "over_500ms": over500, "failure_rate": failureRate, "latency": timing, "max_ms": float64(latencies[len(latencies)-1]) / float64(time.Millisecond), "elapsed_ms": float64(elapsed) / float64(time.Millisecond), "p95_target_met": timing.P95MS <= 150, "individual_target_met": over500 == 0, "error_target_met": failureRate < .005}
		failed = timing.P95MS > 150 || over500 > 0 || failureRate >= .005
	}
	finalUsage := usage()
	wall := time.Since(started).Seconds()
	report["resource_usage"] = map[string]any{"wall_seconds": wall, "process_cpu_seconds": cpu(finalUsage) - cpu(initialUsage), "average_cpu_one_core_percent": (cpu(finalUsage) - cpu(initialUsage)) / wall * 100, "peak_rss_kib_linux": finalUsage.Maxrss, "note": "Process measurement including catalog load/initialization; Linux ru_maxrss is KiB. CPU percentage is of one core; no network-AWS latency claimed."}
	if raw, err := os.ReadFile("/sys/fs/cgroup/memory.peak"); err == nil {
		report["cgroup_memory_peak_bytes_text"] = string(raw)
	}
	report["targets_met"] = !failed
	raw, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(*output), 0700); err != nil {
		return err
	}
	if err = os.WriteFile(*output, append(raw, '\n'), 0600); err != nil {
		return err
	}
	fmt.Println(string(raw))
	if failed {
		return errors.New("measured targets failed; preserve report and keep experimental activation disabled")
	}
	return nil
}
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
