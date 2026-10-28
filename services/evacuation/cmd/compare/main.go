// compare is an explicit offline experiment, never an API startup action.
package main

import (
	"context"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"

	"corodev/evacuation/internal/coordination"
	"corodev/evacuation/internal/decision"
	"corodev/evacuation/internal/evaluation"
	"corodev/evacuation/internal/graph"
	"corodev/evacuation/internal/sessions"
	"corodev/evacuation/internal/simulation"
	"corodev/evacuation/internal/world"
)

type result struct {
	Round             string                       `json:"round"`
	Algorithm         string                       `json:"algorithm"`
	Policy            string                       `json:"zombie_policy"`
	Seed              int64                        `json:"seed"`
	Repeat            int                          `json:"repeat"`
	Config            simulation.Config            `json:"config"`
	InitialHash       string                       `json:"initial_hash"`
	OutcomeHash       string                       `json:"outcome_hash"`
	GraphHash         string                       `json:"graph_hash"`
	Metrics           world.Metrics                `json:"metrics"`
	Analytics         *sessions.Analytics          `json:"analytics"`
	Prediction        *evaluation.ProbabilityAudit `json:"prediction"`
	Fleet             *world.RescueFleetMetrics    `json:"fleet,omitempty"`
	SheltersFull      int                          `json:"shelters_full"`
	ShelterReserved   int                          `json:"shelter_reserved"`
	ShelterUnoccupied int                          `json:"shelter_unoccupied"`
	ElapsedMS         float64                      `json:"elapsed_ms"`
	CPUUserMS         float64                      `json:"cpu_user_ms"`
	CPUSystemMS       float64                      `json:"cpu_system_ms"`
	ProcessMaxRSSKiB  int64                        `json:"process_max_rss_kib"`
	HeapAllocBytes    uint64                       `json:"heap_alloc_bytes"`
}

func hash(v any) string {
	b, _ := json.Marshal(v)
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}
func cpu() syscall.Rusage {
	var r syscall.Rusage
	_ = syscall.Getrusage(syscall.RUSAGE_SELF, &r)
	return r
}
func ms(t syscall.Timeval) float64 { return float64(t.Sec)*1000 + float64(t.Usec)/1000 }
func writeJSON(path string, v any) error {
	b, e := json.MarshalIndent(v, "", "  ")
	if e != nil {
		return e
	}
	if e = os.MkdirAll(filepath.Dir(path), 0755); e != nil {
		return e
	}
	return os.WriteFile(path, append(b, '\n'), 0600)
}
func writeCSV(path string, rows []result) error {
	f, e := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600)
	if e != nil {
		return e
	}
	defer f.Close()
	w := csv.NewWriter(f)
	if e = w.Write([]string{"round", "algorithm", "zombie_policy", "seed", "repeat", "initial_hash", "outcome_hash", "evacuated", "bitten", "active", "p50_ms", "p95_ms", "p99_ms", "invalid", "timeouts", "replans", "oscillations", "arrival_turn", "route_efficiency", "prediction_hits", "prediction_misses", "prediction_false_positives", "brier", "fleet_delivered", "shelters_full", "shelter_unoccupied", "cpu_user_ms", "cpu_system_ms", "max_rss_kib", "elapsed_ms"}); e != nil {
		return e
	}
	for _, r := range rows {
		fleet := 0
		if r.Fleet != nil {
			fleet = r.Fleet.Delivered
		}
		p := r.Prediction
		values := []any{r.Round, r.Algorithm, r.Policy, r.Seed, r.Repeat, r.InitialHash, r.OutcomeHash, r.Metrics.Evacuated, r.Metrics.Bitten, r.Metrics.Active, r.Metrics.HTTPP50MS, r.Metrics.HTTPP95MS, r.Metrics.HTTPP99MS, r.Metrics.RequestsInvalid, r.Metrics.RequestsTimeout, r.Analytics.Replans, r.Analytics.Oscillations, r.Analytics.MeanArrivalTurn, r.Analytics.MeanRouteEfficiency, p.Hits, p.Misses, p.FalsePositives, p.BrierScore, fleet, r.SheltersFull, r.ShelterUnoccupied, r.CPUUserMS, r.CPUSystemMS, r.ProcessMaxRSSKiB, r.ElapsedMS}
		cells := make([]string, len(values))
		for i, v := range values {
			cells[i] = fmt.Sprint(v)
		}
		if e = w.Write(cells); e != nil {
			return e
		}
	}
	w.Flush()
	return w.Error()
}
func run() error {
	trackA := flag.Bool("track-a", false, "frozen 36-run zombie experiment with per-run checkpoints; output is a directory")
	trackANoFleet := flag.Bool("track-a-r3-no-fleet", false, "18 paired R3 controls cloned from the original experiment, changing only rescue fleet")
	reference := flag.String("reference", "../../reports/track-a-evidence", "original frozen Track A evidence directory")
	graphPath := flag.String("graph", "data/manta-v2.json", "checked-in graph")
	rounds := flag.String("rounds", "1,2,3", "round numbers")
	algorithms := flag.String("algorithms", "legacy_current,baseline_shortest_path,dynamic_risk_astar,predictive_temporal_astar", "at least two policies for explicit comparison")
	policy := flag.String("zombie-policy", "classic_random", "movement policy")
	mode := flag.String("mode", "official", "official or experimental")
	seeds := flag.String("seeds", "7,42", "reproducible seeds")
	repeats := flag.Int("repeats", 2, "independent repeat count; compare logical outcomes")
	fleet := flag.Bool("fleet", false, "experimental rescue fleet")
	prediction := flag.Bool("prediction", true, "runner prediction")
	assignment := flag.Bool("assignment", true, "global shelter assignment")
	realtime := flag.Bool("realtime", false, "pace each 150-turn scenario at two seconds; otherwise accelerated real HTTP")
	output := flag.String("output", "reports/phase7/comparison", "JSON and CSV prefix")
	flag.Parse()
	if *trackA && *trackANoFleet {
		return fmt.Errorf("select one experiment mode")
	}
	if *trackANoFleet {
		return runTrackAR3NoFleet(*output, *reference)
	}
	if *trackA {
		return runTrackA(*output)
	}
	algos := strings.Split(*algorithms, ",")
	if len(algos) < 2 || *repeats < 1 || *repeats > 10 {
		return fmt.Errorf("comparison requires >=2 algorithms and repeats in 1..10")
	}
	seenAlgorithms := map[string]bool{}
	for _, a := range algos {
		if a == "" || seenAlgorithms[a] {
			return fmt.Errorf("comparison requires distinct named algorithms")
		}
		seenAlgorithms[a] = true
		if !decision.ValidAlgorithm(a) {
			return fmt.Errorf("unknown algorithm %s", a)
		}
	}
	if *mode != "official" && *mode != "experimental" {
		return fmt.Errorf("invalid mode")
	}
	if *policy != "classic_random" && *policy != "correlated_random_walk" && *policy != "adaptive_exploration" {
		return fmt.Errorf("unknown zombie policy")
	}
	if *mode == "official" && (*policy != "classic_random" || *fleet || *graphPath != "data/manta-v2.json") {
		return fmt.Errorf("official comparison requires BASE, classic_random and no experimental fleet")
	}
	g, e := graph.Load(*graphPath)
	if e != nil {
		return e
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	interval := time.Duration(0)
	if *realtime {
		interval = 2 * time.Second
	}
	rows := []result{}
	initials := map[string]string{}
	outcomes := map[string]string{}
	for _, round := range strings.Split(*rounds, ",") {
		if round != "1" && round != "2" && round != "3" {
			return fmt.Errorf("unknown round")
		}
		for _, rawSeed := range strings.Split(*seeds, ",") {
			seed, err := strconv.ParseInt(rawSeed, 10, 64)
			if err != nil {
				return err
			}
			for _, algorithm := range algos {
				for repeat := 1; repeat <= *repeats; repeat++ {
					cfg, err := simulation.LoadConfig("scenarios/urban/round" + round + ".json")
					if err != nil {
						return err
					}
					cfg.Seed = seed
					cfg.ZombiePolicy = *policy
					cfg.RescueFleet = *fleet
					options := decision.Options{Algorithm: algorithm, Prediction: *prediction}
					engine := decision.NewWithOptions(options)
					planner := coordination.New(engine, coordination.Options{DisableAssignment: !*assignment})
					before := cpu()
					r, err := evaluation.RunWithInterval(ctx, g, cfg, "phase7_"+*mode, algorithm, engine, planner, interval)
					after := cpu()
					if err != nil {
						return err
					}
					a := sessions.PublicAnalytics(r.Diagnostics)
					if p := r.ProbabilityAudit; p != nil {
						a.Prediction = sessions.PredictionQuality{Samples: p.Samples, Hits: p.Hits, Misses: p.Misses, FalsePositives: p.FalsePositives, BrierScore: p.BrierScore}
					}
					var mem runtime.MemStats
					runtime.ReadMemStats(&mem)

					out := result{Round: round, Algorithm: algorithm, Policy: *policy, Seed: seed, Repeat: repeat, Config: cfg, InitialHash: r.InitialStateSHA256, OutcomeHash: r.LogicalSHA256, GraphHash: r.GraphSHA256, Metrics: r.Metrics, Analytics: a, Prediction: r.ProbabilityAudit, Fleet: r.FleetMetrics, SheltersFull: r.Diagnostics.Summary.SheltersFull, ShelterReserved: r.Diagnostics.Summary.ShelterReserved, ShelterUnoccupied: r.Diagnostics.Summary.ShelterUnoccupiedCapacity, ElapsedMS: r.ElapsedMS, CPUUserMS: ms(after.Utime) - ms(before.Utime), CPUSystemMS: ms(after.Stime) - ms(before.Stime), ProcessMaxRSSKiB: after.Maxrss, HeapAllocBytes: mem.HeapAlloc}
					group := round + "/" + rawSeed
					if h, ok := initials[group]; ok && h != out.InitialHash {
						return fmt.Errorf("initial state mismatch %s", group)
					}
					initials[group] = out.InitialHash
					key := group + "/" + algorithm
					if h, ok := outcomes[key]; ok && h != out.OutcomeHash {
						return fmt.Errorf("logical repeat mismatch %s", key)
					}
					outcomes[key] = out.OutcomeHash
					if out.Metrics.RequestsInvalid > 0 || out.Metrics.RequestsTimeout > 0 {
						return fmt.Errorf("HTTP failures %s", key)
					}
					rows = append(rows, out)
					fmt.Printf("R%s seed=%d %s repeat=%d evacuated=%d bitten=%d p95=%.3fms\n", round, seed, algorithm, repeat, out.Metrics.Evacuated, out.Metrics.Bitten, out.Metrics.HTTPP95MS)
				}
			}
		}
	}
	meminfo, _ := os.ReadFile("/proc/meminfo")
	cgroupCPU, _ := os.ReadFile("/sys/fs/cgroup/cpu.max")
	cgroupMem, _ := os.ReadFile("/sys/fs/cgroup/memory.max")
	report := map[string]any{"mode": *mode, "accelerated": !*realtime, "nominal_turn_interval_ms": 2000, "actual_http": true, "methodology": "Independent seeded engines; identical graph/initial hash/refuges/events within each round and seed; real authenticated loopback POST /paso; 400ms client timeout; nearest-rank latency; process CPU deltas and cumulative process RSS highwater; timing excluded from logical hashes. Official means rules/pacing preset, zombie counts and refuges remain editable fixtures, not jury data.", "environment": map[string]any{"go": runtime.Version(), "os": runtime.GOOS, "arch": runtime.GOARCH, "num_cpu": runtime.NumCPU(), "gomaxprocs": runtime.GOMAXPROCS(0), "proc_meminfo": string(meminfo), "cgroup_cpu_max": strings.TrimSpace(string(cgroupCPU)), "cgroup_memory_max": strings.TrimSpace(string(cgroupMem))}, "runner_prediction": *prediction, "shelter_assignment": *assignment, "rescue_fleet": *fleet, "graph_path": *graphPath, "graph_hash": hash(g), "logical_repeats_verified": *repeats > 1, "results": rows}
	if e = writeJSON(*output+".json", report); e != nil {
		return e
	}
	return writeCSV(*output+".csv", rows)
}
func main() {
	if e := run(); e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
}
