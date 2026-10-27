// Package floodlab is a local experimental controller. It never changes the
// competition catalog, zombie controller or simulator movement rules.
package floodlab

import (
	"corodev/evacuation/internal/catalog"
	"corodev/evacuation/internal/world"
)

const Disclaimer = "Los escenarios de inundación emplean parámetros sintéticos y no constituyen pronósticos hidrológicos ni recomendaciones oficiales de evacuación"
const MaxSnapDistanceM = 500.0

type Candidate struct {
	ID       string  `json:"id"`
	Label    string  `json:"label"`
	Lat      float64 `json:"lat"`
	Lng      float64 `json:"lng"`
	Capacity int     `json:"capacity"`
}

type RunConfig struct {
	Mode               string      `json:"mode"`
	Seed               int64       `json:"seed"`
	RainfallProfile    string      `json:"rainfall_profile"`
	RainfallIntensity  float64     `json:"rainfall_intensity"`
	SimulationDuration float64     `json:"simulation_duration"`
	EvacuationBehavior string      `json:"evacuation_behavior"`
	Agents             int         `json:"agents"`
	IntervalMS         int         `json:"interval_ms"`
	Shelters           []Candidate `json:"shelters"`
}

type RunRequest struct {
	Config        RunConfig `json:"config"`
	ExpectedRunID string    `json:"expected_run_id"`
}

type Action struct {
	Action        string `json:"action"`
	ExpectedRunID string `json:"expected_run_id"`
	IntervalMS    *int   `json:"interval_ms,omitempty"`
}

type CandidateRequest struct {
	Mode       string      `json:"mode"`
	Candidates []Candidate `json:"candidates"`
}

type ValidatedCandidate struct {
	Candidate
	NodeID        string  `json:"node_id"`
	SnappedLat    float64 `json:"snapped_lat"`
	SnappedLng    float64 `json:"snapped_lng"`
	SnapDistanceM float64 `json:"snap_distance_m"`
	Valid         bool    `json:"valid"`
	Message       string  `json:"message"`
}

type CandidateValidation struct {
	Valid      bool                 `json:"valid"`
	Candidates []ValidatedCandidate `json:"candidates"`
}

type Preset struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Config      RunConfig `json:"config"`
}

type Catalog struct {
	Modes            []catalog.Preset `json:"modes"`
	Presets          []Preset         `json:"presets"`
	DefaultConfig    RunConfig        `json:"default_config"`
	OriginalShelters []Candidate      `json:"original_shelters"`
	MaxSnapDistanceM float64          `json:"max_snap_distance_m"`
	Disclaimer       string           `json:"disclaimer"`
}

type Origin struct {
	ID            string  `json:"id"`
	NodeID        string  `json:"node_id"`
	Lat           float64 `json:"lat"`
	Lng           float64 `json:"lng"`
	SnapDistanceM float64 `json:"snap_distance_m"`
}

type TimelineEntry struct {
	Step              int                     `json:"step"`
	SimulationTime    float64                 `json:"simulation_time"`
	EvacuationMetrics world.EvacuationMetrics `json:"evacuation_metrics"`
	StepLatencyMS     float64                 `json:"step_latency_ms"`
}

type ComparisonResult struct {
	Strategy            string                  `json:"strategy"`
	Mode                string                  `json:"mode"`
	Seed                int64                   `json:"seed"`
	GraphVersion        string                  `json:"graph_version"`
	TotalAgents         int                     `json:"total_agents"`
	EvacuatedPercentage float64                 `json:"evacuated_percentage"`
	EvacuationMetrics   world.EvacuationMetrics `json:"evacuation_metrics"`
	StepLatencyMS       float64                 `json:"step_latency_ms"`
	OriginsHash         string                  `json:"origins_hash"`
	ConfigHash          string                  `json:"config_hash"`
}

type Comparison struct {
	ID       string             `json:"id"`
	State    string             `json:"state"`
	Progress int                `json:"progress"`
	Message  string             `json:"message"`
	Results  []ComparisonResult `json:"results"`
}

type State struct {
	RunID        string                  `json:"run_id"`
	State        string                  `json:"state"`
	Mode         string                  `json:"mode"`
	GraphVersion string                  `json:"graph_version"`
	Config       RunConfig               `json:"config"`
	Scenario     *world.ScenarioSnapshot `json:"scenario"`
	Shelters     []world.Shelter         `json:"shelters"`
	Timeline     []TimelineEntry         `json:"timeline"`
	Origins      []Origin                `json:"origins"`
	Comparison   *Comparison             `json:"comparison,omitempty"`
}

func cloneConfig(c RunConfig) RunConfig {
	c.Shelters = append([]Candidate{}, c.Shelters...)
	return c
}

func (s State) clone() State {
	s.Config = cloneConfig(s.Config)
	s.Scenario = s.Scenario.Clone()
	s.Shelters = append([]world.Shelter{}, s.Shelters...)
	s.Timeline = append([]TimelineEntry{}, s.Timeline...)
	s.Origins = append([]Origin{}, s.Origins...)
	if s.Comparison != nil {
		c := *s.Comparison
		c.Results = append([]ComparisonResult{}, c.Results...)
		s.Comparison = &c
	}
	return s
}
