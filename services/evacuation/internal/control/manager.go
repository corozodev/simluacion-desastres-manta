// Package control serializes run transitions around the unchanged simulator.
package control

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"corodev/evacuation/internal/application"
	"corodev/evacuation/internal/catalog"
	"corodev/evacuation/internal/coordination"
	"corodev/evacuation/internal/decision"
	"corodev/evacuation/internal/world"
)

const HistoryLimit = 10

var (
	ErrActive   = errors.New("another round is active or starting")
	ErrChanged  = errors.New("the selected run changed")
	ErrDisabled = errors.New("preset disabled")
	ErrInvalid  = errors.New("invalid approved configuration")
)

type StartRequest struct {
	Mode          string `json:"mode"`
	Round         string `json:"round"`
	Seed          int64  `json:"seed"`
	ExpectedRunID string `json:"expected_run_id"`
}

type Options struct {
	APIKey    string
	Origins   []string
	Logger    *slog.Logger
	Engine    decision.Options
	Interval  time.Duration
	Round     string
	Seed      *int64
	AutoStart bool
	Admin     AdminOptions
}

type execution struct {
	mu       sync.RWMutex
	info     world.SimulationInfo
	app      *application.App
	operator string
}

func (r *execution) metadata() *world.SimulationInfo {
	r.mu.RLock()
	defer r.mu.RUnlock()
	v := r.info
	return &v
}

type savedRun struct {
	info     world.SimulationInfo
	snapshot world.WorldSnapshot
}

type Manager struct {
	mu       sync.RWMutex
	catalog  *catalog.Catalog
	options  Options
	current  *execution
	history  []savedRun
	starting bool
	closed   bool
	ctx      context.Context
	cancel   context.CancelFunc
	wg       sync.WaitGroup
	auth     *sessions
}

func randomID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}

func New(c *catalog.Catalog, options Options) (*Manager, error) {
	if c == nil || options.APIKey == "" || options.Interval < 0 {
		return nil, ErrInvalid
	}
	if options.Round == "" {
		options.Round = "round1"
	}
	if options.Logger == nil {
		options.Logger = slog.New(slog.NewJSONHandler(io.Discard, nil))
	}
	options.Origins = append([]string{}, options.Origins...)
	auth, err := newSessions(options.Admin, options.Origins)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	m := &Manager{catalog: c, options: options, ctx: ctx, cancel: cancel, auth: auth}
	if !m.independentAdminKey() {
		cancel()
		return nil, errors.New("operator access must be independent of the movement key")
	}
	run, err := m.prepare("competition", options.Round, options.Seed, "system")
	if err != nil {
		cancel()
		return nil, err
	}
	m.current = run
	if options.AutoStart {
		m.launch(run)
	}
	return m, nil
}

func (m *Manager) prepare(mode, round string, seed *int64, operator string) (*execution, error) {
	cfg, err := m.catalog.Config(mode, round, seed)
	if err != nil {
		return nil, ErrInvalid
	}
	g, err := m.catalog.Graph(mode)
	if err != nil {
		return nil, ErrInvalid
	}
	id, err := randomID()
	if err != nil {
		return nil, err
	}
	run := &execution{operator: operator, info: world.SimulationInfo{RunID: id, Mode: mode, Round: round, State: "idle", Seed: cfg.Seed, GraphVersion: g.Version, TurnLimit: cfg.Turns, IntervalMS: m.options.Interval.Milliseconds()}}
	engine := decision.NewWithOptions(m.options.Engine)
	app, err := application.NewWithOptions(g, cfg, "127.0.0.1:0", m.options.APIKey, m.options.Origins, m.options.Logger, application.Options{Engine: engine, Planner: coordination.New(engine, coordination.Options{}), Metadata: run.metadata})
	if err != nil {
		return nil, err
	}
	run.app = app
	return run, nil
}

// launch is called while transitions are serialized. Each run has its own store,
// engine, caches, planner and private loopback HTTP client.
func (m *Manager) launch(run *execution) {
	run.mu.Lock()
	run.info.State = "running"
	run.info.StartedAt = time.Now().UTC().Format(time.RFC3339Nano)
	info := run.info
	run.mu.Unlock()
	m.options.Logger.Info("simulation.run_started", "timestamp", info.StartedAt, "operator", run.operator, "run_id", info.RunID, "graph", info.Mode, "graph_version", info.GraphVersion, "round", info.Round, "seed", info.Seed, "turns", info.TurnLimit, "interval_ms", info.IntervalMS)
	m.wg.Add(1)
	go func() {
		defer m.wg.Done()
		err := run.app.Simulator.Run(m.ctx, info.TurnLimit, m.options.Interval)
		snapshot := run.app.Simulator.Snapshot()
		m.mu.Lock()
		run.mu.Lock()
		run.info.EndedAt = time.Now().UTC().Format(time.RFC3339Nano)
		if err != nil {
			run.info.State = "failed"
			run.info.Failure = "La ejecución se interrumpió; se conserva el último estado observable."
		} else {
			run.info.State = "finished"
		}
		final := run.info
		run.mu.Unlock()
		snapshot.Graph = nil
		snapshot.Simulation = &final
		m.history = append(m.history, savedRun{info: final, snapshot: snapshot})
		if len(m.history) > HistoryLimit {
			m.history = append([]savedRun{}, m.history[len(m.history)-HistoryLimit:]...)
		}
		m.mu.Unlock()
		m.options.Logger.Info("simulation.run_finished", "timestamp", final.EndedAt, "operator", run.operator, "run_id", final.RunID, "graph", final.Mode, "round", final.Round, "state", final.State, "metrics", snapshot.Metrics)
	}()
}

func (m *Manager) Info() world.SimulationInfo {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return *m.current.metadata()
}

func (m *Manager) Start(req StartRequest, operator string) (world.SimulationInfo, error) {
	if operator == "" || req.Seed < -9007199254740991 || req.Seed > 9007199254740991 {
		return world.SimulationInfo{}, ErrInvalid
	}
	preset, ok := m.catalog.Preset(req.Mode)
	if !ok {
		return world.SimulationInfo{}, ErrInvalid
	}
	if !preset.Enabled {
		return world.SimulationInfo{}, ErrDisabled
	}
	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		return world.SimulationInfo{}, ErrInvalid
	}
	old := m.current
	info := old.metadata()
	if m.starting || info.State == "running" || info.State == "starting" {
		m.mu.Unlock()
		return world.SimulationInfo{}, ErrActive
	}
	if req.ExpectedRunID != info.RunID {
		m.mu.Unlock()
		return world.SimulationInfo{}, ErrChanged
	}
	m.starting = true
	m.mu.Unlock()
	candidate, err := m.prepare(req.Mode, req.Round, &req.Seed, operator)
	m.mu.Lock()
	m.starting = false
	if err != nil || m.closed {
		m.mu.Unlock()
		if candidate != nil {
			_ = candidate.app.Close()
		}
		if err == nil {
			err = ErrInvalid
		}
		return world.SimulationInfo{}, err
	}
	m.current = candidate
	m.launch(candidate)
	result := *candidate.metadata()
	m.mu.Unlock()
	// Old completed state was saved by the finishing run; old observations already
	// in flight retain their application reference and immutable snapshot.
	_ = old.app.Close()
	return result, nil
}

func (m *Manager) saved(id string) (world.WorldSnapshot, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, r := range m.history {
		if r.info.RunID == id {
			return r.snapshot.Clone(), true
		}
	}
	return world.WorldSnapshot{}, false
}

func (m *Manager) Close() error {
	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		return nil
	}
	m.closed = true
	m.cancel()
	app := m.current.app
	m.mu.Unlock()
	m.wg.Wait()
	return app.Close()
}

func (m *Manager) activeHandler(w http.ResponseWriter, r *http.Request) {
	m.mu.RLock()
	current := m.current
	info := current.metadata()
	m.mu.RUnlock()
	if expected := r.URL.Query().Get("run_id"); expected != "" && expected != info.RunID {
		writeError(w, 409, "RUN_CHANGED", "La ronda cambió; recupera el estado actual.")
		return
	}
	current.app.ServeHTTP(w, r)
}
