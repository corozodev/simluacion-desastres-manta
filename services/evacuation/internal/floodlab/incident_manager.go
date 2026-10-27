package floodlab

import (
	"context"

	"corodev/evacuation/internal/incidents"
	"corodev/evacuation/internal/simulation"
)

type IncidentApplyResult struct {
	Incident       incidents.Incident    `json:"incident"`
	Application    incidents.Application `json:"application"`
	State          State                 `json:"state"`
	AlreadyApplied bool                  `json:"already_applied"`
}

// SetIncidentStore shares the observation repository, never a simulation world.
// The caller owns its lifetime and must close Managers before closing the Store.
func (m *Manager) SetIncidentStore(store *incidents.Store) error {
	m.opMu.Lock()
	defer m.opMu.Unlock()
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed || m.incidentStore != nil {
		return ErrState
	}
	m.incidentStore = store
	return nil
}
func (m *Manager) incidents() *incidents.Store {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.incidentStore
}

func (m *Manager) ReviewIncident(id string, input incidents.StatusUpdate) (incidents.Incident, error) {
	m.opMu.Lock()
	defer m.opMu.Unlock()
	store := m.incidents()
	if store == nil {
		return incidents.Incident{}, incidents.ErrUnavailable
	}
	return store.Review(id, input)
}

func (m *Manager) ApplyIncident(ctx context.Context, id string, input incidents.ApplyRequest) (IncidentApplyResult, error) {
	if !incidents.ValidID(id) || !incidents.ValidID(input.ExpectedRunID) || input.DurationSteps < 1 || input.DurationSteps > 10000 || !input.ExperimentalAck || (input.Effect != "blocked" && input.Effect != "caution") {
		return IncidentApplyResult{}, incidents.ErrInvalid
	}
	m.opMu.Lock()
	defer m.opMu.Unlock()
	m.mu.RLock()
	store, current, run, closed := m.incidentStore, m.state.clone(), m.current, m.closed
	m.mu.RUnlock()
	if store == nil {
		return IncidentApplyResult{}, incidents.ErrUnavailable
	}
	if closed {
		return IncidentApplyResult{}, ErrState
	}
	if current.RunID != input.ExpectedRunID {
		return IncidentApplyResult{}, ErrChanged
	}
	incident, err := store.Get(id)
	if err != nil {
		return IncidentApplyResult{}, err
	}
	previous, exists, err := store.Application(current.RunID, id)
	if err != nil {
		return IncidentApplyResult{}, err
	}
	if exists {
		if previous.Effect != input.Effect || previous.ExpiresAtSimulationStep-previous.SimulationStep-1 != input.DurationSteps {
			return IncidentApplyResult{}, incidents.ErrConflict
		}
		return IncidentApplyResult{incident, previous, current, true}, nil
	}
	if (current.State != "running" && current.State != "paused") || (current.Comparison != nil && current.Comparison.State == "running") {
		return IncidentApplyResult{}, ErrState
	}
	edges, err := store.ApplicationEdges(id, run.graph)
	if err != nil {
		return IncidentApplyResult{}, err
	}
	applicationID, err := incidents.NewID()
	if err != nil {
		return IncidentApplyResult{}, incidents.ErrUnavailable
	}
	var receipt incidents.Application
	_, err = run.app.Simulator.ApplyExperimentalRoadOverlay(ctx, simulation.ExperimentalRoadOverlay{IncidentID: id, EdgeIDs: edges, Effect: input.Effect, DurationSteps: input.DurationSteps}, func(result simulation.OverlayResult) error {
		candidate := incidents.Application{ApplicationID: applicationID, IncidentID: id, RunID: current.RunID, AffectedEdgeIDs: edges, SimulationStep: result.SimulationStep, WorldVersion: result.WorldVersion, ExpiresAtSimulationStep: result.ExpiresAtSimulationStep, Effect: input.Effect}
		var saveErr error
		receipt, saveErr = store.RecordApplication(candidate)
		return saveErr
	})
	if err != nil {
		return IncidentApplyResult{}, err
	}
	w := run.app.Simulator.Snapshot()
	m.mu.Lock()
	m.state.Scenario, m.state.Shelters = w.Scenario, w.Shelters
	m.state.IncidentApplications = append(m.state.IncidentApplications, receipt.Clone())
	result := m.state.clone()
	m.mu.Unlock()
	return IncidentApplyResult{incident, receipt, result, false}, nil
}
