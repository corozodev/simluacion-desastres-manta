package evaluation

import (
	"corodev/evacuation/internal/decision"
	"corodev/evacuation/internal/world"
)

// ProbabilityAudit scores a forecast fixed before the next simulator turn.
// It does not use any private zombie state or update its forecast from outcomes.
type ProbabilityAudit struct {
	Samples        int     `json:"samples"`
	Hits           int     `json:"hits"`
	Misses         int     `json:"misses"`
	FalsePositives int     `json:"false_positives"`
	BrierScore     float64 `json:"brier_score"`
	squaredError   float64
}

func (a *ProbabilityAudit) Observe(p decision.ProbabilityPrediction, w world.WorldSnapshot) {
	actual := map[string]bool{}
	for _, z := range w.Zombies {
		if z.Type == world.Runner {
			actual[z.CurrentNode] = true
		}
	}
	if w.Graph == nil || len(actual) == 0 && len(p.OneTurnNodes) == 0 {
		return
	}
	for _, n := range w.Graph.Nodes {
		probability := p.OneTurnNodes[n.ID]
		y := 0.
		if actual[n.ID] {
			y = 1
			if probability > 0 {
				a.Hits++
			} else {
				a.Misses++
			}
		} else if probability > 0 {
			a.FalsePositives++
		}
		delta := probability - y
		a.squaredError += delta * delta
		a.Samples++
	}
	if a.Samples > 0 {
		a.BrierScore = a.squaredError / float64(a.Samples)
	}
}
