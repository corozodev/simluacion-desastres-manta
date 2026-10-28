package main

// This is an experiment mode of the existing HTTP runner, not a second engine.
import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"syscall"
	"time"

	"corodev/evacuation/internal/application"
	"corodev/evacuation/internal/catalog"
	"corodev/evacuation/internal/coordination"
	"corodev/evacuation/internal/decision"
	"corodev/evacuation/internal/diagnostics"
	"corodev/evacuation/internal/evaluation"
	"corodev/evacuation/internal/simulation"
	"corodev/evacuation/internal/world"
)

type experimentCase struct {
	ReferenceRunID string            `json:"reference_run_id,omitempty"`
	ID             string            `json:"run_id"`
	Profile        string            `json:"graph_profile"`
	Round          string            `json:"round"`
	Level          string            `json:"threat_level"`
	Algorithm      string            `json:"algorithm"`
	Config         simulation.Config `json:"config"`
	GraphHash      string            `json:"graph_hash"`
	InitialHash    string            `json:"initial_hash"`
}
type connectivity struct {
	AccessibleNodes    int `json:"accessible_nodes"`
	ConnectedSurvivors int `json:"connected_survivors"`
	BlockedHordeNodes  int `json:"blocked_horde_nodes"`
}
type vehicleObservation struct {
	ID                    string         `json:"id"`
	ObservedActiveTurns   int            `json:"observed_active_turns"`
	ObservedIdleTurns     int            `json:"observed_idle_turns"`
	MaxObservedLoad       int            `json:"max_observed_load"`
	TraversedEdges        int            `json:"traversed_edges"`
	ObservedTargetChanges int            `json:"observed_target_changes"`
	WaitReasons           map[string]int `json:"wait_reasons"`
}
type turnObservation struct {
	Turn         int          `json:"turn"`
	Active       int          `json:"active"`
	BlockedEdges int          `json:"blocked_edges"`
	Physical     connectivity `json:"physical"`
	WithHordes   connectivity `json:"with_hordes"`
}
type runEvidence struct {
	Case        experimentCase       `json:"case"`
	Fingerprint string               `json:"fingerprint"`
	Status      string               `json:"status"`
	Failure     string               `json:"failure,omitempty"`
	Started     string               `json:"started_at"`
	Ended       string               `json:"ended_at,omitempty"`
	Result      evaluation.Result    `json:"result"`
	Turns       []turnObservation    `json:"connectivity_timeline,omitempty"`
	Vehicles    []vehicleObservation `json:"vehicles,omitempty"`
	CPUUserMS   float64              `json:"cpu_user_ms"`
	CPUSystemMS float64              `json:"cpu_system_ms"`
	MaxRSSKiB   int64                `json:"process_max_rss_kib"`
}

type httpValidation struct {
	Complete bool          `json:"complete"`
	Note     string        `json:"note"`
	Probes   []runEvidence `json:"probes"`
}

func stableEnvironment(env map[string]any) map[string]any {
	stable := map[string]any{}
	for _, key := range []string{"go", "os", "arch", "num_cpu", "gomaxprocs", "address_space_limit_bytes", "gomemlimit", "/sys/fs/cgroup/cpu.max", "/sys/fs/cgroup/memory.max"} {
		stable[key] = env[key]
	}
	if status, ok := env["/proc/self/status"].(string); ok {
		for _, line := range strings.Split(status, "\n") {
			if strings.HasPrefix(line, "Cpus_allowed_list:") {
				stable["cpu_affinity"] = strings.TrimSpace(strings.TrimPrefix(line, "Cpus_allowed_list:"))
			}
		}
	}
	return stable
}

// Validate every saved probe before accepting it as completed. Partial files
// remain resumable; a failed attempt is archived before replacing its evidence.
func loadHTTPValidation(path, fingerprint string, expected []experimentCase) (httpValidation, error) {
	saved := httpValidation{Note: "Separate three-turn BASE probes after the 36 full runs; medium threats, all three algorithms, native 16/32 worker queues, real authenticated HTTP, no warmup or artificial 200-request burst. Diagnostic local accelerated latency, not official real-time/WAN evidence."}
	b, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return saved, nil
	}
	if err != nil {
		return saved, err
	}
	if err = json.Unmarshal(b, &saved); err != nil {
		return saved, err
	}
	cases := map[string]experimentCase{}
	for _, c := range expected {
		cases[c.ID] = c
	}
	seen := map[string]bool{}
	for _, probe := range saved.Probes {
		c, ok := cases[probe.Case.ID]
		if !ok || seen[c.ID] || probe.Fingerprint != fingerprint || hash(probe.Case) != hash(c) {
			return saved, fmt.Errorf("HTTP checkpoint identity mismatch")
		}
		seen[c.ID] = true
		if probe.Status == "completed" && (probe.Result.Metrics.Turns != 3 || probe.Result.InitialStateSHA256 != c.InitialHash || probe.Result.FinalState == nil || probe.Result.FinalState.Turn != 3) {
			return saved, fmt.Errorf("invalid completed HTTP probe %s", c.ID)
		}
	}
	if saved.Complete {
		if len(saved.Probes) != len(expected) {
			return saved, fmt.Errorf("incomplete HTTP validation marked complete")
		}
		for _, probe := range saved.Probes {
			if probe.Status != "completed" {
				return saved, fmt.Errorf("failed HTTP probe marked complete")
			}
		}
	} else {
		if err = atomicJSON(path+".attempt-"+time.Now().UTC().Format("20060102T150405.000000000")+".json", saved); err != nil {
			return saved, err
		}
	}
	return saved, nil
}

func atomicJSON(path string, value any) error {
	b, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".checkpoint-")
	if err != nil {
		return err
	}
	name := f.Name()
	defer os.Remove(name)
	if _, err = f.Write(append(b, '\n')); err == nil {
		err = f.Sync()
	}
	err = errors.Join(err, f.Close())
	if err != nil {
		return err
	}
	return os.Rename(name, path)
}
func sourceDigest() (string, error) {
	files := []string{"go.mod"}
	for _, root := range []string{"cmd/compare", "internal"} {
		err := filepath.WalkDir(root, func(p string, d fs.DirEntry, e error) error {
			if e != nil {
				return e
			}
			if !d.IsDir() && strings.HasSuffix(p, ".go") {
				files = append(files, p)
			}
			return nil
		})
		if err != nil {
			return "", err
		}
	}
	sort.Strings(files)
	content := map[string]string{}
	for _, p := range files {
		b, e := os.ReadFile(p)
		if e != nil {
			return "", e
		}
		content[p] = string(b)
	}
	return hash(content), nil
}
func initialHash(d diagnostics.Report) string {
	return hash(struct{ Survivors, Zombies []diagnostics.Spawn }{d.InitialSurvivors, d.InitialZombies})
}
func validatePopulation(c experimentCase, d diagnostics.Report, w world.WorldSnapshot) error {
	counts := map[string]int{}
	for _, z := range d.InitialZombies {
		counts[z.Type]++
	}
	cfg := c.Config
	if len(d.InitialSurvivors) != cfg.Survivors || counts[world.Walker] != cfg.Walkers || counts[world.Runner] != cfg.Runners || counts[world.Horde] != cfg.Hordes || counts[world.Sleeper] != cfg.Sleepers {
		return fmt.Errorf("exact population mismatch %s", c.ID)
	}
	if initialHash(d) != c.InitialHash && c.InitialHash != "" {
		return fmt.Errorf("initial state mismatch %s", c.ID)
	}
	if d.Summary.InitialOverlaps != 0 || d.Summary.InitialHordeExclusions != 0 {
		return fmt.Errorf("invalid spawn overlaps %s", c.ID)
	}
	if cfg.RescueFleet {
		if len(w.Fleet) != 5 {
			return fmt.Errorf("expected five vehicles")
		}
		for _, v := range w.Fleet {
			if v.Capacity != 4 {
				return fmt.Errorf("expected capacity four")
			}
		}
	} else if len(w.Fleet) != 0 {
		return fmt.Errorf("unexpected fleet")
	}
	return nil
}

// Reverse reachability follows legal edge directions and forbids dangerous
// destinations, while allowing escape from a currently dangerous origin.
func access(g *world.Graph, w world.WorldSnapshot, hordes bool) connectivity {
	closed := map[string]bool{}
	for _, e := range w.BlockedEdges {
		closed[e] = true
	}
	danger := map[string]bool{}
	if hordes {
		for _, z := range w.Zombies {
			if z.Type == world.Horde {
				danger[z.CurrentNode] = true
			}
		}
		seeds := map[string]bool{}
		for n := range danger {
			seeds[n] = true
		}
		for _, e := range g.Edges {
			if seeds[e.From] {
				danger[e.To] = true
			}
			if seeds[e.To] {
				danger[e.From] = true
			}
		}
	}
	reverse := map[string][]string{}
	for _, e := range g.Edges {
		if closed[e.ID] || e.Blocked {
			continue
		}
		if !danger[e.To] {
			reverse[e.To] = append(reverse[e.To], e.From)
		}
		if !e.Directed && !danger[e.From] {
			reverse[e.From] = append(reverse[e.From], e.To)
		}
	}
	seen := map[string]bool{}
	queue := []string{}
	for _, s := range w.Shelters {
		if !danger[s.NodeID] && !seen[s.NodeID] {
			seen[s.NodeID] = true
			queue = append(queue, s.NodeID)
		}
	}
	for i := 0; i < len(queue); i++ {
		for _, n := range reverse[queue[i]] {
			if !seen[n] {
				seen[n] = true
				queue = append(queue, n)
			}
		}
	}
	r := connectivity{AccessibleNodes: len(seen), BlockedHordeNodes: len(danger)}
	for _, s := range w.Survivors {
		if s.Status == world.Active && seen[s.CurrentNode] {
			r.ConnectedSurvivors++
		}
	}
	return r
}
func assertWorld(cfg simulation.Config, w world.WorldSnapshot) error {
	if w.Metrics.Evacuated+w.Metrics.Active+w.Metrics.Bitten != cfg.Survivors {
		return fmt.Errorf("population conservation at turn %d", w.Turn)
	}
	occupancy := 0
	for _, s := range w.Shelters {
		if s.Occupancy < 0 || s.Reserved < 0 || s.Available < 0 || s.Occupancy+s.Reserved+s.Available != s.Capacity {
			return fmt.Errorf("shelter capacity invariant")
		}
		occupancy += s.Occupancy
	}
	if occupancy != w.Metrics.Evacuated {
		return fmt.Errorf("evacuation/occupancy mismatch")
	}
	passengers := map[string]bool{}
	for _, v := range w.Fleet {
		if len(v.PassengerIDs) > 4 || len(v.Path) > 3 {
			return fmt.Errorf("fleet capacity/movement violation")
		}
		for _, id := range v.PassengerIDs {
			if passengers[id] {
				return fmt.Errorf("duplicate passenger")
			}
			passengers[id] = true
		}
	}
	return nil
}
func executeCase(ctx context.Context, g *world.Graph, c experimentCase, options evaluation.RunOptions, fp string) runEvidence {
	out := runEvidence{Case: c, Fingerprint: fp, Status: "failed", Started: time.Now().UTC().Format(time.RFC3339Nano)}
	priorInitial, priorTurn := options.Initial, options.Turn
	options.Initial = func(d diagnostics.Report, w world.WorldSnapshot) error {
		if e := validatePopulation(c, d, w); e != nil {
			return e
		}
		if priorInitial != nil {
			return priorInitial(d, w)
		}
		return nil
	}
	vehicles := map[string]*vehicleObservation{}
	targets := map[string]string{}
	options.Turn = func(w world.WorldSnapshot) error {
		if err := assertWorld(c.Config, w); err != nil {
			return err
		}
		out.Turns = append(out.Turns, turnObservation{w.Turn, w.Metrics.Active, len(w.BlockedEdges), access(g, w, false), access(g, w, true)})
		for _, v := range w.Fleet {
			o := vehicles[v.ID]
			if o == nil {
				o = &vehicleObservation{ID: v.ID, WaitReasons: map[string]int{}}
				vehicles[v.ID] = o
			}
			if v.State == "idle" {
				o.ObservedIdleTurns++
			} else {
				o.ObservedActiveTurns++
			}
			if len(v.PassengerIDs) > o.MaxObservedLoad {
				o.MaxObservedLoad = len(v.PassengerIDs)
			}
			o.TraversedEdges += len(v.Path) - 1
			target := v.TargetSurvivorID + "/" + v.TargetShelterID
			if prev, ok := targets[v.ID]; ok && prev != target {
				o.ObservedTargetChanges++
			}
			targets[v.ID] = target
			if v.WaitReason != "" {
				o.WaitReasons[v.WaitReason]++
			}
		}
		if priorTurn != nil {
			return priorTurn(w)
		}
		return nil
	}
	engine := decision.NewWithOptions(decision.Options{Algorithm: c.Algorithm, Prediction: true})
	planner := coordination.New(engine, coordination.Options{})
	before := cpu()
	r, err := evaluation.RunWithOptions(ctx, g, c.Config, "track_a_experimental", c.Algorithm, engine, planner, options)
	after := cpu()
	out.Result = r
	out.CPUUserMS = ms(after.Utime) - ms(before.Utime)
	out.CPUSystemMS = ms(after.Stime) - ms(before.Stime)
	out.MaxRSSKiB = after.Maxrss
	out.Ended = time.Now().UTC().Format(time.RFC3339Nano)
	if err != nil {
		out.Failure = err.Error()
	} else {
		out.Status = "completed"
	}
	ids := []string{}
	for id := range vehicles {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		out.Vehicles = append(out.Vehicles, *vehicles[id])
	}
	return out
}

func experimentEnvironment() map[string]any {
	env := map[string]any{"go": runtime.Version(), "os": runtime.GOOS, "arch": runtime.GOARCH, "num_cpu": runtime.NumCPU(), "gomaxprocs": runtime.GOMAXPROCS(0)}
	var addressSpace syscall.Rlimit
	_ = syscall.Getrlimit(syscall.RLIMIT_AS, &addressSpace)
	env["address_space_limit_bytes"] = addressSpace.Cur
	env["gomemlimit"] = os.Getenv("GOMEMLIMIT")
	for _, p := range []string{"/proc/meminfo", "/proc/self/status", "/sys/fs/cgroup/cpu.max", "/sys/fs/cgroup/memory.max"} {
		b, _ := os.ReadFile(p)
		env[p] = string(b)
	}
	return env
}

func runTrackA(directory string) error {
	if err := os.MkdirAll(directory, 0700); err != nil {
		return err
	}
	lockPath := filepath.Join(directory, "runner.lock")
	lock, err := os.OpenFile(lockPath, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	defer lock.Close()
	if err = syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		return fmt.Errorf("another experiment owns directory: %w", err)
	}
	defer syscall.Flock(int(lock.Fd()), syscall.LOCK_UN)
	topologyRaw, err := os.ReadFile(filepath.Join(directory, "topology.json"))
	if err != nil {
		return fmt.Errorf("audit graphs first with tools/qa/track_a_report.py audit: %w", err)
	}
	cat, err := catalog.New("data", "scenarios/urban", catalog.Options{EnableFull: true})
	if err != nil {
		return err
	}
	codeHash, err := sourceDigest()
	if err != nil {
		return err
	}
	commit, _ := exec.Command("git", "rev-parse", "HEAD").Output()
	env := experimentEnvironment()
	graphs := map[string]*world.Graph{}
	cases := []experimentCase{}
	preflight := map[string]any{}
	compositions := [][][4]int{{{30, 8, 2, 0}, {45, 12, 3, 0}, {60, 16, 4, 0}}, {{60, 25, 5, 10}, {90, 37, 8, 15}, {120, 50, 10, 20}}}
	for _, profile := range []string{"competition", "full"} {
		g, e := cat.Graph(profile)
		if e != nil {
			return e
		}
		graphs[profile] = g
		for ri, round := range []string{"round2", "round3"} {
			seed := int64(20261027 + ri)
			for li, level := range []string{"baja", "media", "alta"} {
				cfg, e := cat.Config(profile, round, &seed)
				if e != nil {
					return e
				}
				counts := compositions[ri][li]
				cfg.Walkers, cfg.Runners, cfg.Hordes, cfg.Sleepers = counts[0], counts[1], counts[2], counts[3]
				cfg.ZombiePolicy = "classic_random"
				cfg.RescueFleet = ri == 1
				c := experimentCase{Profile: profile, Round: round, Level: level, Config: cfg, GraphHash: hash(g)}
				key, e := application.EphemeralKey()
				if e != nil {
					return e
				}
				app, e := application.NewWithOptions(g, cfg, "127.0.0.1:0", key, nil, nil, application.Options{Engine: decision.NewWithOptions(decision.Options{Algorithm: decision.BaselineShortestPath, Prediction: true})})
				if e != nil {
					return e
				}
				d, w := app.Simulator.Diagnostics(), app.Simulator.Snapshot()
				closeErr := app.Close()
				if e = errors.Join(validatePopulation(c, d, w), closeErr); e != nil {
					return e
				}
				c.InitialHash = initialHash(d)
				preflight[profile+"/"+round+"/"+level] = map[string]any{"initial_hash": c.InitialHash, "initial": d, "physical": access(g, w, false), "with_hordes": access(g, w, true)}
				for _, algorithm := range []string{decision.BaselineShortestPath, decision.DynamicRiskAStar, decision.PredictiveTemporalAStar} {
					row := c
					row.Algorithm = algorithm
					row.ID = profile + "-" + round + "-" + level + "-" + algorithm
					cases = append(cases, row)
				}
			}
		}
	}
	fp := hash(map[string]any{"schema": 2, "source_hash": codeHash, "cases": cases, "topology_hash": hash(string(topologyRaw)), "environment": stableEnvironment(env)})
	manifestPath := filepath.Join(directory, "manifest.json")
	if b, e := os.ReadFile(manifestPath); e == nil {
		var old struct {
			Fingerprint string `json:"fingerprint"`
		}
		if json.Unmarshal(b, &old) != nil || old.Fingerprint != fp {
			return fmt.Errorf("manifest differs; use a new output directory")
		}
	} else if !os.IsNotExist(e) {
		return e
	} else {
		manifest := map[string]any{"fingerprint": fp, "code_commit": strings.TrimSpace(string(commit)), "source_hash": codeHash, "created_at": time.Now().UTC().Format(time.RFC3339Nano), "environment": env, "nominal_turn_ms": 2000, "accelerated": true, "single_seed_per_condition": true, "cases": cases, "methodology": "same native simulator, routing, classic_random, assignment and prediction enabled; fleet only R3; same seed/initial state within graph+round+level; real authenticated loopback HTTP, 400ms client timeout, 16/32 workers; one simulation at a time; full is catalog FULL_MANTA9179; catalog intermediate expanded1000 is excluded"}
		if e = atomicJSON(manifestPath, manifest); e != nil {
			return e
		}
	}
	if err = atomicJSON(filepath.Join(directory, "preflight.json"), preflight); err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	// Check identical logical trajectories with normal two-second pacing using
	// three steps and the same real event IDs shifted only in this separate probe.
	equivalencePath := filepath.Join(directory, "equivalence.json")
	if _, e := os.Stat(equivalencePath); os.IsNotExist(e) {
		probe := cases[12] // BASE R3 media, fleet active
		probe.Config.Events = append([]simulation.ScheduledEvent{}, probe.Config.Events...)
		for i := range probe.Config.Events {
			probe.Config.Events[i].Turn = i + 2
		}
		fast := executeCase(ctx, graphs[probe.Profile], probe, evaluation.RunOptions{StopAfter: 3}, fp)
		paced := executeCase(ctx, graphs[probe.Profile], probe, evaluation.RunOptions{StopAfter: 3, Interval: 2 * time.Second}, fp)
		ok := fast.Status == "completed" && paced.Status == "completed" && fast.Result.LogicalSHA256 == paced.Result.LogicalSHA256 && fast.Result.InitialStateSHA256 == paced.Result.InitialStateSHA256
		if err = atomicJSON(equivalencePath, map[string]any{"verified": ok, "steps": 3, "note": "separate short R3 fleet probe; road events shifted to turns2/3 only here; configured horizon remains150; every observable tick hashed incl positions/bites/events/shelters/fleet, excluding HTTP percentiles", "accelerated": fast, "paced": paced}); err != nil {
			return err
		}
		if !ok {
			return fmt.Errorf("pacing equivalence failed")
		}
	} else if e != nil {
		return e
	} else {
		b, e := os.ReadFile(equivalencePath)
		if e != nil {
			return e
		}
		var proof struct {
			Verified bool `json:"verified"`
		}
		if json.Unmarshal(b, &proof) != nil || !proof.Verified {
			return fmt.Errorf("unverified pacing evidence")
		}
	}
	start := time.Now()
	completed := 0
	for _, c := range cases {
		if err = ctx.Err(); err != nil {
			return err
		}
		path := filepath.Join(directory, "runs", c.ID+".json")
		if b, e := os.ReadFile(path); e == nil {
			var previous runEvidence
			if e = json.Unmarshal(b, &previous); e != nil {
				return e
			}
			if previous.Fingerprint != fp || hash(previous.Case) != hash(c) {
				return fmt.Errorf("checkpoint configuration mismatch %s", c.ID)
			}
			if previous.Status == "completed" && previous.Result.Metrics.Turns == 150 {
				completed++
				fmt.Printf("resume %s\n", c.ID)
				continue
			}
			// Preserve interrupted/failed attempts rather than erase their evidence.
			if e = os.Rename(path, strings.TrimSuffix(path, ".json")+".attempt-"+time.Now().UTC().Format("20060102T150405.000000000")+".json"); e != nil {
				return e
			}
		} else if !os.IsNotExist(e) {
			return e
		}
		if err = atomicJSON(path, runEvidence{Case: c, Fingerprint: fp, Status: "running", Started: time.Now().UTC().Format(time.RFC3339Nano)}); err != nil {
			return err
		}
		evidence := executeCase(ctx, graphs[c.Profile], c, evaluation.RunOptions{}, fp)
		if evidence.Status == "completed" && evidence.Result.Metrics.Turns != 150 {
			evidence.Status = "failed"
			evidence.Failure = "not150turns"
		}
		if err = atomicJSON(path, evidence); err != nil {
			return err
		}
		if evidence.Status != "completed" {
			return fmt.Errorf("saved partial result %s: %s; rerun to resume", c.ID, evidence.Failure)
		}
		completed++
		m := evidence.Result.Metrics
		fmt.Printf("%d/36 %s evacuated=%d alive=%d bitten=%d wall=%.3fs http_p95=%.3fms\n", completed, c.ID, m.Evacuated, m.Evacuated+m.Active, m.Bitten, evidence.Result.ElapsedMS/1000, m.HTTPP95MS)
	}
	validationPath := filepath.Join(directory, "http-validation.json")
	expected := []experimentCase{}
	for _, i := range []int{3, 4, 5, 12, 13, 14} {
		expected = append(expected, cases[i])
	}
	validation, err := loadHTTPValidation(validationPath, fp, expected)
	if err != nil {
		return err
	}
	probes := map[string]runEvidence{}
	for _, probe := range validation.Probes {
		probes[probe.Case.ID] = probe
	}
	for _, c := range expected {
		if prior, ok := probes[c.ID]; ok && prior.Status == "completed" {
			continue
		}
		if err = ctx.Err(); err != nil {
			return err
		}
		probe := executeCase(ctx, graphs[c.Profile], c, evaluation.RunOptions{StopAfter: 3}, fp)
		probes[c.ID] = probe
		validation.Probes = nil
		for _, wanted := range expected {
			if p, ok := probes[wanted.ID]; ok {
				validation.Probes = append(validation.Probes, p)
			}
		}
		validation.Complete = len(validation.Probes) == len(expected)
		for _, p := range validation.Probes {
			validation.Complete = validation.Complete && p.Status == "completed"
		}
		if err = atomicJSON(validationPath, validation); err != nil {
			return err
		}
		if probe.Status != "completed" {
			return fmt.Errorf("HTTP validation failed: %s", probe.Failure)
		}
	}
	validation.Complete = true
	if err = atomicJSON(validationPath, validation); err != nil {
		return err
	}
	return atomicJSON(filepath.Join(directory, "completion.json"), map[string]any{"completed": completed, "turns": completed * 150, "finished_at": time.Now().UTC().Format(time.RFC3339Nano), "invocation_seconds": time.Since(start).Seconds(), "fingerprint": fp})
}
