package floodlab

import (
	"context"
	"fmt"
	"time"
)

func (m *Manager) Compare(req RunRequest) (State, error) {
	m.opMu.Lock()
	defer m.opMu.Unlock()
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
	// Validate and freeze the custom cohort before acknowledging the job. A
	// malformed selection never launches one half of a misleading comparison.
	custom, err := m.prepare(req.Config)
	if err != nil {
		return State{}, err
	}
	id, err := randomID()
	if err != nil {
		_ = custom.app.Close()
		return State{}, err
	}
	m.stopComparison()
	ctx, cancel := context.WithCancel(m.ctx)
	done := make(chan struct{})
	m.mu.Lock()
	if m.state.State == "running" || m.state.State == "idle" {
		m.state.State = "paused"
		m.state.RuntimeElapsedMS = runtimeElapsed(m.current, true)
	}
	m.state.Comparison = &Comparison{ID: id, State: "running", Message: "Ejecutando A: cuatro candidatos originales.", Results: []ComparisonResult{}}
	m.compareCancel, m.compareDone = cancel, done
	result := m.state.clone()
	m.mu.Unlock()
	m.signal()
	m.wg.Add(1)
	go func() {
		defer m.wg.Done()
		defer close(done)
		defer custom.app.Close()
		originalConfig := cloneConfig(req.Config)
		originalConfig.Shelters = originalCandidates(m.graphs[originalConfig.Mode])
		original, err := m.prepare(originalConfig)
		if err != nil {
			m.comparisonFailed(id, ctx)
			return
		}
		defer original.app.Close()
		for i, entry := range []struct {
			strategy string
			run      *execution
		}{{"original", original}, {"custom", custom}} {
			measurement, err := measureComparison(ctx, entry.strategy, entry.run)
			if err != nil {
				m.comparisonFailed(id, ctx)
				return
			}
			m.mu.Lock()
			if m.state.Comparison != nil && m.state.Comparison.ID == id {
				m.state.Comparison.Results = append(m.state.Comparison.Results, measurement)
				m.state.Comparison.Progress = i + 1
				m.state.Comparison.Message = "Ejecutando B: cuatro candidatos personalizados."
				if i == 1 {
					m.state.Comparison.State = "finished"
					m.state.Comparison.Message = "Comparación terminada con los mismos agentes, orígenes y parámetros de amenaza."
				}
			}
			m.mu.Unlock()
		}
	}()
	return result, nil
}

func (m *Manager) comparisonFailed(id string, ctx context.Context) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.state.Comparison == nil || m.state.Comparison.ID != id {
		return
	}
	m.state.Comparison.State = "failed"
	m.state.Comparison.Message = "La comparación no pudo completarse; no se presentan resultados parciales como un A/B terminado."
	if ctx.Err() != nil {
		m.state.Comparison.Message = "La comparación fue cancelada al cambiar la ejecución."
	}
}

func measureComparison(ctx context.Context, strategy string, run *execution) (ComparisonResult, error) {
	var elapsed float64
	for step := 0; step < run.turns; step++ {
		if err := ctx.Err(); err != nil {
			return ComparisonResult{}, err
		}
		start := time.Now()
		if err := run.app.Simulator.Step(ctx); err != nil {
			return ComparisonResult{}, err
		}
		elapsed += float64(time.Since(start)) / float64(time.Millisecond)
		w := run.app.Simulator.Snapshot()
		if w.Metrics.Bitten != 0 || w.Metrics.RequestsInvalid != 0 || w.Metrics.RequestsTimeout != 0 {
			return ComparisonResult{}, fmt.Errorf("la comparación registró decisiones fallidas")
		}
		for _, sh := range w.Shelters {
			if sh.Occupancy+sh.Reserved > sh.Capacity {
				return ComparisonResult{}, fmt.Errorf("la comparación excedió capacidad")
			}
		}
	}
	w := run.app.Simulator.Snapshot()
	cfg := cloneConfig(run.config)
	cfg.Shelters = nil
	return ComparisonResult{Strategy: strategy, Mode: run.config.Mode, Seed: run.config.Seed, GraphVersion: run.graph.Version, TotalAgents: len(w.Survivors), EvacuatedPercentage: 100 * float64(w.Scenario.EvacuationMetrics.EvacuatedAgents) / float64(len(w.Survivors)), EvacuationMetrics: w.Scenario.EvacuationMetrics, StepLatencyMS: elapsed / float64(run.turns), OriginsHash: originsHash(run.origins), ConfigHash: digest(struct {
		Config     RunConfig
		ThreatHash string
	}{cfg, run.threatHash})}, nil
}
