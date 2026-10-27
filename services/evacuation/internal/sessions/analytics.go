package sessions

import (
	"context"
	"sort"

	"corodev/evacuation/internal/decision"
	"corodev/evacuation/internal/diagnostics"
	"corodev/evacuation/internal/world"
)

type AgentAnalytics struct {
	ID              string  `json:"id"`
	ArrivalTurn     int     `json:"arrival_turn"`
	Moves           int     `json:"moves"`
	Oscillations    int     `json:"oscillations"`
	Replans         int     `json:"replans"`
	RouteEfficiency float64 `json:"route_efficiency"`
}
type PredictionQuality struct {
	Samples        int     `json:"samples"`
	Hits           int     `json:"hits"`
	Misses         int     `json:"misses"`
	FalsePositives int     `json:"false_positives"`
	BrierScore     float64 `json:"brier_score"`
}
type Analytics struct {
	DeathsByType        map[string]int    `json:"deaths_by_type"`
	DeathsByCause       map[string]int    `json:"deaths_by_cause"`
	Replans             int               `json:"replans"`
	Oscillations        int               `json:"oscillations"`
	MeanArrivalTurn     float64           `json:"mean_arrival_turn"`
	MeanRouteEfficiency float64           `json:"mean_route_efficiency"`
	Agents              []AgentAnalytics  `json:"agents"`
	Prediction          PredictionQuality `json:"prediction"`
}

// PublicAnalytics explicitly projects diagnostics; private initial sleepers,
// zombie identities/positions and PRNG state never cross this boundary.
func PublicAnalytics(d diagnostics.Report) *Analytics {
	a := &Analytics{DeathsByType: map[string]int{}, DeathsByCause: map[string]int{}, Agents: []AgentAnalytics{}, MeanArrivalTurn: d.Summary.MeanEvacuationTurn, MeanRouteEfficiency: d.Summary.MeanRouteEfficiency}
	for _, b := range d.Bites {
		a.DeathsByType[b.ZombieType]++
		a.DeathsByCause[b.Mechanism]++
	}
	for _, v := range d.Survivors {
		a.Replans += v.RouteInvalidations
		a.Oscillations += v.Reversals
		arrival := v.EvacuationTurn
		if arrival < 0 {
			arrival = 0
		}
		a.Agents = append(a.Agents, AgentAnalytics{ID: v.ID, ArrivalTurn: arrival, Moves: v.Moves, Oscillations: v.Reversals, Replans: v.RouteInvalidations, RouteEfficiency: v.RouteEfficiency})
	}
	return a
}
func (a *Analytics) clone() *Analytics {
	if a == nil {
		return nil
	}
	b := *a
	b.DeathsByType = map[string]int{}
	for k, v := range a.DeathsByType {
		b.DeathsByType[k] = v
	}
	b.DeathsByCause = map[string]int{}
	for k, v := range a.DeathsByCause {
		b.DeathsByCause[k] = v
	}
	b.Agents = append([]AgentAnalytics{}, a.Agents...)
	return &b
}

type NodeForecast struct {
	NodeID             string  `json:"node_id"`
	OneTurnProbability float64 `json:"one_turn_probability"`
	TwoTurnProbability float64 `json:"two_turn_probability"`
}
type EdgeForecast struct {
	From        string  `json:"from"`
	To          string  `json:"to"`
	Probability float64 `json:"probability"`
}
type RunnerForecast struct {
	Turn      int            `json:"turn"`
	Horizon   int            `json:"horizon"`
	NodeRisks []NodeForecast `json:"node_risks"`
	EdgeRisks []EdgeForecast `json:"edge_risks"`
}

func (f *RunnerForecast) clone() *RunnerForecast {
	if f == nil {
		return nil
	}
	c := *f
	c.NodeRisks = append([]NodeForecast{}, f.NodeRisks...)
	c.EdgeRisks = append([]EdgeForecast{}, f.EdgeRisks...)
	return &c
}
func forecast(ctx context.Context, w world.WorldSnapshot) (*RunnerForecast, decision.ProbabilityPrediction) {
	p := decision.NewRunnerPredictor(2).Probabilities(ctx, w)
	f := &RunnerForecast{Turn: w.Turn, Horizon: 2, NodeRisks: []NodeForecast{}, EdgeRisks: []EdgeForecast{}}
	nodes := map[string]bool{}
	for n := range p.OneTurnNodes {
		nodes[n] = true
	}
	for n := range p.TwoTurnNodes {
		nodes[n] = true
	}
	for n := range nodes {
		f.NodeRisks = append(f.NodeRisks, NodeForecast{n, p.OneTurnNodes[n], p.TwoTurnNodes[n]})
	}
	sort.Slice(f.NodeRisks, func(i, j int) bool { return f.NodeRisks[i].NodeID < f.NodeRisks[j].NodeID })
	for e, risk := range p.EdgeRisk {
		f.EdgeRisks = append(f.EdgeRisks, EdgeForecast{e.From, e.To, risk})
	}
	sort.Slice(f.EdgeRisks, func(i, j int) bool {
		a, b := f.EdgeRisks[i], f.EdgeRisks[j]
		if a.From != b.From {
			return a.From < b.From
		}
		return a.To < b.To
	})
	return f, p
}

type predictionAudit struct {
	Quality PredictionQuality
	sum     float64
}

func (a *predictionAudit) observe(p decision.ProbabilityPrediction, after world.WorldSnapshot) {
	actual := map[string]bool{}
	for _, z := range after.Zombies {
		if z.Type == world.Runner {
			actual[z.CurrentNode] = true
		}
	}
	// Evaluate every graph node, including zero predictions, avoiding optimistic
	// omission of actual runner endpoints outside the forecast support.
	if after.Graph == nil || len(actual) == 0 && len(p.OneTurnNodes) == 0 {
		return
	}
	for _, n := range after.Graph.Nodes {
		probability := p.OneTurnNodes[n.ID]
		y := 0.
		if actual[n.ID] {
			y = 1
			if probability > 0 {
				a.Quality.Hits++
			} else {
				a.Quality.Misses++
			}
		} else if probability > 0 {
			a.Quality.FalsePositives++
		}
		error := probability - y
		a.sum += error * error
		a.Quality.Samples++
	}
	if a.Quality.Samples > 0 {
		a.Quality.BrierScore = a.sum / float64(a.Quality.Samples)
	}
}
