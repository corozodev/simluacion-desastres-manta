package decision

import (
	"context"
	"math"
	"sort"

	"corodev/evacuation/internal/world"
)

// ProbabilityPrediction is a model-based forecast, not a calibrated physical
// probability. Each runner's endpoint distribution has mass one. For multiple
// runners occupancy is the independent union 1-product(1-p). EdgeRisk uses the
// survivor's direction: From->To is exposed to a predicted runner To->From.
// Targets remain at their last observable positions through this short horizon.
type ProbabilityPrediction struct {
	OneTurnNodes map[string]float64
	TwoTurnNodes map[string]float64
	EdgeRisk     map[Transition]float64
}

type runnerDistribution struct {
	nodes map[string]float64
	edges map[Transition]float64
}

func (p *RunnerPredictor) Probabilities(ctx context.Context, w world.WorldSnapshot) ProbabilityPrediction {
	out := ProbabilityPrediction{OneTurnNodes: map[string]float64{}, TwoTurnNodes: map[string]float64{}, EdgeRisk: map[Transition]float64{}}
	if w.Graph == nil || ctx.Err() != nil {
		return out
	}
	legal := map[string][]string{}
	physical := map[string][]string{}
	blocked := map[string]bool{}
	for _, id := range w.BlockedEdges {
		blocked[id] = true
	}
	for id, effect := range roadOverlay(w) {
		if effect.blocked {
			blocked[id] = true
		}
	}
	for _, edge := range w.Graph.Edges {
		physical[edge.From] = append(physical[edge.From], edge.To)
		physical[edge.To] = append(physical[edge.To], edge.From)
		if edge.Blocked || blocked[edge.ID] {
			continue
		}
		legal[edge.From] = append(legal[edge.From], edge.To)
		if !edge.Directed {
			legal[edge.To] = append(legal[edge.To], edge.From)
		}
	}
	for node := range legal {
		legal[node] = uniqueSorted(legal[node])
	}
	for node := range physical {
		physical[node] = uniqueSorted(physical[node])
	}
	active := []world.Survivor{}
	for _, s := range w.Survivors {
		if s.Status == world.Active {
			active = append(active, s)
		}
	}
	sort.Slice(active, func(i, j int) bool { return active[i].ID < active[j].ID })
	runners := []world.Zombie{}
	for _, z := range w.Zombies {
		if z.Type == world.Runner {
			runners = append(runners, z)
		}
	}
	sort.Slice(runners, func(i, j int) bool { return runners[i].ID < runners[j].ID })
	union := func(dst map[string]float64, source map[string]float64) {
		for _, node := range sortedNodeKeys(source) {
			value := math.Max(0, math.Min(1, source[node]))
			dst[node] = 1 - (1-dst[node])*(1-value)
		}
	}
	for _, z := range runners {
		if ctx.Err() != nil {
			return out
		}
		one := projectRunner(legal, physical, active, z.CurrentNode)
		union(out.OneTurnNodes, one.nodes)
		for edge, value := range one.edges {
			value = math.Max(0, math.Min(1, value))
			out.EdgeRisk[edge] = 1 - (1-out.EdgeRisk[edge])*(1-value)
		}
		if p.horizon < 2 {
			continue
		}
		two := map[string]float64{}
		// Sorted accumulation is essential: map iteration order must not alter
		// floating point sums and consequently deterministic route tie breaks.
		for _, node := range sortedNodeKeys(one.nodes) {
			if ctx.Err() != nil {
				return out
			}
			next := projectRunner(legal, physical, active, node)
			for _, to := range sortedNodeKeys(next.nodes) {
				two[to] += one.nodes[node] * next.nodes[to]
			}
		}
		union(out.TwoTurnNodes, two)
	}
	return out
}

func sortedNodeKeys(values map[string]float64) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func projectRunner(legal, physical map[string][]string, active []world.Survivor, start string) runnerDistribution {
	result := runnerDistribution{nodes: map[string]float64{}, edges: map[Transition]float64{}}
	detection := boundedDistances(physical, start, 3)
	bestDistance := 4
	var chase []string
	for _, s := range active {
		d, detected := detection[s.CurrentNode]
		if !detected || d >= bestDistance {
			continue
		}
		candidate := shortestNodes(legal, start, s.CurrentNode)
		if len(candidate) == 0 {
			continue
		}
		chase, bestDistance = candidate, d
	}
	randomWeight := 1.
	if len(chase) > 0 {
		if len(chase) > 3 {
			chase = chase[:3]
		}
		randomWeight = .3
		result.nodes[chase[len(chase)-1]] = .7
		for i := 1; i < len(chase); i++ {
			result.edges[Transition{From: chase[i], To: chase[i-1]}] += .7
		}
	}
	mass := map[string]float64{start: randomWeight}
	for step := 0; step < 2; step++ {
		next := map[string]float64{}
		for _, node := range sortedNodeKeys(mass) {
			neighbors := legal[node]
			if len(neighbors) == 0 {
				next[node] += mass[node]
				continue
			}
			weight := mass[node] / float64(len(neighbors))
			for _, to := range neighbors {
				next[to] += weight
				result.edges[Transition{From: to, To: node}] += weight
			}
		}
		mass = next
	}
	for _, node := range sortedNodeKeys(mass) {
		result.nodes[node] += mass[node]
	}
	return result
}
