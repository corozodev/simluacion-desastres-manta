package world

// ScenarioSnapshot is the observable urban-flood overlay. The immutable street
// graph remains available separately; exposure values are synthetic unitless
// indices, never water depths or certified safety thresholds.
type ScenarioSnapshot struct {
	ScenarioType       string                `json:"scenario_type"`
	SimulationStep     int                   `json:"simulation_step"`
	WorldVersion       uint64                `json:"world_version"`
	GraphVersion       string                `json:"graph_version"`
	SimulationTime     float64               `json:"simulation_time"`
	SimulationDuration float64               `json:"simulation_duration"`
	TimeStep           float64               `json:"time_step"`
	Rainfall           float64               `json:"rainfall"`
	FloodZones         []FloodZone           `json:"flood_zones"`
	RoadConditions     []RoadCondition       `json:"road_conditions"`
	ShelterConditions  []ShelterCondition    `json:"shelter_conditions"`
	Agents             []FloodAgent          `json:"agents"`
	EvacuationMetrics  EvacuationMetrics     `json:"evacuation_metrics"`
	Performance        SimulationPerformance `json:"performance"`
	DataProvenance     DataProvenance        `json:"data_provenance"`
}

type FloodZone struct {
	ID        string   `json:"id"`
	Center    GeoPoint `json:"center"`
	RadiusM   float64  `json:"radius_m"`
	Intensity float64  `json:"intensity"`
}

type RoadCondition struct {
	EdgeID                  string  `json:"edge_id"`
	State                   string  `json:"state"`
	RiskSource              string  `json:"risk_source"`
	RiskScore               float64 `json:"risk_score"`
	UpdatedAtSimulationStep int     `json:"updated_at_simulation_step"`
	CostMultiplier          float64 `json:"cost_multiplier"`
}

type ShelterCondition struct {
	ShelterID               string  `json:"shelter_id"`
	State                   string  `json:"state"`
	RiskScore               float64 `json:"risk_score"`
	UpdatedAtSimulationStep int     `json:"updated_at_simulation_step"`
}

type FloodAgent struct {
	ID              string   `json:"id"`
	CurrentNode     string   `json:"current_node"`
	State           string   `json:"state"`
	Behavior        string   `json:"behavior"`
	TargetShelterID string   `json:"target_shelter_id"`
	PlannedRoute    []string `json:"planned_route"`
	EvacuationTime  float64  `json:"evacuation_time,omitempty"`
}

// EvacuationMetrics describes simulation outcomes and its simulated clock.
// Process timing is kept separately because it is not a deterministic outcome.
type EvacuationMetrics struct {
	TotalAgents             int     `json:"total_agents"`
	EvacuatedAgents         int     `json:"evacuated_agents"`
	IsolatedAgents          int     `json:"isolated_agents"`
	WaitingAgents           int     `json:"waiting_agents"`
	AverageEvacuationTime   float64 `json:"average_evacuation_time"`
	BlockedEdges            int     `json:"blocked_edges"`
	CautionEdges            int     `json:"caution_edges"`
	SheltersAtCapacity      int     `json:"shelters_at_capacity"`
	RerouteCount            int     `json:"reroute_count"`
	SimulationTotalDuration float64 `json:"simulation_total_duration"`
}

type SimulationPerformance struct {
	SimulationStepLatencyMS   float64 `json:"simulation_step_latency_ms"`
	SimulationTotalDurationMS float64 `json:"simulation_total_duration_ms"`
}

type DataProvenance struct {
	GraphSource     string `json:"graph_source"`
	Model           string `json:"model"`
	ElevationSource string `json:"elevation_source"`
	Disclaimer      string `json:"disclaimer"`
}

// Clone owns every mutable slice, including each agent's planned route.
func (s *ScenarioSnapshot) Clone() *ScenarioSnapshot {
	if s == nil {
		return nil
	}
	copy := *s
	copy.FloodZones = append([]FloodZone{}, s.FloodZones...)
	copy.RoadConditions = append([]RoadCondition{}, s.RoadConditions...)
	copy.ShelterConditions = append([]ShelterCondition{}, s.ShelterConditions...)
	copy.Agents = append([]FloodAgent{}, s.Agents...)
	for i := range copy.Agents {
		copy.Agents[i].PlannedRoute = append([]string{}, s.Agents[i].PlannedRoute...)
	}
	return &copy
}

// ShelterUnavailable excludes flood-exposed or inaccessible destinations without
// changing their original capacity or the occupancy of already evacuated agents.
func ShelterUnavailable(w WorldSnapshot, id string) bool {
	if w.Scenario == nil {
		return false
	}
	for _, shelter := range w.Scenario.ShelterConditions {
		if shelter.ShelterID == id {
			return shelter.State == "exposed" || shelter.State == "inaccessible"
		}
	}
	return false
}

// AgentWaiting identifies scenario-directed waiting without changing the shared
// survivor status enum or the historical zombie behavior.
func AgentWaiting(w WorldSnapshot, id string) bool {
	if w.Scenario == nil {
		return false
	}
	for _, agent := range w.Scenario.Agents {
		if agent.ID == id {
			return agent.State == "waiting"
		}
	}
	return false
}
