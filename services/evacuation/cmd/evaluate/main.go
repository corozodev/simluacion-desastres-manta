package main

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"

	"corodev/evacuation/internal/coordination"
	"corodev/evacuation/internal/decision"
	"corodev/evacuation/internal/evaluation"
	"corodev/evacuation/internal/evaluation/phase1"
	"corodev/evacuation/internal/graph"
	"corodev/evacuation/internal/simulation"
	"corodev/evacuation/internal/world"
)

func writeJSON(path string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0600)
}

func strategy(name string, options decision.Options) (world.DecisionEngine, world.TurnPlanner, error) {
	switch name {
	case "phase1":
		return phase1.New(), nil, nil
	case "improved", "no-prediction", "no-reservations", "no-prediction-no-reservations":
		options.Prediction = name != "no-prediction" && name != "no-prediction-no-reservations"
		engine := decision.NewWithOptions(options)
		if name == "no-reservations" || name == "no-prediction-no-reservations" {
			return engine, nil, nil
		}
		return engine, coordination.New(engine, coordination.Options{Stickiness: options.Stickiness}), nil
	default:
		return nil, nil, fmt.Errorf("unknown strategy %q", name)
	}
}

func run() error {
	sourcePath := flag.String("source", "data/manta-v1.json", "source graph for geographic replay")
	graphPaths := flag.String("graphs", "data/manta-v1.json", "comma-separated target graphs")
	strategies := flag.String("strategies", "phase1", "comma-separated strategies")
	seedList := flag.String("seeds", "historical,7,42", "predeclared seed battery; historical uses each round's seed")
	roundList := flag.String("rounds", "1,2,3", "rounds")
	protocol := flag.String("protocol", "geography", "geography: fixed source positions+refuges; urban: zone scenarios on target graph")
	output := flag.String("output", "reports/phase2/comparison", "private offline report directory")
	riskWeight := flag.Float64("risk-weight", .6, "visible-risk weight")
	predictionWeight := flag.Float64("prediction-weight", 12, "future-risk weight")
	flag.Parse()
	if *protocol != "geography" && *protocol != "urban" {
		return fmt.Errorf("protocol must be geography or urban")
	}
	source, err := graph.Load(*sourcePath)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(*output, 0755); err != nil {
		return err
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	results := []evaluation.Result{}
	for _, targetPath := range strings.Split(*graphPaths, ",") {
		target, err := graph.Load(strings.TrimSpace(targetPath))
		if err != nil {
			return err
		}
		for _, roundText := range strings.Split(*roundList, ",") {
			round, err := strconv.Atoi(roundText)
			if err != nil || round < 1 || round > 3 {
				return fmt.Errorf("invalid round")
			}
			configPath := fmt.Sprintf("scenarios/round%d.json", round)
			if *protocol == "urban" {
				configPath = fmt.Sprintf("scenarios/urban/round%d.json", round)
			}
			original, err := simulation.LoadConfig(configPath)
			if err != nil {
				return err
			}
			for _, seedText := range strings.Split(*seedList, ",") {
				cfg := original
				if seedText != "historical" {
					cfg.Seed, err = strconv.ParseInt(seedText, 10, 64)
					if err != nil {
						return err
					}
				}
				g := target
				var remaps []evaluation.Remapping
				if *protocol == "geography" {
					initial, err := evaluation.Capture(source, cfg)
					if err != nil {
						return err
					}
					g, cfg, remaps, err = evaluation.Replay(source, target, cfg, initial)
					if err != nil {
						return err
					}
				}
				for _, name := range strings.Split(*strategies, ",") {
					options := decision.Options{Prediction: name != "no-prediction" && name != "no-prediction-no-reservations", RiskWeight: *riskWeight, PredictionWeight: *predictionWeight, Horizon: 2, Stickiness: .15}
					engine, planner, err := strategy(name, options)
					if err != nil {
						return err
					}
					result, err := evaluation.Run(ctx, g, cfg, *protocol, name, engine, planner)
					if err != nil {
						return err
					}
					result.Remapping = remaps
					if name != "phase1" {
						result.AlgorithmOptions = &options
					}
					results = append(results, result)
					filename := fmt.Sprintf("%s-round%d-seed%d-%s.json", strings.TrimSuffix(filepath.Base(targetPath), ".json"), round, cfg.Seed, name)
					if err := writeJSON(filepath.Join(*output, filename), result); err != nil {
						return err
					}
					fmt.Printf("%s %s round%d seed%d: evacuated=%d bitten=%d active=%d alive=%.1f%% p95=%.3fms errors=%d timeout=%d\n", *protocol, name, round, cfg.Seed, result.Metrics.Evacuated, result.Metrics.Bitten, result.Metrics.Active, result.AliveRatio*100, result.Metrics.HTTPP95MS, result.Metrics.RequestsInvalid, result.Metrics.RequestsTimeout)
				}
			}
		}
	}
	if err := writeJSON(filepath.Join(*output, "results.json"), results); err != nil {
		return err
	}
	f, err := os.Create(filepath.Join(*output, "results.csv"))
	if err != nil {
		return err
	}
	defer f.Close()
	writer := csv.NewWriter(f)
	_ = writer.Write([]string{"experiment", "strategy", "scenario", "seed", "graph_version", "nodes", "edges", "evacuated", "bitten", "active", "alive_ratio", "stationary_turns", "no_route_turns", "mean_evacuation_turn", "mean_route_efficiency", "http_p50_ms", "http_p95_ms", "http_p99_ms", "availability", "invalid", "timeout", "planning_p95_ms", "snapshot_p95_ms", "decision_p95_ms", "turn_p95_ms", "initial_state_sha256"})
	for _, r := range results {
		m, d := r.Metrics, r.Diagnostics
		_ = writer.Write([]string{r.Experiment, r.Strategy, r.Scenario, strconv.FormatInt(r.Seed, 10), r.GraphVersion, strconv.Itoa(r.Nodes), strconv.Itoa(r.Edges), strconv.Itoa(m.Evacuated), strconv.Itoa(m.Bitten), strconv.Itoa(m.Active), fmt.Sprint(r.AliveRatio), strconv.Itoa(d.Summary.StationaryTurns), strconv.Itoa(d.Summary.NoRouteTurns), fmt.Sprint(d.Summary.MeanEvacuationTurn), fmt.Sprint(d.Summary.MeanRouteEfficiency), fmt.Sprint(m.HTTPP50MS), fmt.Sprint(m.HTTPP95MS), fmt.Sprint(m.HTTPP99MS), fmt.Sprint(m.Availability), strconv.Itoa(m.RequestsInvalid), strconv.Itoa(m.RequestsTimeout), fmt.Sprint(d.Timings.Planning.P95MS), fmt.Sprint(r.ServerTimings.Snapshot.P95MS), fmt.Sprint(r.ServerTimings.Decision.P95MS), fmt.Sprint(d.Timings.Turn.P95MS), r.InitialStateSHA256})
	}
	writer.Flush()
	return writer.Error()
}
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
