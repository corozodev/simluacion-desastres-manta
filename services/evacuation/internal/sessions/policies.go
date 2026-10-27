package sessions

import "corodev/evacuation/internal/runlimits"

// Policy settings are immutable construction inputs. A recovered credential
// only reads an existing run; it cannot replace its policy or PRNG.
func resolvedPolicies(c InputConfig) Config {
	r := Config{Mode: "experimental", ZombiePolicy: "classic_random", EvacuationAlgorithm: "legacy_current", Pro: &ProOptions{RunnerPrediction: true, ShelterAssignment: true}}
	if c.Mode != "" {
		r.Mode = c.Mode
	}
	if c.ZombiePolicy != "" {
		r.ZombiePolicy = c.ZombiePolicy
	}
	if c.EvacuationAlgorithm != "" {
		r.EvacuationAlgorithm = c.EvacuationAlgorithm
	}
	if c.Pro != nil {
		if c.Pro.RunnerPrediction != nil {
			r.Pro.RunnerPrediction = *c.Pro.RunnerPrediction
		}
		if c.Pro.ShelterAssignment != nil {
			r.Pro.ShelterAssignment = *c.Pro.ShelterAssignment
		}
		if c.Pro.RescueFleet != nil {
			r.Pro.RescueFleet = *c.Pro.RescueFleet
		}
	}
	return r
}

func replayPro(p *ProOptions) *ProInput {
	if p == nil {
		return nil
	}
	a, b, c := p.RunnerPrediction, p.ShelterAssignment, p.RescueFleet
	return &ProInput{RunnerPrediction: &a, ShelterAssignment: &b, RescueFleet: &c}
}

func validatePolicies(req CreateRequest) error {
	c := resolvedPolicies(req.Config)
	if c.Mode != "official" && c.Mode != "experimental" {
		return invalid()
	}
	switch c.ZombiePolicy {
	case "classic_random", "correlated_random_walk", "adaptive_exploration":
	default:
		return invalid()
	}
	switch c.EvacuationAlgorithm {
	case "legacy_current", "baseline_shortest_path", "dynamic_risk_astar", "predictive_temporal_astar":
	default:
		return invalid()
	}
	if req.Scenario == "urban_flood" {
		if req.Config.Mode != "" || req.Config.ZombiePolicy != "" || req.Config.EvacuationAlgorithm != "" || req.Config.Pro != nil {
			return invalid()
		}
		return nil
	}
	if c.Mode == "official" {
		population := 20
		if req.Config.Round == "round2" {
			population = 80
		}
		if req.Config.Round == "round3" {
			population = 200
		}
		if req.GraphProfile != "BASE" || c.ZombiePolicy != "classic_random" || c.Pro.RescueFleet || len(req.Config.CustomShelters) > 0 || len(req.Config.RefugeIDs) > 0 || req.Config.Survivors != nil && *req.Config.Survivors != population || req.MaxTicks != nil && *req.MaxTicks != runlimits.OfficialTicks || req.TickIntervalMS != nil && *req.TickIntervalMS != 2000 {
			return invalid()
		}
	}
	return nil
}
