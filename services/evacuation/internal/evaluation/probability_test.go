package evaluation_test

import (
	"math"
	"testing"

	"corodev/evacuation/internal/decision"
	"corodev/evacuation/internal/evaluation"
	"corodev/evacuation/internal/world"
)

func TestForecastQualityIncludesMissedActualEndpointsAndZeroMassNodes(t *testing.T) {
	before := decision.ProbabilityPrediction{OneTurnNodes: map[string]float64{"a": .5, "b": .5}}
	after := world.WorldSnapshot{Graph: &world.Graph{Nodes: []world.GraphNode{{ID: "a"}, {ID: "b"}, {ID: "c"}}}, Zombies: []world.Zombie{{ID: "r", Type: world.Runner, CurrentNode: "c"}}}
	audit := evaluation.ProbabilityAudit{}
	audit.Observe(before, after)
	if audit.Samples != 3 || audit.Misses != 1 || audit.Hits != 0 || audit.FalsePositives != 2 || math.Abs(audit.BrierScore-.5) > 1e-12 {
		t.Fatalf("optimistic forecast audit: %+v", audit)
	}
	if before.OneTurnNodes["c"] != 0 {
		t.Fatal("scoring revised forecast after observing outcome")
	}
	after.Zombies[0].CurrentNode = "a"
	audit.Observe(before, after)
	if audit.Samples != 6 || audit.Hits != 1 || audit.Misses != 1 || math.Abs(audit.BrierScore-1./3) > 1e-12 {
		t.Fatalf("incorrect accumulated score: %+v", audit)
	}
}
