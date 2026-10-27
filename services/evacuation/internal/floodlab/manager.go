package floodlab

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"sync"
	"time"

	"corodev/evacuation/internal/application"
	"corodev/evacuation/internal/catalog"
	"corodev/evacuation/internal/flood"
	"corodev/evacuation/internal/incidents"
	"corodev/evacuation/internal/reference"
	"corodev/evacuation/internal/runlimits"
	"corodev/evacuation/internal/simulation"
	"corodev/evacuation/internal/world"
)

var (
	ErrChanged = errors.New("la ejecución cambió; recupera el estado actual")
	ErrInvalid = errors.New("configuración experimental no válida")
	ErrState   = errors.New("la acción no corresponde al estado actual")
)

type execution struct {
	app                *application.App
	graph              *world.Graph
	turns              int
	config             RunConfig
	origins            []Origin
	threatHash         string
	startedAt          time.Time
	runtimeAccumulated time.Duration
}

type Manager struct {
	mu                 sync.RWMutex
	opMu               sync.Mutex // Step and transitions serialize; GET only reads cached state.
	state              State
	current            *execution
	graphs             map[string]*world.Graph
	catalog            Catalog
	origins            []string
	key                string
	ctx                context.Context
	cancel             context.CancelFunc
	wake               chan struct{}
	wg                 sync.WaitGroup
	closed             bool
	compareCancel      context.CancelFunc
	compareDone        chan struct{}
	sessions           localSessions
	incidentStore      *incidents.Store
	operatorSessionURL string
	referenceService   *reference.Service
	publicBytes        []byte
	publicETag         string
	publicKey          string
	lifecycleRates     map[string]lifecycleRate
}

func randomID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(value[:]), nil
}

func New(dataDir, scenarioDir string, origins []string) (*Manager, error) {
	c, err := catalog.New(dataDir, scenarioDir, catalog.Options{EnableFull: true, Concurrency: 16})
	if err != nil {
		return nil, err
	}
	key, err := application.EphemeralKey()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	m := &Manager{lifecycleRates: map[string]lifecycleRate{}, graphs: map[string]*world.Graph{}, key: key, ctx: ctx, cancel: cancel, wake: make(chan struct{}, 1), origins: append([]string{}, origins...)}
	for _, mode := range []string{"competition", "full"} {
		g, err := c.Graph(mode)
		if err != nil {
			cancel()
			return nil, err
		}
		m.graphs[mode] = g
		p, _ := c.Preset(mode)
		p.Enabled = true
		m.catalog.Modes = append(m.catalog.Modes, p)
	}
	defaults := RunConfig{HydraulicModel: "rainfall_runoff_2d", Mode: "competition", Seed: 20261026, RainfallProfile: "storm", RainfallIntensity: .8, SimulationDuration: runlimits.DefaultTicks, EvacuationBehavior: "preventive", Agents: 80, IntervalMS: 500, Shelters: originalCandidates(m.graphs["competition"])}
	hydrologyDefaults := flood.DefaultHydrologyConfig()
	defaults.Hydrology = &hydrologyDefaults
	m.catalog.DefaultConfig = cloneConfig(defaults)
	m.catalog.DurationLimits = runlimits.Duration()
	m.catalog.OriginalShelters = append([]Candidate{}, defaults.Shelters...)
	m.catalog.MaxSnapDistanceM = MaxSnapDistanceM
	m.catalog.Disclaimer = Disclaimer
	for _, p := range []struct {
		id, name, description string
		intensity             float64
	}{
		{"moderate", "Lluvia moderada", "Entrada artificial moderada; no es una escala oficial de alerta.", .4},
		{"intense", "Lluvia intensa", "Entrada artificial intensa para experimentar con cierres y rutas.", .8},
		{"extreme", "Tormenta extrema simulada", "Máxima entrada normalizada de laboratorio; no es un pronóstico.", 1},
	} {
		cfg := cloneConfig(defaults)
		cfg.RainfallIntensity = p.intensity
		m.catalog.Presets = append(m.catalog.Presets, Preset{ID: p.id, Name: p.name, Description: p.description, Config: cfg})
	}
	run, err := m.prepare(defaults)
	if err != nil {
		cancel()
		return nil, err
	}
	id, err := randomID()
	if err != nil {
		cancel()
		_ = run.app.Close()
		return nil, err
	}
	m.current = run
	m.state = m.initialState(id, "idle", run)
	m.sessions.items = map[string]localSession{}
	m.wg.Add(1)
	go m.loop()
	return m, nil
}

func (m *Manager) Catalog() Catalog {
	c := m.catalog
	c.Modes = append([]catalog.Preset{}, c.Modes...)
	c.DefaultConfig = cloneConfig(c.DefaultConfig)
	c.OriginalShelters = append([]Candidate{}, c.OriginalShelters...)
	c.Presets = append([]Preset{}, c.Presets...)
	for i := range c.Presets {
		c.Presets[i].Config = cloneConfig(c.Presets[i].Config)
	}
	return c
}

func (m *Manager) State() State { m.mu.RLock(); defer m.mu.RUnlock(); return m.state.clone() }

func validConfig(cfg RunConfig) bool {
	return validReference(cfg.GeographicReference) && (cfg.Mode == "competition" || cfg.Mode == "full") && cfg.Seed >= -9007199254740991 && cfg.Seed <= 9007199254740991 && finite(cfg.RainfallIntensity) && cfg.RainfallIntensity >= 0 && cfg.RainfallIntensity <= 1 && finite(cfg.SimulationDuration) && cfg.SimulationDuration >= runlimits.MinTicks && cfg.SimulationDuration <= runlimits.MaxTicks && cfg.SimulationDuration == math.Trunc(cfg.SimulationDuration) && validHydrologyConfig(cfg) && cfg.Agents >= 1 && cfg.Agents <= 200 && cfg.IntervalMS >= 0 && cfg.IntervalMS <= 5000 && (cfg.RainfallProfile == "storm" || cfg.RainfallProfile == "constant" || cfg.RainfallProfile == "pulse") && (cfg.EvacuationBehavior == "preventive" || cfg.EvacuationBehavior == "late" || cfg.EvacuationBehavior == "adaptive")
}

type initialClient struct{}

func (initialClient) NextStep(_ context.Context, r world.StepRequest) (world.StepResponse, error) {
	return world.StepResponse{NextNode: r.CurrentNode}, nil
}

// freeze uses the competition graph and its original shelters for every run.
// Otherwise selecting a shelter at a former spawn node would consume a different
// PRNG sequence and turn a shelter A/B into an accidental population comparison.
func (m *Manager) freeze(cfg RunConfig, target *world.Graph) ([]world.Survivor, []Origin, error) {
	base := m.graphs["competition"]
	sim, err := simulation.New(base, world.NewStore(), simulation.Config{Seed: cfg.Seed, Turns: 1, Survivors: cfg.Agents, UseSpawnZones: true}, initialClient{})
	if err != nil {
		return nil, nil, err
	}
	initial := sim.Snapshot().Survivors
	baseNodes := map[string]world.GraphNode{}
	targetNodes := map[string]world.GraphNode{}
	for _, n := range base.Nodes {
		baseNodes[n.ID] = n
	}
	for _, n := range target.Nodes {
		targetNodes[n.ID] = n
	}
	origins := []Origin{}
	for i := range initial {
		v := &initial[i]
		source := baseNodes[v.CurrentNode]
		node, ok := targetNodes[source.ID]
		d := 0.0
		if !ok {
			node, d = nearest(target, world.GeoPoint{Lat: source.Lat, Lng: source.Lng})
		}
		if node.ID == "" || d > MaxSnapDistanceM {
			return nil, nil, fmt.Errorf("no pudo conservarse el origen geográfico del agente %s", v.ID)
		}
		v.CurrentNode = node.ID
		v.TargetShelterID = ""
		v.PlannedRoute = []string{}
		v.Status = world.Active
		origins = append(origins, Origin{ID: v.ID, NodeID: node.ID, Lat: source.Lat, Lng: source.Lng, SnapDistanceM: d})
	}
	return initial, origins, nil
}

func (m *Manager) prepare(cfg RunConfig) (*execution, error) {
	if cfg.HydraulicModel == "" {
		cfg.HydraulicModel = "rainfall_runoff_2d"
	}
	if cfg.Hydrology == nil {
		h := flood.DefaultHydrologyConfig()
		cfg.Hydrology = &h
	}
	if !validConfig(cfg) {
		return nil, ErrInvalid
	}
	base := m.graphs[cfg.Mode]
	if base == nil {
		return nil, ErrInvalid
	}
	g, _, err := candidateGraph(base, cfg.Shelters)
	if err != nil {
		return nil, err
	}
	initial, origins, err := m.freeze(cfg, base)
	if err != nil {
		return nil, err
	}
	fc := flood.DefaultConfig()
	fc.RainfallProfile = cfg.RainfallProfile
	fc.RainfallIntensity = cfg.RainfallIntensity
	fc.SimulationDuration = cfg.SimulationDuration
	fc.EvacuationBehavior = cfg.EvacuationBehavior
	fc.HydraulicModel = cfg.HydraulicModel
	fc.Hydrology = cfg.Hydrology
	if err = m.configureReference(cfg, &fc, g); err != nil {
		return nil, err
	}
	turns := int(math.Ceil(cfg.SimulationDuration / fc.TimeStep))
	app, err := application.New(g, simulation.Config{Name: "Laboratorio de inundación urbana sintética", ScenarioType: "urban_flood", Flood: &fc, Seed: cfg.Seed, Turns: turns, Survivors: cfg.Agents, Concurrency: 16, InitialSurvivors: initial}, "127.0.0.1:0", m.key, nil, nil)
	if err != nil {
		return nil, err
	}
	return &execution{app: app, graph: g, turns: turns, config: cloneConfig(cfg), origins: origins, threatHash: digest(struct {
		Model     string
		Hydrology *flood.HydrologyConfig
	}{cfg.HydraulicModel, cfg.Hydrology})}, nil
}

func (m *Manager) initialState(id, status string, run *execution) State {
	w := run.app.Simulator.Snapshot()
	if status == "running" {
		run.startedAt = time.Now()
	}
	return State{RunID: id, State: status, Mode: run.config.Mode, GraphVersion: run.graph.Version, Config: cloneConfig(run.config), Scenario: w.Scenario, Shelters: w.Shelters, Origins: append([]Origin{}, run.origins...), Timeline: []TimelineEntry{{Step: 0, SimulationTime: 0, EvacuationMetrics: w.Scenario.EvacuationMetrics, StepLatencyMS: 0}}}
}

func (m *Manager) signal() {
	select {
	case m.wake <- struct{}{}:
	default:
	}
}

func (m *Manager) loop() {
	defer m.wg.Done()
	for {
		m.mu.RLock()
		status, interval := m.state.State, m.state.Config.IntervalMS
		m.mu.RUnlock()
		if status != "running" {
			select {
			case <-m.ctx.Done():
				return
			case <-m.wake:
				continue
			}
		}
		if interval > 0 {
			timer := time.NewTimer(time.Duration(interval) * time.Millisecond)
			select {
			case <-m.ctx.Done():
				timer.Stop()
				return
			case <-m.wake:
				timer.Stop()
				continue
			case <-timer.C:
			}
		}
		m.opMu.Lock()
		m.mu.RLock()
		run, active := m.current, m.state.State == "running"
		m.mu.RUnlock()
		if active && m.ctx.Err() == nil {
			start := time.Now()
			err := run.app.Simulator.Step(m.ctx)
			elapsed := float64(time.Since(start)) / float64(time.Millisecond)
			w := run.app.Simulator.Snapshot()
			m.mu.Lock()
			m.state.Scenario, m.state.Shelters = w.Scenario, w.Shelters
			m.state.RuntimeElapsedMS = runtimeElapsed(run, false)
			m.state.Timeline = append(m.state.Timeline, TimelineEntry{Step: w.Turn, SimulationTime: w.Scenario.SimulationTime, EvacuationMetrics: w.Scenario.EvacuationMetrics, StepLatencyMS: elapsed})
			if len(m.state.Timeline) > 512 {
				compact := make([]TimelineEntry, 0, 257)
				for i := 0; i < len(m.state.Timeline)-1; i += 2 {
					compact = append(compact, m.state.Timeline[i])
				}
				compact = append(compact, m.state.Timeline[len(m.state.Timeline)-1])
				m.state.Timeline = compact
			}
			if err != nil {
				m.state.State = "failed"
				m.state.RuntimeElapsedMS = runtimeElapsed(run, true)
			} else if w.Turn >= run.turns {
				m.state.State = "finished"
				m.state.RuntimeElapsedMS = runtimeElapsed(run, true)
			}
			m.mu.Unlock()
		}
		m.opMu.Unlock()
		if m.ctx.Err() != nil {
			return
		}
	}
}

func (m *Manager) stopComparison() {
	m.mu.RLock()
	cancel, done := m.compareCancel, m.compareDone
	m.mu.RUnlock()
	if cancel != nil {
		cancel()
	}
	if done != nil {
		<-done
	}
	m.mu.Lock()
	m.compareCancel, m.compareDone = nil, nil
	m.mu.Unlock()
}

func (m *Manager) startLocked(req RunRequest, runState string) (State, error) {
	if req.ExpectedRunID == "" || !validConfig(req.Config) {
		return State{}, ErrInvalid
	}
	m.mu.RLock()
	changed, closed := req.ExpectedRunID != m.state.RunID, m.closed
	m.mu.RUnlock()
	if closed {
		return State{}, ErrState
	}
	if changed {
		return State{}, ErrChanged
	}
	m.stopComparison()
	run, err := m.prepare(req.Config)
	if err != nil {
		return State{}, err
	}
	id, err := randomID()
	if err != nil {
		_ = run.app.Close()
		return State{}, err
	}
	m.mu.Lock()
	old := m.current
	m.current = run
	m.state = m.initialState(id, runState, run)
	result := m.state.clone()
	m.mu.Unlock()
	_ = old.app.Close()
	m.signal()
	return result, nil
}

func (m *Manager) Start(req RunRequest) (State, error) {
	m.opMu.Lock()
	defer m.opMu.Unlock()
	return m.startLocked(req, "running")
}

func (m *Manager) Act(action Action) (State, error) {
	m.opMu.Lock()
	defer m.opMu.Unlock()
	if action.ExpectedRunID == "" {
		return State{}, ErrInvalid
	}
	m.mu.RLock()
	current := m.state.clone()
	closed := m.closed
	m.mu.RUnlock()
	if closed {
		return State{}, ErrState
	}
	if action.ExpectedRunID != current.RunID {
		return State{}, ErrChanged
	}
	switch action.Action {
	case "restart", "repeat":
		status := "idle"
		if action.Action == "repeat" {
			status = "running"
		}
		return m.startLocked(RunRequest{Config: current.Config, ExpectedRunID: current.RunID}, status)
	case "pause":
		if current.State != "running" && current.State != "paused" {
			return State{}, ErrState
		}
		m.mu.Lock()
		m.state.State = "paused"
		m.state.RuntimeElapsedMS = runtimeElapsed(m.current, true)
		m.mu.Unlock()
	case "resume":
		if current.State != "paused" && current.State != "idle" {
			return State{}, ErrState
		}
		if current.Comparison != nil && current.Comparison.State == "running" {
			return State{}, ErrState
		}
		m.mu.Lock()
		m.state.State = "running"
		if m.current.startedAt.IsZero() {
			m.current.startedAt = time.Now()
		}
		m.mu.Unlock()
	case "cancel":
		if current.State != "running" && current.State != "paused" && current.State != "idle" && current.State != "cancelled" {
			return State{}, ErrState
		}
		m.stopComparison()
		m.mu.Lock()
		m.state.State = "cancelled"
		m.state.RuntimeElapsedMS = runtimeElapsed(m.current, true)
		m.mu.Unlock()
	case "speed":
		if action.IntervalMS == nil || *action.IntervalMS < 0 || *action.IntervalMS > 5000 {
			return State{}, ErrInvalid
		}
		m.mu.Lock()
		m.state.Config.IntervalMS = *action.IntervalMS
		m.current.config.IntervalMS = *action.IntervalMS
		m.mu.Unlock()
	default:
		return State{}, ErrInvalid
	}
	m.mu.Lock()
	m.state.RuntimeElapsedMS = runtimeElapsed(m.current, false)
	m.mu.Unlock()
	m.signal()
	return m.State(), nil
}

func (m *Manager) Validate(req CandidateRequest) (CandidateValidation, error) {
	g := m.graphs[req.Mode]
	if g == nil || len(req.Candidates) > 4 {
		return CandidateValidation{}, ErrInvalid
	}
	for _, c := range req.Candidates {
		if !validCandidateFields(c) {
			return CandidateValidation{}, ErrInvalid
		}
	}
	return validateCandidates(g, req.Candidates), nil
}

func (m *Manager) Graph(mode, runID string) (*world.Graph, error) {
	if mode == "" {
		m.mu.RLock()
		defer m.mu.RUnlock()
		if runID != "" && runID != m.state.RunID {
			return nil, ErrChanged
		}
		return m.current.graph.Clone(), nil
	}
	if m.graphs[mode] == nil {
		return nil, ErrInvalid
	}
	if runID == "" {
		return m.graphs[mode].Clone(), nil
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	if runID != m.state.RunID || mode != m.state.Mode {
		return nil, ErrChanged
	}
	return m.current.graph.Clone(), nil
}

func (m *Manager) Close() error {
	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		return nil
	}
	m.closed = true
	m.cancel()
	m.mu.Unlock()
	m.signal()
	m.wg.Wait()
	m.opMu.Lock()
	defer m.opMu.Unlock()
	return m.current.app.Close()
}

// Validate hydraulic parameters without constructing/prewarming a grid.
func validHydrologyConfig(cfg RunConfig) bool {
	fc := flood.DefaultConfig()
	fc.HydraulicModel, fc.Hydrology = cfg.HydraulicModel, cfg.Hydrology
	_, err := fc.WithDefaults()
	return err == nil
}

// runtimeElapsed measures active wall time, including pacing but excluding pauses.
// Callers hold opMu; only the execution writer changes these clocks.
func runtimeElapsed(run *execution, stop bool) float64 {
	elapsed := run.runtimeAccumulated
	if !run.startedAt.IsZero() {
		elapsed += time.Since(run.startedAt)
		if stop {
			run.runtimeAccumulated = elapsed
			run.startedAt = time.Time{}
		}
	}
	return float64(elapsed) / float64(time.Millisecond)
}
