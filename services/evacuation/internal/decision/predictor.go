package decision

import (
	"context"
	"sort"

	"corodev/evacuation/internal/world"
)

type Transition struct{ From, To string }
type PredictedPath struct {
	ZombieID string   `json:"zombie_id"`
	TargetID string   `json:"target_id"`
	Nodes    []string `json:"nodes"`
	Horizon  int      `json:"horizon"`
}

// Prediction weights are relative exposure, not calibrated probabilities. The
// envelopes intentionally contain alternative targets/random choices, so members
// that are not subsequently visited are forecast false-positive candidates.
type Prediction struct {
	OneTurnNodes map[string]float64
	TwoTurnNodes map[string]float64
	EdgeRisk     map[Transition]float64
	TargetPaths  []PredictedPath
}

type RunnerPredictor struct{ horizon int }

func NewRunnerPredictor(horizon int) *RunnerPredictor {
	if horizon < 1 || horizon > 2 {
		horizon = 2
	}
	return &RunnerPredictor{horizon: horizon}
}

func (p *RunnerPredictor) Predict(ctx context.Context, w world.WorldSnapshot) Prediction {
	result := Prediction{OneTurnNodes: map[string]float64{}, TwoTurnNodes: map[string]float64{}, EdgeRisk: map[Transition]float64{}, TargetPaths: []PredictedPath{}}
	if w.Graph == nil || ctx.Err() != nil {
		return result
	}
	legal := map[string][]string{}
	physical := map[string][]string{}
	blocked := map[string]bool{}
	for _, id := range w.BlockedEdges {
		blocked[id] = true
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
	for n := range legal {
		legal[n] = uniqueSorted(legal[n])
	}
	for n := range physical {
		physical[n] = uniqueSorted(physical[n])
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
	for _, z := range runners {
		if ctx.Err() != nil {
			return result
		}
		one := boundedDistances(legal, z.CurrentNode, 2)
		two := boundedDistances(legal, z.CurrentNode, 2*p.horizon)
		// The low envelope weight allows progress through possible danger rather
		// than treating every reachable runner position as an absolute blockade.
		for node := range one {
			result.OneTurnNodes[node] += .15
		}
		for node := range two {
			result.TwoTurnNodes[node] += .1
		}
		for from, d := range one {
			if d >= 2 {
				continue
			}
			for _, to := range legal[from] {
				result.EdgeRisk[Transition{From: to, To: from}] += .05
			}
		}
		position := z.CurrentNode
		for horizon := 1; horizon <= p.horizon; horizon++ {
			detection := boundedDistances(physical, position, 3)
			bestDistance := 4
			var path []string
			targetID := ""
			for _, s := range active {
				distance, detected := detection[s.CurrentNode]
				if !detected || distance >= bestDistance {
					continue
				}
				candidate := shortestNodes(legal, position, s.CurrentNode)
				if len(candidate) == 0 {
					continue
				}
				path = candidate
				targetID = s.ID
				bestDistance = distance
			}
			if len(path) == 0 {
				break
			}
			if len(path) > 3 {
				path = path[:3]
			}
			result.TargetPaths = append(result.TargetPaths, PredictedPath{ZombieID: z.ID, TargetID: targetID, Nodes: append([]string{}, path...), Horizon: horizon})
			endpoint := path[len(path)-1]
			if horizon == 1 {
				result.OneTurnNodes[endpoint] += .85
			} else {
				result.TwoTurnNodes[endpoint] += .45
			}
			for i := 1; i < len(path); i++ {
				result.EdgeRisk[Transition{From: path[i], To: path[i-1]}] += .75 / float64(horizon)
			}
			position = endpoint
		}
	}
	return result
}

func uniqueSorted(values []string) []string {
	sort.Strings(values)
	result := values[:0]
	for _, v := range values {
		if len(result) == 0 || result[len(result)-1] != v {
			result = append(result, v)
		}
	}
	return result
}
func boundedDistances(adjacency map[string][]string, start string, limit int) map[string]int {
	distances := map[string]int{start: 0}
	queue := []string{start}
	for i := 0; i < len(queue); i++ {
		at := queue[i]
		if distances[at] >= limit {
			continue
		}
		for _, next := range adjacency[at] {
			if _, seen := distances[next]; seen {
				continue
			}
			distances[next] = distances[at] + 1
			queue = append(queue, next)
		}
	}
	return distances
}
func shortestNodes(adjacency map[string][]string, start, target string) []string {
	previous := map[string]string{start: ""}
	queue := []string{start}
	for i := 0; i < len(queue); i++ {
		at := queue[i]
		if at == target {
			result := []string{target}
			for result[len(result)-1] != start {
				result = append(result, previous[result[len(result)-1]])
			}
			for a, b := 0, len(result)-1; a < b; a, b = a+1, b-1 {
				result[a], result[b] = result[b], result[a]
			}
			return result
		}
		for _, next := range adjacency[at] {
			if _, seen := previous[next]; seen {
				continue
			}
			previous[next] = at
			queue = append(queue, next)
		}
	}
	return nil
}
