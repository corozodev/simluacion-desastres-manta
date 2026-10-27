package decision

import (
	"container/heap"
	"context"
	"math"
	"sort"

	"corodev/evacuation/internal/world"
)

const (
	LegacyCurrent           = "legacy_current"
	BaselineShortestPath    = "baseline_shortest_path"
	DynamicRiskAStar        = "dynamic_risk_astar"
	PredictiveTemporalAStar = "predictive_temporal_astar"
)

func ValidAlgorithm(name string) bool {
	switch name {
	case "", LegacyCurrent, BaselineShortestPath, DynamicRiskAStar, PredictiveTemporalAStar:
		return true
	}
	return false
}

type algorithmResult struct {
	choices []world.DecisionResult
	wait    bool
}

// algorithmCandidates shares a source-node plan across observers and survivors
// in this immutable snapshot, but applies individual route hysteresis afterwards.
func (e *DeterministicEngine) algorithmCandidates(ctx context.Context, b *bundle, s world.Survivor) []world.DecisionResult {
	if !b.env.nodes[s.CurrentNode] || ctx.Err() != nil {
		return nil
	}
	var result algorithmResult
	if cached, ok := b.candidates.Load(s.CurrentNode); ok {
		result = cached.(algorithmResult)
	} else {
		bestScore, bestWaitScore := math.Inf(1), math.Inf(1)
		for _, id := range b.shelterIDs {
			if ctx.Err() != nil {
				return nil
			}
			sh := b.shelters[id]
			var points []string
			if e.options.Algorithm == BaselineShortestPath {
				points = route(b.plans[id], s.CurrentNode, len(b.env.nodes))
			} else {
				points = e.astar(ctx, b, s.CurrentNode, sh, 0)
			}
			if len(points) == 0 {
				continue
			}
			risk, cost, score := e.algorithmScore(b, points, true, 0)
			next := s.CurrentNode
			if len(points) > 1 {
				next = points[1]
			}
			result.choices = append(result.choices, world.DecisionResult{NextNode: next, TargetShelterID: id, Route: points, EstimatedRisk: risk, Cost: cost})
			if score < bestScore {
				bestScore = score
			}
			// An explicit wait consumes a survivor turn. It is only preferable when
			// the current node is safe and postponing entry into a forecast threat
			// materially improves the bounded temporal objective. No future turn is
			// simulated here; targets are the currently observable cohort only.
			if e.options.Algorithm == PredictiveTemporalAStar && e.options.Prediction && !b.env.danger[s.CurrentNode] && s.CurrentNode != sh.NodeID {
				delayed := e.astar(ctx, b, s.CurrentNode, sh, 1)
				if len(delayed) > 0 {
					_, _, delayedScore := e.algorithmScore(b, delayed, true, 1)
					delayedScore += 1 + e.options.RiskWeight*b.env.risk[s.CurrentNode] + e.options.PredictionWeight*b.probability.OneTurnNodes[s.CurrentNode]
					if delayedScore < bestWaitScore {
						bestWaitScore = delayedScore
					}
				}
			}
		}
		if ctx.Err() != nil {
			return nil
		}
		sort.Slice(result.choices, func(i, j int) bool { return e.resultLess(result.choices[i], result.choices[j]) })
		result.wait = bestWaitScore*(1+e.options.Stickiness) < bestScore
		actual, _ := b.candidates.LoadOrStore(s.CurrentNode, result)
		result = actual.(algorithmResult)
	}
	if result.wait {
		return nil
	}
	choices := make([]world.DecisionResult, len(result.choices))
	for i, candidate := range result.choices {
		candidate.Route = append([]string{}, candidate.Route...)
		if candidate.TargetShelterID == s.TargetShelterID && len(s.PlannedRoute) > 1 && s.PlannedRoute[len(s.PlannedRoute)-1] == b.shelters[candidate.TargetShelterID].NodeID && validPath(b.env, s.PlannedRoute, s.CurrentNode) {
			risk, cost, score := e.algorithmScore(b, s.PlannedRoute, true, 0)
			_, _, freshScore := e.algorithmScore(b, candidate.Route, true, 0)
			if score <= freshScore*(1+e.options.Stickiness) && risk <= candidate.EstimatedRisk+2 {
				candidate.Route = append([]string{}, s.PlannedRoute...)
				candidate.NextNode = candidate.Route[1]
				candidate.EstimatedRisk, candidate.Cost = risk, cost
			}
		}
		choices[i] = candidate
	}
	sort.Slice(choices, func(i, j int) bool { return e.resultLess(choices[i], choices[j]) })
	return choices
}

func (e *DeterministicEngine) resultLess(a, b world.DecisionResult) bool {
	as, bs := a.Cost+e.options.RiskWeight*a.EstimatedRisk, b.Cost+e.options.RiskWeight*b.EstimatedRisk
	if as != bs {
		return as < bs
	}
	if a.EstimatedRisk != b.EstimatedRisk {
		return a.EstimatedRisk < b.EstimatedRisk
	}
	if a.Cost != b.Cost {
		return a.Cost < b.Cost
	}
	return a.TargetShelterID < b.TargetShelterID
}

func (e *DeterministicEngine) algorithmScore(b *bundle, path []string, completes bool, offset int) (risk, cost, score float64) {
	for i := 1; i < len(path); i++ {
		var edgeCost float64
		for _, edge := range b.env.forward[path[i-1]] {
			if edge.to == path[i] {
				edgeCost = edge.cost
				break
			}
		}
		cost += edgeCost
		if e.options.Algorithm == BaselineShortestPath {
			continue
		}
		risk += e.stepRisk(b, path[i-1], path[i], i+offset, completes && i == len(path)-1)
	}
	score = cost + e.options.RiskWeight*risk
	return
}

func (e *DeterministicEngine) stepRisk(b *bundle, from, to string, tick int, arrival bool) float64 {
	if arrival {
		return 0
	} // admitted before the next zombie phase
	risk := b.env.risk[to]
	if e.options.Algorithm == PredictiveTemporalAStar && e.options.Prediction {
		forecast := 0.
		if tick == 1 {
			forecast = b.probability.OneTurnNodes[to]
		}
		if tick == 2 {
			forecast = .35*b.probability.TwoTurnNodes[to] + b.probability.EdgeRisk[Transition{From: from, To: to}]
		}
		risk += e.options.PredictionWeight * forecast / e.options.RiskWeight
	}
	return risk
}

type timedNode struct {
	node string
	tick int
}
type searchItem struct {
	state  timedNode
	g, f   float64
	parent *searchItem
}
type astarQueue []*searchItem

func (q astarQueue) Len() int { return len(q) }
func (q astarQueue) Less(i, j int) bool {
	a, b := q[i], q[j]
	if a.f != b.f {
		return a.f < b.f
	}
	if a.g != b.g {
		return a.g < b.g
	}
	if a.state.node != b.state.node {
		return a.state.node < b.state.node
	}
	return a.state.tick < b.state.tick
}
func (q astarQueue) Swap(i, j int) { q[i], q[j] = q[j], q[i] }
func (q *astarQueue) Push(v any)   { *q = append(*q, v.(*searchItem)) }
func (q *astarQueue) Pop() any     { old := *q; v := old[len(old)-1]; *q = old[:len(old)-1]; return v }

// astar searches weighted edges with a consistent lower bound from a shared
// reverse shortest-path search. Temporal search keeps separate node/time labels
// for the first two positions and merges them after the forecast horizon. A
// route never contains a cycle; ancestor suppression deliberately favors simple
// usable routes over delaying loops. Under that suppression, temporal search is
// a bounded heuristic, not a claim of optimality over every timed walk.
func (e *DeterministicEngine) astar(ctx context.Context, b *bundle, start string, sh world.Shelter, offset int) []string {
	heuristic := b.plans[sh.ID]
	first, reachable := heuristic[start]
	if !reachable {
		return nil
	}
	root := &searchItem{state: timedNode{node: start, tick: offset}, f: first.cost}
	q := &astarQueue{root}
	heap.Init(q)
	best := map[timedNode]float64{root.state: 0}
	maxExpansions := 4*len(b.env.nodes) + 16
	for expanded := 0; q.Len() > 0; expanded++ {
		if ctx.Err() != nil {
			return nil
		}
		if expanded > maxExpansions { // safe deterministic fallback, never an invalid move
			return route(heuristic, start, len(b.env.nodes))
		}
		item := heap.Pop(q).(*searchItem)
		if best[item.state] != item.g {
			continue
		}
		if item.state.node == sh.NodeID {
			path := []string{}
			for at := item; at != nil; at = at.parent {
				path = append(path, at.state.node)
			}
			for i, j := 0, len(path)-1; i < j; i, j = i+1, j-1 {
				path[i], path[j] = path[j], path[i]
			}
			return path
		}
		for _, edge := range b.env.forward[item.state.node] {
			h, ok := heuristic[edge.to]
			if !ok {
				continue
			}
			cycle := false
			for at := item; at != nil; at = at.parent {
				if at.state.node == edge.to {
					cycle = true
					break
				}
			}
			if cycle {
				continue
			}
			tick := item.state.tick + 1
			if e.options.Algorithm != PredictiveTemporalAStar {
				tick = 0
			} else if tick > 3 {
				tick = 3
			}
			risk := e.stepRisk(b, edge.from, edge.to, tick, edge.to == sh.NodeID)
			cost := item.g + edge.cost + e.options.RiskWeight*risk
			state := timedNode{edge.to, tick}
			if old, ok := best[state]; ok && old <= cost {
				continue
			}
			best[state] = cost
			heap.Push(q, &searchItem{state: state, g: cost, f: cost + h.cost, parent: item})
		}
	}
	return nil
}
