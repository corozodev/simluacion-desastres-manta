package sessions

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strings"
	"sync"
	"time"

	"corodev/evacuation/internal/application"
	"corodev/evacuation/internal/catalog"
	"corodev/evacuation/internal/coordination"
	"corodev/evacuation/internal/decision"
	"corodev/evacuation/internal/flood"
	"corodev/evacuation/internal/graph"
	"corodev/evacuation/internal/runlimits"
	"corodev/evacuation/internal/simulation"
	"corodev/evacuation/internal/world"
)

const baseReservation int64 = 16 << 20
const fullReservation int64 = 64 << 20

type execution struct {
	// op serializes turns with controls; mu only protects published state.
	op                   sync.Mutex
	mu                   sync.RWMutex
	info                 Metadata
	snapshot             world.WorldSnapshot
	analytics            *Analytics
	forecast             *RunnerForecast
	audit                predictionAudit
	tokenHash            [32]byte
	lastAccess, pausedAt time.Time
	nextTick             time.Time
	remaining            time.Duration
	app                  *application.App
	ctx                  context.Context
	cancel               context.CancelFunc
	wake                 chan struct{}
	done                 chan struct{}
	reserved             int64
	engineReleased       bool // guarded by Manager.mu
	expired              bool // guarded by execution.mu
	idempotency          string
	publicVersion        uint64
	publicBytes          []byte
	publicETag           string
}

type idempotencyEntry struct {
	fingerprint [32]byte
	ready       chan struct{}
	id, token   string
	err         error
}
type tombstone struct {
	hash    [32]byte
	expires time.Time
}
type rateBucket struct {
	window            time.Time
	requests, creates int
}

type Metrics struct {
	Active               int     `json:"active_sessions"`
	Retained             int     `json:"retained_sessions"`
	Completed            uint64  `json:"completed_sessions"`
	Rejected             uint64  `json:"rejected_sessions"`
	EngineErrors         uint64  `json:"engine_errors"`
	EstimatedMemoryBytes int64   `json:"estimated_memory_bytes"`
	Turns                uint64  `json:"turns"`
	TurnDurationMS       float64 `json:"turn_duration_ms_total"`
	ExecutionDurationMS  float64 `json:"execution_duration_ms_total"`
}

type Manager struct {
	mu                    sync.Mutex
	catalog               *catalog.Catalog
	options               Options
	sessions              map[string]*execution
	idempotency           map[string]*idempotencyEntry
	expired               map[string]tombstone
	rates                 map[string]rateBucket
	publicRates           map[string]rateBucket
	published             map[string]string
	active, full, pending int
	metrics               Metrics
	closed                bool
	ctx                   context.Context
	cancel                context.CancelFunc
	wg                    sync.WaitGroup
}

func New(c *catalog.Catalog, o Options) (*Manager, error) {
	if c == nil {
		return nil, fmt.Errorf("catalog required")
	}
	if err := validateOptions(o); err != nil {
		return nil, err
	}
	o = completeOptions(o)
	ctx, cancel := context.WithCancel(context.Background())
	m := &Manager{catalog: c, options: o, sessions: map[string]*execution{}, idempotency: map[string]*idempotencyEntry{}, expired: map[string]tombstone{}, rates: map[string]rateBucket{}, publicRates: map[string]rateBucket{}, published: map[string]string{}, ctx: ctx, cancel: cancel}
	// The manager starts only its janitor, never an engine.
	m.wg.Add(1)
	go func() {
		defer m.wg.Done()
		for {
			t := o.Clock.NewTimer(time.Second)
			select {
			case <-ctx.Done():
				t.Stop()
				return
			case <-t.C():
				m.Cleanup()
			}
		}
	}()
	return m, nil
}

func randomSecret(bytes int) (string, error) {
	b := make([]byte, bytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	if bytes == 16 {
		return hex.EncodeToString(b), nil
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
func profileMode(profile string) string {
	if profile == "BASE" {
		return "competition"
	}
	if profile == "FULL_MANTA" {
		return "full"
	}
	return ""
}
func reservation(profile string) int64 {
	if profile == "FULL_MANTA" {
		return fullReservation
	}
	return baseReservation
}

func (m *Manager) validate(req CreateRequest) error {
	if err := validatePolicies(req); err != nil {
		return err
	}
	mode := profileMode(req.GraphProfile)
	if req.Scenario != "zombie_outbreak" && req.Scenario != "urban_flood" || mode == "" {
		return invalid()
	}
	p, ok := m.catalog.Preset(mode)
	if !ok || !p.Enabled || req.GraphProfile == "FULL_MANTA" && m.options.MaxFullActive == 0 {
		return &Error{400, "VALIDATION_ERROR", "El perfil de grafo no está habilitado."}
	}
	if req.Seed != nil && (*req.Seed < -9007199254740991 || *req.Seed > 9007199254740991) || req.MaxTicks != nil && (*req.MaxTicks < m.options.MinTicks || *req.MaxTicks > runlimits.MaxTicks) || req.TickIntervalMS != nil && (*req.TickIntervalMS < 1000 || *req.TickIntervalMS > 5000) || req.Config.Survivors != nil && (*req.Config.Survivors < 1 || *req.Config.Survivors > 200) {
		return invalid()
	}
	if len(req.Config.RefugeIDs) > 4 || req.Config.CustomShelters != nil && len(req.Config.CustomShelters) != 4 {
		return invalid()
	}
	if r := req.Config.RainfallIntensity; r != nil && (req.Scenario != "urban_flood" || math.IsNaN(*r) || math.IsInf(*r, 0) || *r < 0 || *r > 1) {
		return invalid()
	}
	if req.Config.Round != "" && req.Config.Round != "round1" && req.Config.Round != "round2" && req.Config.Round != "round3" {
		return invalid()
	}
	return nil
}

func (m *Manager) prepare(req CreateRequest) (*execution, error) {
	seed := int64(20261026)
	if req.Seed != nil {
		seed = *req.Seed
	}
	round := req.Config.Round
	if round == "" {
		round = "round1"
	}
	cfg, err := m.catalog.Config(profileMode(req.GraphProfile), round, &seed)
	if err != nil {
		return nil, invalid()
	}
	g, err := m.catalog.Graph(profileMode(req.GraphProfile))
	if err != nil {
		return nil, invalid()
	}
	maxTicks := m.options.DefaultMaxTicks
	if req.MaxTicks != nil {
		maxTicks = *req.MaxTicks
	}
	interval := int(m.options.DefaultTickInterval.Milliseconds())
	if req.TickIntervalMS != nil {
		interval = *req.TickIntervalMS
	}
	if req.Config.Mode == "official" {
		maxTicks, interval = runlimits.OfficialTicks, 2000
	}
	cfg.Turns = maxTicks
	if req.Config.Survivors != nil {
		cfg.Survivors = *req.Config.Survivors
	}
	selected := map[string]bool{}
	for _, id := range req.Config.RefugeIDs {
		if selected[id] {
			return nil, invalid()
		}
		selected[id] = true
	}
	shelters := []world.Shelter{}
	for _, sh := range g.Shelters {
		cfg.SpawnExcludedNodeIDs = append(cfg.SpawnExcludedNodeIDs, sh.NodeID)
		if len(req.Config.RefugeIDs) == 0 || selected[sh.ID] {
			sh.Occupancy, sh.Reserved = 0, 0
			sh.Available = sh.Capacity
			shelters = append(shelters, sh)
			delete(selected, sh.ID)
		}
	}
	if len(selected) > 0 || len(shelters) == 0 {
		return nil, invalid()
	}
	if len(req.Config.CustomShelters) > 0 {
		if len(shelters) != 4 {
			return nil, invalid()
		}
		originals, nodes, legal, used := map[string]bool{}, map[string]bool{}, map[string]bool{}, map[string]bool{}
		for _, sh := range shelters {
			originals[sh.ID] = true
		}
		for _, n := range g.Nodes {
			nodes[n.ID] = true
		}
		for _, e := range g.Edges {
			if !e.Blocked {
				legal[e.From], legal[e.To] = true, true
			}
		}
		shelters = nil
		for _, sh := range req.Config.CustomShelters {
			if !originals[sh.ID] || !nodes[sh.NodeID] || !legal[sh.NodeID] || used[sh.NodeID] || sh.Capacity < 1 || sh.Capacity > 200 {
				return nil, invalid()
			}
			delete(originals, sh.ID)
			used[sh.NodeID] = true
			shelters = append(shelters, world.Shelter{ID: sh.ID, NodeID: sh.NodeID, Capacity: sh.Capacity, Available: sh.Capacity})
		}
	}
	g.Shelters = shelters
	if len(req.Config.CustomShelters) > 0 {
		if err := graph.Validate(g); err != nil {
			return nil, &Error{400, "VALIDATION_ERROR", "Los refugios deben ser accesibles desde todos los nodos del grafo."}
		}
	}
	refuges := make([]string, 0, len(shelters))
	for _, sh := range shelters {
		refuges = append(refuges, sh.ID)
	}
	sort.Strings(refuges)
	config := Config{Survivors: cfg.Survivors, Round: round, RefugeIDs: refuges, CustomShelters: append([]CustomShelter(nil), req.Config.CustomShelters...)}
	if req.Scenario == "urban_flood" {
		cfg.ScenarioType = "urban_flood"
		cfg.Walkers, cfg.Runners, cfg.Hordes, cfg.Sleepers = 0, 0, 0, 0
		cfg.Events = nil
		fc := flood.DefaultConfig()
		fc.SimulationDuration = float64(maxTicks)
		if req.Config.RainfallIntensity != nil {
			fc.RainfallIntensity = *req.Config.RainfallIntensity
		}
		cfg.Flood = &fc
		rain := fc.RainfallIntensity
		config.RainfallIntensity = &rain
	} else {
		// Short runs include only events inside their authorized horizon.
		events := []simulation.ScheduledEvent{}
		for _, event := range cfg.Events {
			if event.Turn <= maxTicks {
				events = append(events, event)
			}
		}
		cfg.Events = events
	}
	id, err := randomSecret(16)
	if err != nil {
		return nil, err
	}
	key, err := application.EphemeralKey()
	if err != nil {
		return nil, err
	}
	policies := resolvedPolicies(req.Config)
	cfg.ZombiePolicy = policies.ZombiePolicy
	cfg.RescueFleet = policies.Pro.RescueFleet
	engineOptions := m.options.Engine
	engineOptions.Algorithm = policies.EvacuationAlgorithm
	engineOptions.Prediction = policies.Pro.RunnerPrediction
	// Flood sessions preserve the historical engine and ignore zombie-only defaults.
	if req.Scenario == "urban_flood" {
		engineOptions = m.options.Engine
	}
	engine := decision.NewWithOptions(engineOptions)
	app, err := application.NewWithOptions(g, cfg, "127.0.0.1:0", key, nil, m.options.Logger, application.Options{Engine: engine, Planner: coordination.New(engine, coordination.Options{DisableAssignment: req.Scenario != "urban_flood" && !policies.Pro.ShelterAssignment}), AllowShelterSubset: true, ObservationID: id})
	if err != nil {
		return nil, err
	}
	now := m.options.Clock.Now()
	ctx, cancel := context.WithCancel(m.ctx)
	snap, _ := app.Store.LoadCompact()
	run := &execution{app: app, ctx: ctx, cancel: cancel, wake: make(chan struct{}, 1), done: make(chan struct{}), snapshot: snap, lastAccess: now, reserved: reservation(req.GraphProfile)}
	if req.Scenario == "zombie_outbreak" {
		config.Mode, config.ZombiePolicy, config.EvacuationAlgorithm, config.Pro = policies.Mode, policies.ZombiePolicy, policies.EvacuationAlgorithm, policies.Pro
	}
	run.info = Metadata{SimulationID: id, Status: Running, MaxTicks: maxTicks, StateVersion: 1, Scenario: req.Scenario, GraphProfile: req.GraphProfile, GraphVersion: g.Version, Seed: seed, TickIntervalMS: interval, CreatedAt: now, StartedAt: now, UpdatedAt: now, Config: config}
	if req.Scenario == "zombie_outbreak" && policies.Pro.RunnerPrediction {
		run.forecast, _ = forecast(ctx, app.Simulator.Snapshot())
	}
	run.info.ExpiresAt = m.expiryLocked(run)
	run.nextTick = now.Add(time.Duration(interval) * time.Millisecond)
	return run, nil
}

// CreateAndStart atomically reserves all quotas, then initializes the engine
// outside the manager lock. A pending idempotency key serializes retries.
func (m *Manager) CreateAndStart(ctx context.Context, req CreateRequest, key, actor string) (Metadata, error) {
	if len(key) < 16 || len(key) > 128 || strings.TrimSpace(key) != key {
		return Metadata{}, invalid()
	}
	for _, r := range key {
		if r < 33 || r > 126 {
			return Metadata{}, invalid()
		}
	}
	if err := m.validate(req); err != nil {
		return Metadata{}, err
	}
	raw, _ := json.Marshal(req)
	fingerprint := sha256.Sum256(raw)
	scopeHash := sha256.Sum256([]byte(actor + "\x00" + key))
	scope := hex.EncodeToString(scopeHash[:])
	m.mu.Lock()
	if entry, ok := m.idempotency[scope]; ok {
		if entry.fingerprint != fingerprint {
			m.mu.Unlock()
			return Metadata{}, conflict()
		}
		m.mu.Unlock()
		select {
		case <-ctx.Done():
			return Metadata{}, ctx.Err()
		case <-entry.ready:
		}
		if entry.err != nil {
			return Metadata{}, entry.err
		}
		info, err := m.Get(entry.id, entry.token)
		if err == nil {
			info.AccessToken = entry.token
		}
		return info, err
	}
	if m.closed || m.active >= m.options.MaxActive || req.GraphProfile == "FULL_MANTA" && m.full >= m.options.MaxFullActive || len(m.sessions)+m.pending >= m.options.MaxRetained || m.metrics.EstimatedMemoryBytes+reservation(req.GraphProfile) > m.options.MaxMemoryBytes {
		m.metrics.Rejected++
		m.mu.Unlock()
		m.options.Logger.Warn("simulation_capacity_rejected", "scenario", req.Scenario, "graph", req.GraphProfile)
		return Metadata{}, unavailable()
	}
	entry := &idempotencyEntry{fingerprint: fingerprint, ready: make(chan struct{})}
	m.idempotency[scope] = entry
	m.active++
	m.pending++
	if req.GraphProfile == "FULL_MANTA" {
		m.full++
	}
	m.metrics.EstimatedMemoryBytes += reservation(req.GraphProfile)
	// Add before unlocking: Close must wait for in-flight initialization too.
	m.wg.Add(1)
	m.mu.Unlock()
	run, err := m.prepare(req)
	token := ""
	if err == nil {
		token, err = randomSecret(32)
	}
	m.mu.Lock()
	m.pending--
	if err != nil || m.closed || ctx.Err() != nil {
		m.active--
		if req.GraphProfile == "FULL_MANTA" {
			m.full--
		}
		m.metrics.EstimatedMemoryBytes -= reservation(req.GraphProfile)
		if err == nil {
			err = unavailable()
		}
		entry.err = err
		delete(m.idempotency, scope)
		close(entry.ready)
		m.mu.Unlock()
		if run != nil {
			run.cancel()
			_ = run.app.Close()
		}
		m.wg.Done()
		return Metadata{}, err
	}
	run.tokenHash = sha256.Sum256([]byte(token))
	run.idempotency = scope
	m.sessions[run.info.SimulationID] = run
	// Publication references the successful existing execution; retries never republish.
	m.published[run.info.Scenario] = run.info.SimulationID
	entry.id, entry.token = run.info.SimulationID, token
	close(entry.ready)
	info := run.info.clone()
	info.AccessToken = token
	m.mu.Unlock()
	m.event("simulation_created", info)
	m.event("simulation_started", info)
	go m.run(run)
	return info, nil
}

func (m *Manager) event(name string, i Metadata) {
	// Logging is ancillary; a faulty custom handler cannot stop a simulation.
	defer func() { _ = recover() }()
	m.options.Logger.Info(name, "simulation_id", i.SimulationID, "scenario", i.Scenario, "graph", i.GraphProfile, "status", i.Status, "tick", i.Tick, "duration_ms", m.options.Clock.Now().Sub(i.StartedAt).Milliseconds())
}

func (m *Manager) expiryLocked(s *execution) time.Time {
	if terminal(s.info.Status) && s.info.EndedAt != nil {
		return s.info.EndedAt.Add(m.options.CompletedTTL)
	}
	exp := s.lastAccess.Add(m.options.IdleTTL)
	if s.info.Status == Paused {
		exp = s.pausedAt.Add(m.options.PausedTTL)
	}
	wall := s.info.CreatedAt.Add(m.options.MaxWallTime)
	if wall.Before(exp) {
		exp = wall
	}
	return exp
}

func (m *Manager) lookup(id, token string, touch bool) (*execution, error) {
	hash := sha256.Sum256([]byte(token))
	m.mu.Lock()
	s, ok := m.sessions[id]
	dead, wasExpired := m.expired[id]
	m.mu.Unlock()
	if !ok {
		if wasExpired && subtle.ConstantTimeCompare(hash[:], dead.hash[:]) == 1 {
			return nil, &Error{410, "EXPIRED", "La sesión ha caducado."}
		}
		return nil, &Error{404, "NOT_FOUND", "La simulación no está disponible."}
	}
	if token == "" || subtle.ConstantTimeCompare(hash[:], s.tokenHash[:]) != 1 {
		return nil, &Error{401, "UNAUTHORIZED", "Credencial de simulación no válida."}
	}
	now := m.options.Clock.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.expired || !now.Before(m.expiryLocked(s)) {
		return nil, &Error{410, "EXPIRED", "La sesión ha caducado."}
	}
	if touch && !terminal(s.info.Status) {
		s.lastAccess = now
		s.info.ExpiresAt = m.expiryLocked(s)
	}
	return s, nil
}

func (m *Manager) Get(id, token string) (Metadata, error) {
	s, err := m.lookup(id, token, true)
	if err != nil {
		return Metadata{}, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.info.clone(), nil
}

func (m *Manager) GetSnapshot(id, token string, results bool) (State, error) {
	s, err := m.lookup(id, token, true)
	if err != nil {
		return State{}, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	if results && !terminal(s.info.Status) {
		return State{}, conflict()
	}
	return snapshotLocked(s, results), nil
}

// snapshotLocked copies only observable dynamic state; callers hold s.mu.
func snapshotLocked(s *execution, results bool) State {
	w := s.snapshot.Clone()
	w.Graph = nil
	state := State{Metadata: s.info.clone(), Snapshot: w, ScenarioState: w.Scenario, RunnerForecast: s.forecast.clone()}
	if results {
		r := &Results{Analytics: s.analytics.clone(), InitialSurvivors: s.info.Config.Survivors, Evacuated: w.Metrics.Evacuated, Bitten: w.Metrics.Bitten, Active: w.Metrics.Active}
		if r.InitialSurvivors > 0 {
			r.SurvivalRate = float64(r.InitialSurvivors-r.Bitten) / float64(r.InitialSurvivors)
		}
		for _, sh := range w.Shelters {
			if sh.Occupancy > 0 {
				r.RefugesUsed++
			}
		}
		state.Results = r
	}
	return state
}

func (m *Manager) Control(id, token, action string) (Metadata, error) {
	s, err := m.lookup(id, token, true)
	if err != nil {
		return Metadata{}, err
	}
	s.op.Lock()
	locked := true
	defer func() {
		if locked {
			s.op.Unlock()
		}
	}()
	s.mu.Lock()
	now := m.options.Clock.Now()
	if s.expired || !now.Before(m.expiryLocked(s)) {
		s.mu.Unlock()
		return Metadata{}, &Error{410, "EXPIRED", "La sesión ha caducado."}
	}
	changed := false
	switch action {
	case "pause":
		if s.info.Status == Running {
			s.remaining = s.nextTick.Sub(now)
			if s.remaining < 0 {
				s.remaining = 0
			}
			s.info.Status = Paused
			s.pausedAt = now
			changed = true
		} else if s.info.Status != Paused {
			s.mu.Unlock()
			return Metadata{}, conflict()
		}
	case "resume":
		if s.info.Status == Paused {
			s.nextTick = now.Add(s.remaining)
			s.info.Status = Running
			s.lastAccess = now
			changed = true
		} else if s.info.Status != Running {
			s.mu.Unlock()
			return Metadata{}, conflict()
		}
	case "cancel":
		if !terminal(s.info.Status) {
			s.info.Status = Cancelled
			s.info.EndedAt = &now
			s.cancel()
			changed = true
		} else if s.info.Status != Cancelled {
			s.mu.Unlock()
			return Metadata{}, conflict()
		}
	default:
		s.mu.Unlock()
		return Metadata{}, invalid()
	}
	if changed {
		s.info.StateVersion++
		s.info.UpdatedAt = now
		s.info.ExpiresAt = m.expiryLocked(s)
	}
	i := s.info.clone()
	s.mu.Unlock()
	if changed {
		select {
		case s.wake <- struct{}{}:
		default:
		}
		event := map[string]string{"pause": "simulation_paused", "resume": "simulation_resumed", "cancel": "simulation_cancelled"}[action]
		m.event(event, i)
	}
	if action == "cancel" {
		s.op.Unlock()
		locked = false
		<-s.done
	}
	return i, nil
}

func (m *Manager) Restart(ctx context.Context, id, token, key, actor string) (Metadata, error) {
	i, err := m.Get(id, token)
	if err != nil {
		return Metadata{}, err
	}
	if !terminal(i.Status) {
		return Metadata{}, conflict()
	}
	s, err := m.lookup(id, token, false)
	if err != nil {
		return Metadata{}, err
	}
	<-s.done // release the previous engine reservation before reserving restart
	req := CreateRequest{Scenario: i.Scenario, GraphProfile: i.GraphProfile, Seed: &i.Seed, MaxTicks: &i.MaxTicks, TickIntervalMS: &i.TickIntervalMS, Config: InputConfig{Survivors: &i.Config.Survivors, Round: i.Config.Round, RefugeIDs: i.Config.RefugeIDs, CustomShelters: i.Config.CustomShelters, RainfallIntensity: i.Config.RainfallIntensity, Mode: i.Config.Mode, ZombiePolicy: i.Config.ZombiePolicy, EvacuationAlgorithm: i.Config.EvacuationAlgorithm, Pro: replayPro(i.Config.Pro)}}
	if i.Config.Mode == "official" {
		req.Config.RefugeIDs = nil
	}
	return m.CreateAndStart(ctx, req, key, actor+"/restart/"+id)
}

func (m *Manager) Stats() Metrics {
	m.mu.Lock()
	defer m.mu.Unlock()
	v := m.metrics
	v.Active = m.active
	v.Retained = len(m.sessions)
	return v
}
