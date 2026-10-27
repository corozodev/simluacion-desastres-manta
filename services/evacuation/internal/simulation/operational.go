package simulation

// Operational timings are kept outside deterministic world snapshots. Reads use
// the same writer mutex and perform no network or disk operation.
type OperationalStats struct {
	SimulationStep   int     `json:"simulation_step"`
	WorldVersion     uint64  `json:"world_version"`
	Agents           int     `json:"agents"`
	Edges            int     `json:"edges"`
	OverlayEdges     int     `json:"overlay_edges"`
	OverlayUpdateMS  float64 `json:"overlay_update_ms"`
	ReplanningMS     float64 `json:"replanning_ms"`
	SimulationStepMS float64 `json:"simulation_step_ms"`
	PlanningCalls    uint64  `json:"planning_calls"`
}

func (s *Simulator) OperationalStats() OperationalStats {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := OperationalStats{SimulationStep: s.turn, WorldVersion: s.version, Agents: len(s.survivors), Edges: len(s.graph.Edges)}
	if f, ok := s.scenario.(*urbanFloodScenario); ok {
		out.OverlayEdges = len(f.roads)
		out.OverlayUpdateMS = f.overlayMS
		out.ReplanningMS = f.planningMS
		out.SimulationStepMS = f.performance.SimulationStepLatencyMS
		out.PlanningCalls = f.planningCalls
	}
	return out
}
