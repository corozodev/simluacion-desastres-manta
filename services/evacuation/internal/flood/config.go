// Package flood implements an experimental spatial exposure model. All risk
// values and rates are synthetic; none represents water depth or a forecast.
package flood

import (
	"bytes"
	"corodev/evacuation/internal/world"
	"encoding/json"
	"fmt"
	"io"
	"math"
)

type RoadThresholds struct {
	Caution        float64 `json:"caution"`
	Blocked        float64 `json:"blocked"`
	Hysteresis     float64 `json:"hysteresis"`
	CautionPenalty float64 `json:"caution_penalty"`
}

// ZoneConfig locates a synthetic focus on an actual graph node. Radii describe
// an experimental footprint in metres, never depth or a sourced flood extent.
type ZoneConfig struct {
	ID         string  `json:"id"`
	CenterNode string  `json:"center_node"`
	RadiusMinM float64 `json:"radius_min_m"`
	RadiusMaxM float64 `json:"radius_max_m"`
}

type Config struct {
	RainfallProfile          string              `json:"rainfall_profile"`
	RainfallIntensity        float64             `json:"rainfall_intensity"`
	SimulationDuration       float64             `json:"simulation_duration"`
	TimeStep                 float64             `json:"time_step"`
	FloodGrowthRate          float64             `json:"flood_growth_rate"`
	DrainageFactor           float64             `json:"drainage_factor"`
	RoadRiskThresholds       RoadThresholds      `json:"road_risk_thresholds"`
	ShelterExposureThreshold float64             `json:"shelter_exposure_threshold"`
	EvacuationBehavior       string              `json:"evacuation_behavior"`
	Zones                    []ZoneConfig        `json:"zones,omitempty"`
	GeographicReference      *world.ReferenceUse `json:"geographic_reference,omitempty"`
}

func DefaultConfig() Config {
	return Config{
		RainfallProfile: "storm", RainfallIntensity: .8,
		SimulationDuration: 150, TimeStep: 1,
		FloodGrowthRate: .08, DrainageFactor: .025,
		RoadRiskThresholds:       RoadThresholds{Caution: .30, Blocked: .65, Hysteresis: .08, CautionPenalty: 2},
		ShelterExposureThreshold: .55, EvacuationBehavior: "preventive",
	}
}

// UnmarshalJSON starts with defaults, so explicitly supplied zero intensity,
// growth, drainage, hysteresis and penalty remain meaningful configuration.
func (c *Config) UnmarshalJSON(data []byte) error {
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		return fmt.Errorf("flood configuration must be an object")
	}
	type plain Config
	value := plain(DefaultConfig())
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if err := d.Decode(&value); err != nil {
		return fmt.Errorf("flood configuration: %w", err)
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return fmt.Errorf("flood configuration must contain one object")
	}
	// Missing fields already received defaults. Explicit zero cannot silently
	// replace a required duration, step or positive safety-model threshold.
	if value.SimulationDuration <= 0 || value.TimeStep <= 0 || value.ShelterExposureThreshold <= 0 || value.RoadRiskThresholds.Caution <= 0 || value.RoadRiskThresholds.Blocked <= 0 {
		return fmt.Errorf("flood duration, time_step and exposure thresholds must be positive")
	}
	*c = Config(value)
	return nil
}

func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }

// WithDefaults fills unspecified structural values for programmatic callers.
// Rates and intensity are deliberately not defaulted: start from DefaultConfig
// when constructing a configured model without JSON.
func (c Config) WithDefaults() (Config, error) {
	d := DefaultConfig()
	if c.RainfallProfile == "" {
		c.RainfallProfile = d.RainfallProfile
	}
	if c.SimulationDuration == 0 {
		c.SimulationDuration = d.SimulationDuration
	}
	if c.TimeStep == 0 {
		c.TimeStep = d.TimeStep
	}
	if c.RoadRiskThresholds == (RoadThresholds{}) {
		c.RoadRiskThresholds = d.RoadRiskThresholds
	}
	if c.ShelterExposureThreshold == 0 {
		c.ShelterExposureThreshold = d.ShelterExposureThreshold
	}
	if c.EvacuationBehavior == "" {
		c.EvacuationBehavior = d.EvacuationBehavior
	}
	if c.RainfallProfile != "storm" && c.RainfallProfile != "constant" && c.RainfallProfile != "pulse" {
		return Config{}, fmt.Errorf("unsupported rainfall_profile %q", c.RainfallProfile)
	}
	if c.EvacuationBehavior != "preventive" && c.EvacuationBehavior != "late" && c.EvacuationBehavior != "adaptive" {
		return Config{}, fmt.Errorf("unsupported evacuation_behavior %q", c.EvacuationBehavior)
	}
	if !finite(c.SimulationDuration) || !finite(c.TimeStep) || c.SimulationDuration <= 0 || c.SimulationDuration > 1e6 || c.TimeStep <= 0 || math.Ceil(c.SimulationDuration/c.TimeStep) > 10000 {
		return Config{}, fmt.Errorf("flood duration and time_step must be positive, finite and at most 10000 steps")
	}
	if !finite(c.RainfallIntensity) || c.RainfallIntensity < 0 || c.RainfallIntensity > 1 || !finite(c.FloodGrowthRate) || c.FloodGrowthRate < 0 || c.FloodGrowthRate > 100 || !finite(c.DrainageFactor) || c.DrainageFactor < 0 || c.DrainageFactor > 100 {
		return Config{}, fmt.Errorf("invalid normalized rainfall, growth or drainage")
	}
	r := c.RoadRiskThresholds
	if !finite(r.Caution) || !finite(r.Blocked) || !finite(r.Hysteresis) || !finite(r.CautionPenalty) || r.Caution <= 0 || r.Blocked <= r.Caution || r.Blocked > 1 || r.Hysteresis < 0 || r.Hysteresis >= r.Caution || r.CautionPenalty < 0 || r.CautionPenalty > 100 {
		return Config{}, fmt.Errorf("invalid flood road_risk_thresholds")
	}
	if !finite(c.ShelterExposureThreshold) || c.ShelterExposureThreshold <= 0 || c.ShelterExposureThreshold > 1 {
		return Config{}, fmt.Errorf("invalid shelter_exposure_threshold")
	}
	if len(c.Zones) > 32 {
		return Config{}, fmt.Errorf("at most 32 synthetic flood zones are supported")
	}
	seen := map[string]bool{}
	centers := map[string]bool{}
	for _, z := range c.Zones {
		if z.ID == "" || seen[z.ID] || z.CenterNode == "" || centers[z.CenterNode] || !finite(z.RadiusMinM) || !finite(z.RadiusMaxM) || z.RadiusMinM <= 0 || z.RadiusMaxM < z.RadiusMinM || z.RadiusMaxM > 10000 {
			return Config{}, fmt.Errorf("invalid synthetic flood zone %q", z.ID)
		}
		seen[z.ID] = true
		centers[z.CenterNode] = true
	}
	c.Zones = append([]ZoneConfig(nil), c.Zones...)
	if r := c.GeographicReference; r != nil {
		if r.Category != "official_reference" || r.DatasetVersion == "" || r.SourceURL == "" || r.ConsultedAt == "" || !finite(r.Strength) || r.Strength < 0 || r.Strength > 1 || len(r.Zones) > 32 {
			return Config{}, fmt.Errorf("invalid geographic reference")
		}
		seen := map[string]bool{}
		for _, z := range r.Zones {
			rank, ok := map[string]int{"NONE": 0, "BAJA": 0, "MEDIA": 1, "ALTA": 2}[z.Susceptibility]
			if !ok || seen[z.ZoneID] || z.ZoneID == "" || !finite(z.Factor) || z.Factor != 1+r.Strength*float64(rank) {
				return Config{}, fmt.Errorf("invalid reference experiment weight")
			}
			seen[z.ZoneID] = true
		}
		c.GeographicReference = r.Clone()
	}
	return c, nil
}
