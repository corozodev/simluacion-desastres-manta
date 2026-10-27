// Package evaluation runs controlled, offline experiments through real HTTP.
// Private initial zombie positions are written only to explicitly local reports.
package evaluation

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"sync"
	"time"

	"corodev/evacuation/internal/application"
	"corodev/evacuation/internal/coordination"
	"corodev/evacuation/internal/decision"
	"corodev/evacuation/internal/diagnostics"
	"corodev/evacuation/internal/evaluation/phase1"
	"corodev/evacuation/internal/httpapi"
	"corodev/evacuation/internal/simulation"
	"corodev/evacuation/internal/world"
)

type ServerTimings struct {
	Snapshot diagnostics.Timing `json:"snapshot"`
	Decision diagnostics.Timing `json:"decision"`
	Handler  diagnostics.Timing `json:"handler"`
}
type Result struct {
	LogicalSHA256      string                    `json:"logical_sha256,omitempty"`
	FleetMetrics       *world.RescueFleetMetrics `json:"fleet_metrics,omitempty"`
	ProbabilityAudit   *ProbabilityAudit         `json:"probability_audit,omitempty"`
	Experiment         string                    `json:"experiment"`
	Strategy           string                    `json:"strategy"`
	Scenario           string                    `json:"scenario"`
	Seed               int64                     `json:"seed"`
	GraphVersion       string                    `json:"graph_version"`
	Nodes              int                       `json:"nodes"`
	Edges              int                       `json:"edges"`
	InitialStateSHA256 string                    `json:"initial_state_sha256"`
	GraphSHA256        string                    `json:"graph_sha256"`
	Config             simulation.Config         `json:"config"`
	Metrics            world.Metrics             `json:"metrics"`
	EvacuatedRatio     float64                   `json:"evacuated_ratio"`
	AliveRatio         float64                   `json:"alive_ratio"`
	BittenRatio        float64                   `json:"bitten_ratio"`
	ElapsedMS          float64                   `json:"elapsed_ms"`
	Diagnostics        diagnostics.Report        `json:"diagnostics"`
	ServerTimings      ServerTimings             `json:"server_timings"`
	Remapping          []Remapping               `json:"remapping,omitempty"`
	PredictionAudit    *PredictionAudit          `json:"prediction_audit,omitempty"`
	EngineStats        *decision.EngineStats     `json:"engine_stats,omitempty"`
	CoordinationStats  *coordination.Statistics  `json:"coordination_stats,omitempty"`
	AlgorithmOptions   *decision.Options         `json:"algorithm_options,omitempty"`
}

// FalsePositiveCandidates counts possible next-turn runner nodes not occupied
// at the next observation. A reachability envelope is not a calibrated claim
// that all candidate nodes will be occupied simultaneously.
type PredictionAudit struct {
	Turns                   int `json:"turns"`
	CandidateNodes          int `json:"candidate_nodes"`
	ActualRunnerNodes       int `json:"actual_runner_nodes"`
	CoveredActualNodes      int `json:"covered_actual_nodes"`
	MissedActualNodes       int `json:"missed_actual_nodes"`
	FalsePositiveCandidates int `json:"false_positive_candidates"`
}

func hash(value any) string {
	data, _ := json.Marshal(value)
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func Capture(g *world.Graph, cfg simulation.Config) (diagnostics.Report, error) {
	key, err := application.EphemeralKey()
	if err != nil {
		return diagnostics.Report{}, err
	}
	app, err := application.NewWithOptions(g, cfg, "127.0.0.1:0", key, nil, nil, application.Options{Engine: phase1.New()})
	if err != nil {
		return diagnostics.Report{}, err
	}
	defer app.Close()
	return app.Simulator.Diagnostics(), nil
}

func Run(ctx context.Context, g *world.Graph, cfg simulation.Config, experiment, strategy string, engine world.DecisionEngine, planner world.TurnPlanner) (Result, error) {
	return RunWithInterval(ctx, g, cfg, experiment, strategy, engine, planner, 0)
}

// RunWithInterval distinguishes accelerated actual HTTP from nominal two-second
// pacing. Both modes execute the same single-writer turns and authenticated API.
func RunWithInterval(ctx context.Context, g *world.Graph, cfg simulation.Config, experiment, strategy string, engine world.DecisionEngine, planner world.TurnPlanner, interval time.Duration) (Result, error) {
	var mu sync.Mutex
	var snapshotTimes, decisionTimes, handlerTimes []time.Duration
	observe := func(t httpapi.RequestTiming) {
		if t.Path != "/paso" {
			return
		}
		mu.Lock()
		defer mu.Unlock()
		snapshotTimes = append(snapshotTimes, time.Duration(t.SnapshotMS*float64(time.Millisecond)))
		decisionTimes = append(decisionTimes, time.Duration(t.DecisionMS*float64(time.Millisecond)))
		handlerTimes = append(handlerTimes, time.Duration(t.TotalMS*float64(time.Millisecond)))
	}
	key, err := application.EphemeralKey()
	if err != nil {
		return Result{}, err
	}
	app, err := application.NewWithOptions(g, cfg, "127.0.0.1:0", key, nil, nil, application.Options{Engine: engine, Planner: planner, Observe: observe})
	if err != nil {
		return Result{}, err
	}
	initial := app.Simulator.Diagnostics()
	started := time.Now()
	predictor := decision.NewRunnerPredictor(1)
	audit := PredictionAudit{}
	probabilityAudit := ProbabilityAudit{}
	var runErr error
	logicalDigest := sha256.New()
	for turn := 0; turn < cfg.Turns; turn++ {
		turnStarted := time.Now()
		before := app.Simulator.Snapshot()
		prediction := predictor.Predict(ctx, before)
		probabilities := predictor.Probabilities(ctx, before)
		if runErr = app.Simulator.Step(ctx); runErr != nil {
			break
		}
		after := app.Simulator.Snapshot()
		logical := after
		logical.Metrics.HTTPP50MS, logical.Metrics.HTTPP95MS, logical.Metrics.HTTPP99MS = 0, 0, 0
		// Encoder sees only observable DTO fields; Graph/Scenario are excluded by
		// their JSON tags. Hash every tick, including fleet paths and public events.
		_ = json.NewEncoder(logicalDigest).Encode(logical)
		probabilityAudit.Observe(probabilities, after)
		actual := map[string]bool{}
		for _, z := range after.Zombies {
			if z.Type == world.Runner {
				actual[z.CurrentNode] = true
			}
		}
		audit.Turns++
		audit.CandidateNodes += len(prediction.OneTurnNodes)
		audit.ActualRunnerNodes += len(actual)
		for node := range actual {
			if _, ok := prediction.OneTurnNodes[node]; ok {
				audit.CoveredActualNodes++
			} else {
				audit.MissedActualNodes++
			}
		}
		for node := range prediction.OneTurnNodes {
			if !actual[node] {
				audit.FalsePositiveCandidates++
			}
		}
		if remaining := interval - time.Since(turnStarted); remaining > 0 {
			timer := time.NewTimer(remaining)
			select {
			case <-ctx.Done():
				timer.Stop()
				runErr = ctx.Err()
			case <-timer.C:
			}
			if runErr != nil {
				break
			}
		}
	}
	elapsed := time.Since(started)
	final := app.Simulator.Snapshot()
	report := app.Simulator.Diagnostics()
	closeErr := app.Close()
	if runErr != nil {
		return Result{}, runErr
	}
	if closeErr != nil {
		return Result{}, closeErr
	}
	mu.Lock()
	timings := ServerTimings{Snapshot: diagnostics.Measure(snapshotTimes), Decision: diagnostics.Measure(decisionTimes), Handler: diagnostics.Measure(handlerTimes)}
	mu.Unlock()
	count := float64(len(final.Survivors))
	if count == 0 {
		count = 1
	}
	result := Result{Experiment: experiment, Strategy: strategy, Scenario: cfg.Name, Seed: cfg.Seed, GraphVersion: g.Version, Nodes: len(g.Nodes), Edges: len(g.Edges), GraphSHA256: hash(g), InitialStateSHA256: hash(struct{ Survivors, Zombies []diagnostics.Spawn }{initial.InitialSurvivors, initial.InitialZombies}), Config: cfg, Metrics: final.Metrics, EvacuatedRatio: float64(final.Metrics.Evacuated) / count, AliveRatio: float64(final.Metrics.Evacuated+final.Metrics.Active) / count, BittenRatio: float64(final.Metrics.Bitten) / count, ElapsedMS: float64(elapsed) / float64(time.Millisecond), Diagnostics: report, ServerTimings: timings, PredictionAudit: &audit}
	result.LogicalSHA256 = hex.EncodeToString(logicalDigest.Sum(nil))
	result.FleetMetrics = final.FleetMetrics
	result.ProbabilityAudit = &probabilityAudit
	if e, ok := engine.(*decision.DeterministicEngine); ok {
		stats := e.Stats()
		result.EngineStats = &stats
	}
	if p, ok := planner.(*coordination.Planner); ok {
		stats := p.Stats()
		result.CoordinationStats = &stats
	}
	return result, nil
}

type Remapping struct {
	EntityID  string  `json:"entity_id"`
	Kind      string  `json:"kind"`
	FromNode  string  `json:"from_node"`
	ToNode    string  `json:"to_node"`
	DistanceM float64 `json:"distance_m"`
}

func Distance(lat1, lng1, lat2, lng2 float64) float64 {
	a, b := lat1*math.Pi/180, lat2*math.Pi/180
	dlat, dlng := (lat2-lat1)*math.Pi/180, (lng2-lng1)*math.Pi/180
	h := math.Sin(dlat/2)*math.Sin(dlat/2) + math.Cos(a)*math.Cos(b)*math.Sin(dlng/2)*math.Sin(dlng/2)
	return 6371008.8 * 2 * math.Asin(math.Min(1, math.Sqrt(h)))
}

func closest(nodes []world.GraphNode, lat, lng float64, excluded map[string]bool) (world.GraphNode, float64, error) {
	var selected world.GraphNode
	best := math.Inf(1)
	for _, n := range nodes {
		if excluded[n.ID] {
			continue
		}
		d := Distance(lat, lng, n.Lat, n.Lng)
		if d < best || (d == best && n.ID < selected.ID) {
			selected, best = n, d
		}
	}
	if selected.ID == "" {
		return selected, 0, fmt.Errorf("no valid remapping candidates")
	}
	return selected, best, nil
}

// Replay preserves geographic initial conditions and original PRNG warmup. A
// graph change can still change pursuits; remapping distances make that explicit.
// Refuges are remapped from the reference rather than silently relocated.
func Replay(source, target *world.Graph, cfg simulation.Config, initial diagnostics.Report) (*world.Graph, simulation.Config, []Remapping, error) {
	g := target.Clone()
	records := []Remapping{}
	sourceNodes := map[string]world.GraphNode{}
	for _, n := range source.Nodes {
		sourceNodes[n.ID] = n
	}
	targetNodes := map[string]world.GraphNode{}
	for _, n := range g.Nodes {
		targetNodes[n.ID] = n
	}
	excluded := map[string]bool{}
	originalRefuges := map[string]bool{}
	g.Shelters = []world.Shelter{}
	for _, sh := range source.Shelters {
		origin := sourceNodes[sh.NodeID]
		originalRefuges[sh.NodeID] = true
		n, d, err := closest(g.Nodes, origin.Lat, origin.Lng, excluded)
		if err != nil {
			return nil, cfg, nil, err
		}
		excluded[n.ID] = true
		sh.NodeID = n.ID
		sh.Occupancy, sh.Reserved = 0, 0
		sh.Available = sh.Capacity
		g.Shelters = append(g.Shelters, sh)
		records = append(records, Remapping{EntityID: sh.ID, Kind: "shelter", FromNode: origin.ID, ToNode: n.ID, DistanceM: d})
	}
	cfg.InitialSurvivors = []world.Survivor{}
	cfg.InitialZombies = []world.Zombie{}
	for _, spawn := range initial.InitialSurvivors {
		n, d, err := closest(g.Nodes, spawn.Lat, spawn.Lng, excluded)
		if err != nil {
			return nil, cfg, nil, err
		}
		cfg.InitialSurvivors = append(cfg.InitialSurvivors, world.Survivor{ID: spawn.ID, CurrentNode: n.ID, Status: world.Active, SpawnZoneID: spawn.ZoneID, PlannedRoute: []string{}})
		records = append(records, Remapping{EntityID: spawn.ID, Kind: "survivor", FromNode: spawn.NodeID, ToNode: n.ID, DistanceM: d})
	}
	for _, spawn := range initial.InitialZombies {
		n, d, err := closest(g.Nodes, spawn.Lat, spawn.Lng, excluded)
		if err != nil {
			return nil, cfg, nil, err
		}
		cfg.InitialZombies = append(cfg.InitialZombies, world.Zombie{ID: spawn.ID, Type: spawn.Type, CurrentNode: n.ID, Awake: spawn.Type != world.Sleeper, Path: []string{n.ID}})
		records = append(records, Remapping{EntityID: spawn.ID, Kind: "zombie", FromNode: spawn.NodeID, ToNode: n.ID, DistanceM: d})
	}
	cfg.InitialRandomNodeCount = len(source.Nodes) - len(originalRefuges)
	// Same-graph replay keeps exact events. Cross-graph closures are mapped to
	// the closest real segment and recorded, without calling it the same road.
	edges := append([]world.GraphEdge{}, source.Edges...)
	sort.Slice(edges, func(i, j int) bool { return edges[i].ID < edges[j].ID })
	cfg.Events = append([]simulation.ScheduledEvent{}, cfg.Events...)
	for i, event := range cfg.Events {
		var origin world.GraphEdge
		for _, e := range edges {
			if e.ID == event.EdgeID {
				origin = e
				break
			}
		}
		if event.EdgeID == "" && event.EdgeIndex >= 0 && event.EdgeIndex < len(edges) {
			origin = edges[event.EdgeIndex]
		}
		if origin.ID == "" {
			return nil, cfg, nil, fmt.Errorf("unknown reference event edge")
		}
		best := math.Inf(1)
		var chosen world.GraphEdge
		physicalBridgeAvailable := false
		if event.Type == "bridge_collapse" {
			for _, e := range g.Edges {
				if e.Bridge {
					physicalBridgeAvailable = true
					break
				}
			}
		}
		for _, e := range g.Edges {
			if e.ID == origin.ID {
				chosen = e
				best = 0
				break
			}
			if physicalBridgeAvailable && !e.Bridge {
				continue
			}
			a, b := sourceNodes[origin.From], sourceNodes[origin.To]
			x, y := targetNodes[e.From], targetNodes[e.To]
			d := Distance((a.Lat+b.Lat)/2, (a.Lng+b.Lng)/2, (x.Lat+y.Lat)/2, (x.Lng+y.Lng)/2)
			if d < best || (d == best && e.ID < chosen.ID) {
				chosen, best = e, d
			}
		}
		if chosen.ID == "" {
			return nil, cfg, nil, fmt.Errorf("no target edge for closure")
		}
		if event.Type == "bridge_collapse" && chosen.ID != origin.ID && !chosen.Bridge {
			// Physical bridge metadata is unavailable in the core model: callers
			// must supply an explicit verified mapping, never label a random road.
			event.Type = "reference_closure_remapped_unverified_bridge"
		}
		event.EdgeID = chosen.ID
		event.EdgeIndex = 0
		cfg.Events[i] = event
		records = append(records, Remapping{EntityID: fmt.Sprintf("event-%d", i), Kind: "closure", FromNode: origin.ID, ToNode: chosen.ID, DistanceM: best})
	}
	return g, cfg, records, nil
}
