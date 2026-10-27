package simulation

import (
	"context"
	"fmt"
	"slices"
	"sort"

	"corodev/evacuation/internal/world"
)

// ExperimentalRoadOverlay is private lab input. It never changes Graph.Edges.
// Source provenance remains in the incident service's durable application log.
type ExperimentalRoadOverlay struct {
	IncidentID    string
	EdgeIDs       []string
	Effect        string
	DurationSteps int
}
type OverlayResult struct {
	SimulationStep          int
	WorldVersion            uint64
	ExpiresAtSimulationStep int
}
type appliedOverlay struct {
	input  ExperimentalRoadOverlay
	result OverlayResult
}

// ApplyExperimentalRoadOverlay is a single-writer transaction with a durable
// barrier supplied by the lab. Validation and disk failures change no routes,
// clock, agents, PRNG state or world version. Only urban_flood accepts it.
func (s *Simulator) ApplyExperimentalRoadOverlay(ctx context.Context, input ExperimentalRoadOverlay, beforePublish func(OverlayResult) error) (OverlayResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return OverlayResult{}, err
	}
	f, ok := s.scenario.(*urbanFloodScenario)
	if !ok || input.IncidentID == "" || len(input.IncidentID) > 80 || len(input.EdgeIDs) < 1 || len(input.EdgeIDs) > 5 || input.DurationSteps < 1 || input.DurationSteps > 10000 || (input.Effect != "blocked" && input.Effect != "caution") || s.turn >= s.config.Turns || beforePublish == nil {
		return OverlayResult{}, fmt.Errorf("invalid experimental urban_flood overlay")
	}
	input.EdgeIDs = append([]string{}, input.EdgeIDs...)
	sort.Strings(input.EdgeIDs)
	for i, id := range input.EdgeIDs {
		found := false
		for _, e := range s.graph.Edges {
			if e.ID == id {
				found = true
				break
			}
		}
		if !found || i > 0 && id == input.EdgeIDs[i-1] {
			return OverlayResult{}, fmt.Errorf("overlay requires distinct existing road edges")
		}
	}
	if previous, exists := f.appliedIncidents[input.IncidentID]; exists {
		if previous.input.Effect != input.Effect || previous.input.DurationSteps != input.DurationSteps || !slices.Equal(previous.input.EdgeIDs, input.EdgeIDs) {
			return OverlayResult{}, fmt.Errorf("incident already applied with different parameters")
		}
		return previous.result, nil
	}
	if len(f.appliedIncidents) >= 10000 {
		return OverlayResult{}, fmt.Errorf("experimental application limit reached")
	}
	result := OverlayResult{SimulationStep: s.turn, WorldVersion: s.version + 1, ExpiresAtSimulationStep: s.turn + input.DurationSteps + 1}
	if err := beforePublish(result); err != nil {
		return OverlayResult{}, err
	}
	entry := appliedOverlay{input: input, result: result}
	f.appliedIncidents[input.IncidentID] = entry
	f.activeIncidents[input.IncidentID] = entry
	for _, id := range input.EdgeIDs {
		f.tracked[id] = true
	}
	f.updateOverlay(s)
	s.version++
	events := []world.Event{}
	for _, id := range input.EdgeIDs {
		events = append(events, world.Event{Turn: s.turn, Type: "experimental_incident_applied", EdgeID: id, EntityID: input.IncidentID, Message: "Declared incident explicitly applied to this experimental run"})
	}
	// Once persisted, finish publishing even if the HTTP caller disconnects.
	// The retried request recovers the same durable receipt.
	s.prepare(context.Background(), events)
	s.publish(events)
	return result, nil
}

func (f *urbanFloodScenario) expireIncidents(s *Simulator) {
	for id, entry := range f.activeIncidents {
		if s.turn >= entry.result.ExpiresAtSimulationStep {
			delete(f.activeIncidents, id)
		}
	}
}
