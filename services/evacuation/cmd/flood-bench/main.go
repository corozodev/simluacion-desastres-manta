// Command flood-bench measures one synthetic urban-flood run in an isolated
// local process. Decisions use the application's authenticated loopback HTTP.
package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"math"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"syscall"
	"time"

	"corodev/evacuation/internal/application"
	"corodev/evacuation/internal/diagnostics"
	"corodev/evacuation/internal/graph"
	"corodev/evacuation/internal/simulation"
	"corodev/evacuation/internal/world"
)

type heapCheckpoint struct {
	SimulationStep int    `json:"simulation_step"`
	HeapAlloc      uint64 `json:"heap_alloc_bytes_after_gc"`
	HeapInuse      uint64 `json:"heap_inuse_bytes_after_gc"`
	HeapSys        uint64 `json:"heap_sys_bytes"`
	HeapObjects    uint64 `json:"heap_objects_after_gc"`
	TotalAlloc     uint64 `json:"total_alloc_bytes_cumulative"`
	NumGC          uint32 `json:"num_gc"`
	Goroutines     int    `json:"goroutines"`
}

type resourceUsage struct {
	WallSeconds              float64 `json:"wall_seconds"`
	ProcessCPUSeconds        float64 `json:"process_cpu_seconds"`
	AverageCPUOneCorePercent float64 `json:"average_cpu_one_core_percent"`
	PeakRSSKiBLinux          int64   `json:"peak_rss_kib_linux"`
	Note                     string  `json:"note"`
}

type requestCounts struct {
	Success int `json:"success"`
	Invalid int `json:"invalid"`
	Timeout int `json:"timeout"`
}

type benchmarkReport struct {
	RecordedAt                  string                      `json:"recorded_at"`
	Phase                       string                      `json:"phase"`
	Scenario                    string                      `json:"scenario"`
	ScenarioType                string                      `json:"scenario_type"`
	Seed                        int64                       `json:"seed"`
	GraphPath                   string                      `json:"graph_path"`
	GraphSHA256                 string                      `json:"graph_sha256"`
	ScenarioPath                string                      `json:"scenario_path"`
	ScenarioSHA256              string                      `json:"scenario_sha256"`
	GraphVersion                string                      `json:"graph_version"`
	Nodes                       int                         `json:"nodes"`
	Edges                       int                         `json:"edges"`
	Agents                      int                         `json:"agents"`
	TurnLimit                   int                         `json:"turn_limit"`
	CompletedStep               int                         `json:"completed_step"`
	Concurrency                 int                         `json:"simulation_concurrency"`
	Go                          string                      `json:"go"`
	GOMAXPROCS                  int                         `json:"gomaxprocs"`
	OS                          string                      `json:"os"`
	Arch                        string                      `json:"arch"`
	ProductionTouched           bool                        `json:"production_touched"`
	Accelerated                 bool                        `json:"accelerated"`
	Methodology                 string                      `json:"methodology"`
	ModelLimitation             string                      `json:"model_limitation"`
	EvacuationMetrics           world.EvacuationMetrics     `json:"evacuation_metrics"`
	Performance                 world.SimulationPerformance `json:"performance"`
	Requests                    requestCounts               `json:"requests"`
	StepLatency                 diagnostics.Timing          `json:"simulation_step_latency"`
	StepLatencyMaxMS            float64                     `json:"simulation_step_latency_max_ms"`
	RunElapsedMS                float64                     `json:"run_elapsed_ms"`
	HeapCheckpoints             []heapCheckpoint            `json:"heap_checkpoints"`
	Resources                   resourceUsage               `json:"resource_usage"`
	PeakRoadConditionEntries    int                         `json:"peak_road_condition_entries"`
	PeakBlockedEdges            int                         `json:"peak_blocked_edges"`
	PeakCautionEdges            int                         `json:"peak_caution_edges"`
	DeterministicStateSHA256    string                      `json:"deterministic_state_sha256"`
	DeterministicTimelineSHA256 string                      `json:"deterministic_timeline_sha256"`
	ExpectedTimelineSHA256      string                      `json:"expected_timeline_sha256,omitempty"`
	ValidationPassed            bool                        `json:"validation_passed"`
	Failures                    []string                    `json:"failures"`
}

func usage() (syscall.Rusage, error) {
	var r syscall.Rusage
	err := syscall.Getrusage(syscall.RUSAGE_SELF, &r)
	return r, err
}

func cpu(r syscall.Rusage) float64 {
	return float64(r.Utime.Sec+r.Stime.Sec) + float64(r.Utime.Usec+r.Stime.Usec)/1e6
}

func checkpoint(step int) heapCheckpoint {
	runtime.GC()
	var memory runtime.MemStats
	runtime.ReadMemStats(&memory)
	return heapCheckpoint{SimulationStep: step, HeapAlloc: memory.HeapAlloc, HeapInuse: memory.HeapInuse, HeapSys: memory.HeapSys, HeapObjects: memory.HeapObjects, TotalAlloc: memory.TotalAlloc, NumGC: memory.NumGC, Goroutines: runtime.NumGoroutine()}
}

func checksum(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// Stable output includes every observable outcome and scenario condition. The
// graph is identified separately; process and transport timings are excluded.
func stableSnapshot(w world.WorldSnapshot) ([]byte, error) {
	w.Metrics.HTTPP50MS, w.Metrics.HTTPP95MS, w.Metrics.HTTPP99MS = 0, 0, 0
	w.Simulation = nil
	scenario := w.Scenario.Clone()
	if scenario != nil {
		scenario.Performance = world.SimulationPerformance{}
	}
	return json.Marshal(struct {
		World    world.WorldSnapshot     `json:"world"`
		Scenario *world.ScenarioSnapshot `json:"scenario"`
	}{World: w, Scenario: scenario})
}

// validateSnapshot checks both the shared core and the scenario's independent
// population accounting. Isolation and intentional waiting are valid outcomes.
func validateSnapshot(w world.WorldSnapshot, expected map[string]bool, baselineOccupancy map[string]int) error {
	if w.Scenario == nil || w.Scenario.ScenarioType != "urban_flood" {
		return errors.New("urban_flood snapshot missing")
	}
	if w.Metrics.Bitten != 0 || w.Metrics.RequestsInvalid != 0 || w.Metrics.RequestsTimeout != 0 {
		return fmt.Errorf("unexpected bitten/invalid/timeout: %d/%d/%d", w.Metrics.Bitten, w.Metrics.RequestsInvalid, w.Metrics.RequestsTimeout)
	}
	if len(w.Survivors) != len(expected) || len(w.Scenario.Agents) != len(expected) || w.Scenario.EvacuationMetrics.TotalAgents != len(expected) {
		return errors.New("population conservation failed")
	}
	survivors := map[string]world.Survivor{}
	reservations, evacuatedByShelter := map[string]int{}, map[string]int{}
	active, evacuated := 0, 0
	for _, survivor := range w.Survivors {
		if !expected[survivor.ID] {
			return fmt.Errorf("unexpected survivor %q", survivor.ID)
		}
		if _, duplicate := survivors[survivor.ID]; duplicate {
			return fmt.Errorf("duplicate survivor %q", survivor.ID)
		}
		survivors[survivor.ID] = survivor
		switch survivor.Status {
		case world.Active:
			active++
			if survivor.TargetShelterID != "" {
				reservations[survivor.TargetShelterID]++
			}
		case world.Evacuated:
			evacuated++
			evacuatedByShelter[survivor.TargetShelterID]++
		default:
			return fmt.Errorf("unexpected flood survivor status %q", survivor.Status)
		}
	}
	if active+evacuated != len(expected) || w.Metrics.Active != active || w.Metrics.Evacuated != evacuated {
		return errors.New("core population metrics disagree with survivor states")
	}
	shelters := map[string]bool{}
	for _, shelter := range w.Shelters {
		if shelters[shelter.ID] || shelter.Capacity < 0 || shelter.Occupancy < 0 || shelter.Reserved < 0 || shelter.Occupancy+shelter.Reserved > shelter.Capacity || shelter.Available != shelter.Capacity-shelter.Occupancy-shelter.Reserved {
			return fmt.Errorf("shelter capacity invariant failed for %q", shelter.ID)
		}
		shelters[shelter.ID] = true
		if shelter.Reserved != reservations[shelter.ID] || shelter.Occupancy != baselineOccupancy[shelter.ID]+evacuatedByShelter[shelter.ID] {
			return fmt.Errorf("shelter reservation/admission accounting failed for %q", shelter.ID)
		}
	}
	for id := range reservations {
		if !shelters[id] {
			return fmt.Errorf("reservation references unknown shelter %q", id)
		}
	}
	for id := range evacuatedByShelter {
		if !shelters[id] {
			return fmt.Errorf("admission references unknown shelter %q", id)
		}
	}
	seenAgents := map[string]bool{}
	agentStates := map[string]int{}
	for _, agent := range w.Scenario.Agents {
		survivor, exists := survivors[agent.ID]
		if !exists || seenAgents[agent.ID] || agent.CurrentNode != survivor.CurrentNode || agent.TargetShelterID != survivor.TargetShelterID {
			return fmt.Errorf("scenario agent disagrees with core for %q", agent.ID)
		}
		seenAgents[agent.ID] = true
		agentStates[agent.State]++
		if (agent.State == "evacuated") != (survivor.Status == world.Evacuated) {
			return fmt.Errorf("scenario evacuation state disagrees for %q", agent.ID)
		}
		switch agent.State {
		case "moving", "isolated", "waiting", "evacuated":
		default:
			return fmt.Errorf("unknown flood agent state %q", agent.State)
		}
	}
	m := w.Scenario.EvacuationMetrics
	if m.EvacuatedAgents != evacuated || m.IsolatedAgents != agentStates["isolated"] || m.WaitingAgents != agentStates["waiting"] {
		return errors.New("scenario population metrics disagree with agent states")
	}
	return nil
}

func writePrivate(path string, value any) error {
	raw, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer f.Close()
	if err := f.Chmod(0600); err != nil {
		return err
	}
	if _, err := f.Write(append(raw, '\n')); err != nil {
		return err
	}
	return f.Close()
}

func run() error {
	graphPath := flag.String("graph", "data/manta-v2.json", "checked-in street graph JSON")
	scenarioPath := flag.String("scenario", "scenarios/flood/urban-storm.json", "synthetic urban_flood scenario JSON")
	output := flag.String("output", "", "required private JSON report (written with mode 0600)")
	seedOverride := flag.String("seed", "", "optional signed integer seed, including zero")
	expectHash := flag.String("expect-hash", "", "optional expected deterministic timeline SHA-256")
	flag.Parse()
	if *output == "" || flag.NArg() != 0 {
		return errors.New("-output is required; no positional arguments accepted")
	}
	if *expectHash != "" {
		decoded, err := hex.DecodeString(*expectHash)
		if err != nil || len(decoded) != sha256.Size {
			return errors.New("-expect-hash must be a SHA-256 hex string")
		}
		*expectHash = hex.EncodeToString(decoded)
	}
	started := time.Now()
	initialUsage, err := usage()
	if err != nil {
		return err
	}
	g, err := graph.Load(*graphPath)
	if err != nil {
		return err
	}
	cfg, err := simulation.LoadConfig(*scenarioPath)
	if err != nil {
		return err
	}
	if cfg.ScenarioType != "urban_flood" || cfg.Turns < 1 {
		return errors.New("benchmark requires a bounded urban_flood scenario")
	}
	if *seedOverride != "" {
		cfg.Seed, err = strconv.ParseInt(*seedOverride, 10, 64)
		if err != nil {
			return errors.New("invalid -seed")
		}
	}
	graphSHA, err := checksum(*graphPath)
	if err != nil {
		return err
	}
	scenarioSHA, err := checksum(*scenarioPath)
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
	state := app.Simulator.Snapshot()
	initialIDs, baselineOccupancy := map[string]bool{}, map[string]int{}
	for _, survivor := range state.Survivors {
		initialIDs[survivor.ID] = true
	}
	for _, shelter := range state.Shelters {
		baselineOccupancy[shelter.ID] = shelter.Occupancy
	}
	report := benchmarkReport{
		RecordedAt: time.Now().UTC().Format(time.RFC3339Nano), Phase: "4A", Scenario: cfg.Name, ScenarioType: cfg.ScenarioType,
		Seed: cfg.Seed, GraphPath: *graphPath, GraphSHA256: graphSHA, ScenarioPath: *scenarioPath, ScenarioSHA256: scenarioSHA,
		GraphVersion: g.Version, Nodes: len(g.Nodes), Edges: len(g.Edges), Agents: len(state.Survivors), TurnLimit: cfg.Turns,
		Concurrency: cfg.Concurrency, Go: runtime.Version(), GOMAXPROCS: runtime.GOMAXPROCS(0), OS: runtime.GOOS, Arch: runtime.GOARCH,
		Accelerated: true, ExpectedTimelineSHA256: *expectHash, Failures: []string{},
		Methodology:     "One local process; one graph/scenario; accelerated steps without pacing; real authenticated loopback HTTP /paso; full Step wall latency with nearest-rank percentiles; validation at initial and every completed step; GC checkpoints at zero, midpoint and final are outside Step latency but included in process resources. CPU/RSS include graph load, initialization, checks, snapshots, hashing and GC. Heap checkpoints include a retained observable snapshot. No infrastructure latency or improvement is inferred. Hashes include observable world/scenario outputs and exclude performance and HTTP latency percentiles.",
		ModelLimitation: "Los escenarios de inundación emplean parámetros sintéticos y no constituyen pronósticos hidrológicos ni recomendaciones oficiales de evacuación",
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	timeline := sha256.New()
	latencies := make([]time.Duration, 0, cfg.Turns)
	observe := func() error {
		if err := validateSnapshot(state, initialIDs, baselineOccupancy); err != nil {
			return err
		}
		stable, err := stableSnapshot(state)
		if err != nil {
			return err
		}
		_, _ = timeline.Write(stable)
		_, _ = timeline.Write([]byte{'\n'})
		hash := sha256.Sum256(stable)
		report.DeterministicStateSHA256 = hex.EncodeToString(hash[:])
		report.PeakRoadConditionEntries = max(report.PeakRoadConditionEntries, len(state.Scenario.RoadConditions))
		report.PeakBlockedEdges = max(report.PeakBlockedEdges, state.Scenario.EvacuationMetrics.BlockedEdges)
		report.PeakCautionEdges = max(report.PeakCautionEdges, state.Scenario.EvacuationMetrics.CautionEdges)
		return nil
	}
	if err := observe(); err != nil {
		report.Failures = append(report.Failures, fmt.Sprintf("step 0: %v", err))
	}
	report.HeapCheckpoints = append(report.HeapCheckpoints, checkpoint(0))
	runStart := time.Now()
	for step := 1; step <= cfg.Turns && len(report.Failures) == 0; step++ {
		stepStart := time.Now()
		err := app.Simulator.Step(ctx)
		elapsed := time.Since(stepStart)
		latencies = append(latencies, elapsed)
		report.StepLatencyMaxMS = math.Max(report.StepLatencyMaxMS, float64(elapsed)/float64(time.Millisecond))
		state = app.Simulator.Snapshot()
		report.CompletedStep = state.Turn
		if err != nil {
			report.Failures = append(report.Failures, fmt.Sprintf("step %d: %v", step, err))
		} else if err := observe(); err != nil {
			report.Failures = append(report.Failures, fmt.Sprintf("step %d: %v", step, err))
		}
		if step == cfg.Turns/2 && step != cfg.Turns {
			report.HeapCheckpoints = append(report.HeapCheckpoints, checkpoint(state.Turn))
		}
	}
	report.RunElapsedMS = float64(time.Since(runStart)) / float64(time.Millisecond)
	report.HeapCheckpoints = append(report.HeapCheckpoints, checkpoint(state.Turn))
	report.StepLatency = diagnostics.Measure(latencies)
	report.DeterministicTimelineSHA256 = hex.EncodeToString(timeline.Sum(nil))
	if state.Scenario != nil {
		report.EvacuationMetrics, report.Performance = state.Scenario.EvacuationMetrics, state.Scenario.Performance
	}
	report.Requests = requestCounts{Success: state.Metrics.RequestsSuccess, Invalid: state.Metrics.RequestsInvalid, Timeout: state.Metrics.RequestsTimeout}
	if *expectHash != "" && report.DeterministicTimelineSHA256 != *expectHash {
		report.Failures = append(report.Failures, "deterministic timeline SHA-256 did not match -expect-hash")
	}
	finalUsage, err := usage()
	if err != nil {
		report.Failures = append(report.Failures, fmt.Sprintf("resource usage: %v", err))
	}
	wall := time.Since(started).Seconds()
	processCPU := cpu(finalUsage) - cpu(initialUsage)
	report.Resources = resourceUsage{WallSeconds: wall, ProcessCPUSeconds: processCPU, AverageCPUOneCorePercent: processCPU / wall * 100, PeakRSSKiBLinux: finalUsage.Maxrss,
		Note: "Linux ru_maxrss is KiB and includes the whole process lifetime; CPU is percent of one core. Three forced-GC samples characterize retained heap; they do not prove a long-term memory bound. TotalAlloc is cumulative allocation, not retained memory."}
	report.ValidationPassed = len(report.Failures) == 0 && report.CompletedStep == cfg.Turns
	if err := writePrivate(*output, report); err != nil {
		return err
	}
	fmt.Printf("report=%s steps=%d/%d passed=%t timeline_sha256=%s\n", *output, report.CompletedStep, cfg.Turns, report.ValidationPassed, report.DeterministicTimelineSHA256)
	if !report.ValidationPassed {
		return errors.New("flood benchmark failed; private report preserves measured evidence")
	}
	return nil
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
