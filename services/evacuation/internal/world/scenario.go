package world

// ScenarioSnapshot is the observable urban-flood state. Street topology remains
// separate. Hydraulic depths are experimental model outputs over explicitly
// synthetic terrain; normalized road risk is neither depth nor certified safety.
type ScenarioSnapshot struct {
	Hydraulic          *HydraulicSnapshot    `json:"hydraulic,omitempty"`
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
	DepthM                  *float64 `json:"depth_m,omitempty"`
	EdgeID                  string   `json:"edge_id"`
	State                   string   `json:"state"`
	RiskSource              string   `json:"risk_source"`
	RiskScore               float64  `json:"risk_score"`
	UpdatedAtSimulationStep int      `json:"updated_at_simulation_step"`
	CostMultiplier          float64  `json:"cost_multiplier"`
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
	HydraulicStepLatencyMS    float64 `json:"hydraulic_step_latency_ms,omitempty"`
	EvacuationStepLatencyMS   float64 `json:"evacuation_step_latency_ms,omitempty"`
	SimulationStepLatencyMS   float64 `json:"simulation_step_latency_ms"`
	SimulationTotalDurationMS float64 `json:"simulation_total_duration_ms"`
}

type DataProvenance struct {
	GraphSource         string        `json:"graph_source"`
	Model               string        `json:"model"`
	ElevationSource     string        `json:"elevation_source"`
	Disclaimer          string        `json:"disclaimer"`
	GeographicReference *ReferenceUse `json:"geographic_reference,omitempty"`
}

// ReferenceUse records categorical official reference data and explicitly
// experimental weights. It never represents measured water or an active event.
type ReferenceZoneUse struct {
	ZoneID         string   `json:"zone_id"`
	Susceptibility string   `json:"susceptibility"`
	Factor         float64  `json:"factor"`
	FeatureIDs     []string `json:"feature_ids"`
}
type ReferenceUse struct {
	Category       string             `json:"category"`
	DatasetVersion string             `json:"dataset_version"`
	SourceURL      string             `json:"source_url"`
	ConsultedAt    string             `json:"consulted_at"`
	Strength       float64            `json:"strength"`
	Zones          []ReferenceZoneUse `json:"zones"`
}

func (r *ReferenceUse) Clone() *ReferenceUse {
	if r == nil {
		return nil
	}
	c := *r
	c.Zones = append([]ReferenceZoneUse{}, r.Zones...)
	for i := range c.Zones {
		c.Zones[i].FeatureIDs = append([]string{}, r.Zones[i].FeatureIDs...)
	}
	return &c
}

// Clone owns every mutable slice, including each agent's planned route.
func (s *ScenarioSnapshot) Clone() *ScenarioSnapshot {
	if s == nil {
		return nil
	}
	copy := *s
	if s.Hydraulic != nil {
		h := *s.Hydraulic
		h.DepthsM = append([]float64{}, h.DepthsM...)
		copy.Hydraulic = &h
	}
	copy.DataProvenance.GeographicReference = s.DataProvenance.GeographicReference.Clone()
	copy.FloodZones = append([]FloodZone{}, s.FloodZones...)
	copy.RoadConditions = append([]RoadCondition{}, s.RoadConditions...)
	for i := range copy.RoadConditions {
		if d := copy.RoadConditions[i].DepthM; d != nil {
			v := *d
			copy.RoadConditions[i].DepthM = &v
		}
	}
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

// HydraulicGrid is a compact regular-grid descriptor. Origin is the southwest
// cell corner; depths are row-major with rows increasing northward.
type HydraulicGrid struct {
	Origin    GeoPoint `json:"origin"`
	Rows      int      `json:"rows"`
	Cols      int      `json:"cols"`
	CellSizeM float64  `json:"cell_size_m"`
	LatStep   float64  `json:"lat_step"`
	LngStep   float64  `json:"lng_step"`
}

// HydraulicMassBalance accounts for surface storage only: infiltration and pipe
// drainage leave this model, while internal neighbour transfers cancel exactly.
type HydraulicMassBalance struct {
	InitialStorageM3 float64 `json:"initial_storage_m3"`
	RainfallM3       float64 `json:"rainfall_m3"`
	ChannelInflowM3  float64 `json:"channel_inflow_m3"`
	SeaInflowM3      float64 `json:"sea_inflow_m3"`
	InfiltrationM3   float64 `json:"infiltration_m3"`
	DrainageM3       float64 `json:"drainage_m3"`
	SeaOutflowM3     float64 `json:"sea_outflow_m3"`
	StoredM3         float64 `json:"stored_m3"`
	ResidualM3       float64 `json:"residual_m3"`
}
type HydraulicSnapshot struct {
	Model                   string               `json:"model"`
	TerrainSource           string               `json:"terrain_source"`
	Grid                    HydraulicGrid        `json:"grid"`
	DepthsM                 []float64            `json:"depths_m"`
	RainfallMMH             float64              `json:"rainfall_mm_h"`
	HydrologicalTimeSeconds float64              `json:"hydrological_time_seconds"`
	FloodedAreaM2           float64              `json:"flooded_area_m2"`
	MaxDepthM               float64              `json:"max_depth_m"`
	MassBalance             HydraulicMassBalance `json:"mass_balance"`
}
