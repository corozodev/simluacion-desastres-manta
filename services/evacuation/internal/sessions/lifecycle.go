package sessions

import (
	"corodev/evacuation/internal/decision"
	"time"

	"corodev/evacuation/internal/world"
)

func (m *Manager) run(s *execution) {
	defer m.wg.Done()
	defer close(s.done)
	defer func() {
		if recover() != nil {
			s.mu.Lock()
			now := m.options.Clock.Now()
			s.info.Status = Failed
			s.info.EndedAt = &now
			s.info.UpdatedAt = now
			s.info.StateVersion++
			s.info.ExpiresAt = m.expiryLocked(s)
			info := s.info.clone()
			s.mu.Unlock()
			m.mu.Lock()
			m.metrics.EngineErrors++
			m.mu.Unlock()
			m.event("simulation_failed", info)
		}
		// Terminal sessions retain only compact observable state, not HTTP
		// listeners, decision caches, diagnostics, PRNGs or mutable engines.
		if s.app != nil {
			report := PublicAnalytics(s.app.Simulator.Diagnostics())
			s.mu.Lock()
			report.Prediction = s.audit.Quality
			s.analytics = report
			s.mu.Unlock()
		}
		s.cancel()
		_ = s.app.Close()
		s.app = nil
		m.mu.Lock()
		m.active--
		if s.info.GraphProfile == "FULL_MANTA" {
			m.full--
		}
		retained := int64(1 << 20)
		if s.info.GraphProfile == "FULL_MANTA" {
			retained = 8 << 20
		}
		if _, ok := m.sessions[s.info.SimulationID]; !ok {
			retained = 0
		}
		m.metrics.EstimatedMemoryBytes += retained - s.reserved
		s.reserved = retained
		s.engineReleased = true
		m.metrics.ExecutionDurationMS += float64(m.options.Clock.Now().Sub(s.info.StartedAt)) / float64(time.Millisecond)
		m.mu.Unlock()
	}()
	for {
		s.mu.RLock()
		status := s.info.Status
		remaining := s.nextTick.Sub(m.options.Clock.Now())
		if remaining < 0 {
			remaining = 0
		}
		s.mu.RUnlock()
		if terminal(status) {
			return
		}
		if status == Paused {
			select {
			case <-s.ctx.Done():
				return
			case <-s.wake:
				continue
			}
		}
		timer := m.options.Clock.NewTimer(remaining)
		select {
		case <-s.ctx.Done():
			timer.Stop()
			return
		case <-s.wake:
			timer.Stop()
			continue
		case <-timer.C():
		}
		started := time.Now()
		info, performed := m.advanceTurn(s)
		if !performed {
			continue
		}
		m.mu.Lock()
		m.metrics.Turns++
		m.metrics.TurnDurationMS += float64(time.Since(started)) / float64(time.Millisecond)
		if info.Status == Completed {
			m.metrics.Completed++
		}
		if info.Status == Failed {
			m.metrics.EngineErrors++
		}
		m.mu.Unlock()
		if info.Status == Completed {
			m.event("simulation_completed", info)
		} else if info.Status == Failed {
			m.event("simulation_failed", info)
		}
	}
}

// Always release the command/turn lock, including engine panics recovered by
// run. Readers continue seeing the previous complete published snapshot.
func (m *Manager) advanceTurn(s *execution) (Metadata, bool) {
	s.op.Lock()
	defer s.op.Unlock()
	s.mu.RLock()
	status := s.info.Status
	s.mu.RUnlock()
	if status != Running {
		return Metadata{}, false
	}
	before := s.app.Simulator.Snapshot()
	var predicted decision.ProbabilityPrediction
	enabled := s.info.Scenario == "zombie_outbreak" && s.info.Config.Pro != nil && s.info.Config.Pro.RunnerPrediction
	if enabled {
		_, predicted = forecast(s.ctx, before)
	}
	err := s.app.Simulator.Step(s.ctx)
	var nextForecast *RunnerForecast
	if enabled {
		after := s.app.Simulator.Snapshot()
		s.audit.observe(predicted, after)
		nextForecast, _ = forecast(s.ctx, after)
	}
	var analytics *Analytics
	if err != nil || before.Turn+1 >= s.info.MaxTicks {
		analytics = PublicAnalytics(s.app.Simulator.Diagnostics())
		analytics.Prediction = s.audit.Quality
	}
	snap, _ := s.app.Store.LoadCompact()
	now := m.options.Clock.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.snapshot = snap
	s.forecast = nextForecast
	if analytics != nil {
		s.analytics = analytics
	}
	s.info.Tick = snap.Turn
	s.info.StateVersion++
	s.info.UpdatedAt = now
	s.nextTick = now.Add(time.Duration(s.info.TickIntervalMS) * time.Millisecond)
	if err != nil {
		if !terminal(s.info.Status) {
			s.info.Status = Failed
			s.info.EndedAt = &now
		}
	} else if s.info.Tick >= s.info.MaxTicks {
		s.info.Status = Completed
		s.info.EndedAt = &now
	}
	s.info.ExpiresAt = m.expiryLocked(s)
	return s.info.clone(), true
}

// Cleanup applies lifecycle deadlines without extending them. Authentication is
// checked before clients may refresh idle deadlines; paused TTL is absolute.
func (m *Manager) Cleanup() {
	now := m.options.Clock.Now()
	m.mu.Lock()
	items := make([]*execution, 0, len(m.sessions))
	for _, s := range m.sessions {
		items = append(items, s)
	}
	for id, t := range m.expired {
		if !now.Before(t.expires) {
			delete(m.expired, id)
		}
	}
	for id, b := range m.rates {
		if now.Sub(b.window) >= time.Minute {
			delete(m.rates, id)
		}
	}
	m.mu.Unlock()
	for _, s := range items {
		s.mu.RLock()
		expired := !now.Before(m.expiryLocked(s))
		s.mu.RUnlock()
		if !expired {
			continue
		}
		s.op.Lock()
		s.mu.Lock()
		if now.Before(m.expiryLocked(s)) {
			s.mu.Unlock()
			s.op.Unlock()
			continue
		}
		s.expired = true
		if !terminal(s.info.Status) {
			s.info.Status = Cancelled
			s.info.EndedAt = &now
			s.info.UpdatedAt = now
			s.info.StateVersion++
		}
		s.cancel()
		info := s.info.clone()
		s.mu.Unlock()
		m.mu.Lock()
		if _, ok := m.sessions[info.SimulationID]; ok {
			delete(m.sessions, info.SimulationID)
			delete(m.idempotency, s.idempotency)
			m.expired[info.SimulationID] = tombstone{hash: s.tokenHash, expires: now.Add(m.options.CompletedTTL)}
			// A bounded tombstone permits authenticated 410 responses without
			// retaining snapshots or leaking past identifiers indefinitely.
			for len(m.expired) > m.options.MaxRetained*4 {
				var oldest string
				var expiry time.Time
				for id, t := range m.expired {
					if oldest == "" || t.expires.Before(expiry) {
						oldest, expiry = id, t.expires
					}
				}
				delete(m.expired, oldest)
			}
			if s.engineReleased {
				m.metrics.EstimatedMemoryBytes -= s.reserved
				s.reserved = 0
			}
		}
		m.mu.Unlock()
		s.op.Unlock()
		m.event("simulation_expired", info)
	}
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
	m.wg.Wait()
	m.mu.Lock()
	// Closed managers serve no more sessions and retain no engine snapshots.
	for _, s := range m.sessions {
		s.mu.Lock()
		s.snapshot = world.WorldSnapshot{}
		s.mu.Unlock()
	}
	m.sessions = map[string]*execution{}
	m.idempotency = map[string]*idempotencyEntry{}
	m.rates = map[string]rateBucket{}
	m.expired = map[string]tombstone{}
	m.metrics.EstimatedMemoryBytes = 0
	m.mu.Unlock()
	return nil
}
