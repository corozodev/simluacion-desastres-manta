// Package decision provides deterministic local routing from observable state.
package decision

import (
	"container/heap"
	"context"
	"encoding/binary"
	"hash/fnv"
	"math"
	"sort"
	"sync/atomic"

	"corodev/evacuation/internal/world"
)

// Options separates estimated exposure from hard movement restrictions. Numeric
// zero values use defaults; Prediction is explicit for controlled ablations.
type Options struct {
	Prediction       bool
	Horizon          int
	RiskWeight       float64
	PredictionWeight float64
	Stickiness       float64
}

type EngineStats struct {
	CacheHits      uint64 `json:"cache_hits"`
	Builds         uint64 `json:"builds"`
	Searches       uint64 `json:"searches"`
	Predictions    uint64 `json:"predictions"`
	ReusedSearches uint64 `json:"reused_searches"`
}

type DeterministicEngine struct {
	options        Options
	gate           chan struct{}
	cache          atomic.Pointer[bundle]
	hits           atomic.Uint64
	builds         atomic.Uint64
	searches       atomic.Uint64
	predictions    atomic.Uint64
	reusedSearches atomic.Uint64
}

func New() *DeterministicEngine { return NewWithOptions(Options{Prediction: true}) }
func NewWithOptions(options Options) *DeterministicEngine {
	if options.Horizon < 1 || options.Horizon > 2 {
		options.Horizon = 2
	}
	if options.RiskWeight <= 0 || math.IsNaN(options.RiskWeight) || math.IsInf(options.RiskWeight, 0) {
		options.RiskWeight = .6
	}
	if options.PredictionWeight <= 0 || math.IsNaN(options.PredictionWeight) || math.IsInf(options.PredictionWeight, 0) {
		options.PredictionWeight = 12
	}
	if options.Stickiness <= 0 || options.Stickiness > 1 || math.IsNaN(options.Stickiness) {
		options.Stickiness = .15
	}
	return &DeterministicEngine{options: options, gate: make(chan struct{}, 1)}
}
func (e *DeterministicEngine) Stats() EngineStats {
	return EngineStats{CacheHits: e.hits.Load(), Builds: e.builds.Load(), Searches: e.searches.Load(), Predictions: e.predictions.Load(), ReusedSearches: e.reusedSearches.Load()}
}

type arc struct {
	from, to string
	cost     float64
}
type choice struct {
	next, shelter     string
	risk, cost, score float64
}
type bundle struct {
	key        uint64
	routingKey uint64
	env        *environment
	plans      map[string]map[string]choice
	shelters   map[string]world.Shelter
	shelterIDs []string
	forecast   Prediction
}
type environment struct {
	nodes     map[string]bool
	topology  map[string][]string
	forward   map[string][]arc
	reverse   map[string][]arc
	danger    map[string]bool
	forbidden map[Transition]bool
	risk      map[string]float64
}

type queued struct {
	node   string
	choice choice
}
type queue []queued

func (q queue) Len() int { return len(q) }
func (q queue) Less(i, j int) bool {
	a, b := q[i], q[j]
	if better(a.choice, b.choice) {
		return true
	}
	if better(b.choice, a.choice) {
		return false
	}
	return a.node < b.node
}
func (q queue) Swap(i, j int) { q[i], q[j] = q[j], q[i] }
func (q *queue) Push(v any)   { *q = append(*q, v.(queued)) }
func (q *queue) Pop() any     { old := *q; v := old[len(old)-1]; *q = old[:len(old)-1]; return v }
func better(a, b choice) bool {
	if a.score != b.score {
		return a.score < b.score
	}
	if a.risk != b.risk {
		return a.risk < b.risk
	}
	if a.cost != b.cost {
		return a.cost < b.cost
	}
	if a.shelter != b.shelter {
		return a.shelter < b.shelter
	}
	return a.next < b.next
}

func wait(s world.Survivor) world.DecisionResult {
	return world.DecisionResult{NextNode: s.CurrentNode, Route: []string{s.CurrentNode}}
}

// NextStep reads the coherent assignment already published by the turn planner.
// Without an assignment it selects from shared candidate plans. Neither path
// reserves capacity or mutates the authoritative world.
func (e *DeterministicEngine) NextStep(ctx context.Context, w world.WorldSnapshot, s world.Survivor) world.DecisionResult {
	if ctx.Err() != nil || s.Status != world.Active || w.Graph == nil || world.AgentWaiting(w, s.ID) {
		return wait(s)
	}
	b := e.prepare(ctx, w)
	if b == nil {
		return wait(s)
	}
	if result, valid := e.assigned(b, s); valid {
		return result
	}
	candidates := e.candidates(ctx, b, s)
	if ctx.Err() != nil {
		return wait(s)
	}
	if s.TargetShelterID != "" {
		for _, candidate := range candidates {
			if candidate.TargetShelterID == s.TargetShelterID {
				return candidate
			}
		}
	}
	if len(candidates) > 0 {
		return candidates[0]
	}
	return e.escape(b, s)
}

// Candidates computes at most one route per refuge. Occupancy is authoritative;
// previous reservations are deliberately ignored while D reallocates the cohort.
func (e *DeterministicEngine) Candidates(ctx context.Context, w world.WorldSnapshot, s world.Survivor) []world.DecisionResult {
	if ctx.Err() != nil || s.Status != world.Active || w.Graph == nil || world.AgentWaiting(w, s.ID) {
		return nil
	}
	b := e.prepare(ctx, w)
	if b == nil {
		return nil
	}
	return e.candidates(ctx, b, s)
}

// Escape is a one-edge emergency without a refuge target. Hard restrictions and
// forecast weights are shared with normal routing.
func (e *DeterministicEngine) Escape(ctx context.Context, w world.WorldSnapshot, s world.Survivor) world.DecisionResult {
	if ctx.Err() != nil || s.Status != world.Active || w.Graph == nil || world.AgentWaiting(w, s.ID) {
		return wait(s)
	}
	b := e.prepare(ctx, w)
	if b == nil {
		return wait(s)
	}
	return e.escape(b, s)
}

func (e *DeterministicEngine) prepare(ctx context.Context, w world.WorldSnapshot) *bundle {
	key, routingKey, ok := fingerprint(ctx, w, e.options.Prediction)
	if !ok {
		return nil
	}
	if current := e.cache.Load(); current != nil && current.key == key {
		e.hits.Add(1)
		return current
	}
	select {
	case e.gate <- struct{}{}:
	case <-ctx.Done():
		return nil
	}
	defer func() { <-e.gate }()
	if ctx.Err() != nil {
		return nil
	}
	if current := e.cache.Load(); current != nil && current.key == key {
		e.hits.Add(1)
		return current
	}
	result := &bundle{key: key, routingKey: routingKey}
	if previous := e.cache.Load(); previous != nil && previous.routingKey == routingKey {
		// Updating only possible chase targets does not change the four safe
		// reverse searches. Their maps are immutable and can be shared.
		result.env, result.plans, result.shelters, result.shelterIDs = previous.env, previous.plans, previous.shelters, previous.shelterIDs
		e.reusedSearches.Add(uint64(len(previous.plans)))
	} else {
		env, ok := buildEnvironment(ctx, w)
		if !ok {
			return nil
		}
		result.env, result.plans, result.shelters = env, map[string]map[string]choice{}, map[string]world.Shelter{}
		for _, sh := range w.Shelters {
			if !env.nodes[sh.NodeID] || env.danger[sh.NodeID] || sh.Capacity <= sh.Occupancy || world.ShelterUnavailable(w, sh.ID) {
				continue
			}
			result.shelters[sh.ID] = sh
			result.shelterIDs = append(result.shelterIDs, sh.ID)
		}
		sort.Strings(result.shelterIDs)
		for _, id := range result.shelterIDs {
			plan, ok := e.search(ctx, env, result.shelters[id])
			if !ok {
				return nil
			}
			result.plans[id] = plan
			e.searches.Add(1)
		}
	}
	if e.options.Prediction {
		result.forecast = NewRunnerPredictor(e.options.Horizon).Predict(ctx, w)
		e.predictions.Add(1)
	}
	if ctx.Err() != nil {
		return nil
	}
	e.cache.Store(result)
	e.builds.Add(1)
	return result
}

func (e *DeterministicEngine) search(ctx context.Context, env *environment, sh world.Shelter) (map[string]choice, bool) {
	plan := map[string]choice{sh.NodeID: {next: sh.NodeID, shelter: sh.ID}}
	q := &queue{{node: sh.NodeID, choice: plan[sh.NodeID]}}
	heap.Init(q)
	for q.Len() > 0 {
		if ctx.Err() != nil {
			return nil, false
		}
		item := heap.Pop(q).(queued)
		if plan[item.node] != item.choice {
			continue
		}
		for _, edge := range env.reverse[item.node] {
			risk := item.choice.risk + env.risk[item.node]
			cost := item.choice.cost + edge.cost
			candidate := choice{next: item.node, shelter: sh.ID, risk: risk, cost: cost, score: cost + e.options.RiskWeight*risk}
			if old, exists := plan[edge.from]; !exists || better(candidate, old) {
				plan[edge.from] = candidate
				heap.Push(q, queued{node: edge.from, choice: candidate})
			}
		}
	}
	return plan, true
}

func route(plan map[string]choice, start string, limit int) []string {
	if _, ok := plan[start]; !ok {
		return nil
	}
	result := []string{start}
	seen := map[string]bool{start: true}
	node := start
	for len(result) <= limit {
		step, ok := plan[node]
		if !ok {
			return nil
		}
		if step.next == node {
			return result
		}
		node = step.next
		if seen[node] {
			return nil
		}
		seen[node] = true
		result = append(result, node)
	}
	return nil
}

func (e *DeterministicEngine) candidates(ctx context.Context, b *bundle, s world.Survivor) []world.DecisionResult {
	if !b.env.nodes[s.CurrentNode] {
		return nil
	}
	results := []world.DecisionResult{}
	for _, id := range b.shelterIDs {
		if ctx.Err() != nil {
			return nil
		}
		sh := b.shelters[id]
		plan := b.plans[id]
		if s.CurrentNode == sh.NodeID {
			results = append(results, world.DecisionResult{NextNode: s.CurrentNode, TargetShelterID: id, Route: []string{s.CurrentNode}})
			continue
		}
		var best world.DecisionResult
		bestScore := math.Inf(1)
		for _, edge := range b.env.forward[s.CurrentNode] {
			tail := route(plan, edge.to, len(b.env.nodes))
			if len(tail) == 0 {
				continue
			}
			cycle := false
			for _, n := range tail {
				if n == s.CurrentNode {
					cycle = true
					break
				}
			}
			if cycle {
				continue
			}
			points := append([]string{s.CurrentNode}, tail...)
			risk, cost, score := e.score(b, points, true)
			candidate := world.DecisionResult{NextNode: edge.to, TargetShelterID: id, Route: points, EstimatedRisk: risk, Cost: cost}
			if score < bestScore || (score == bestScore && (best.NextNode == "" || edge.to < best.NextNode)) {
				best, bestScore = candidate, score
			}
		}
		if best.NextNode == "" {
			continue
		}
		// A previously published route is retained only while it remains hard-safe
		// and within a bounded score margin, avoiding small-cost reversals.
		if s.TargetShelterID == id && len(s.PlannedRoute) > 1 && validPath(b.env, s.PlannedRoute, s.CurrentNode) && s.PlannedRoute[len(s.PlannedRoute)-1] == sh.NodeID {
			risk, cost, score := e.score(b, s.PlannedRoute, true)
			if score <= bestScore*(1+e.options.Stickiness) && risk <= best.EstimatedRisk+2 {
				best = world.DecisionResult{NextNode: s.PlannedRoute[1], TargetShelterID: id, Route: append([]string{}, s.PlannedRoute...), EstimatedRisk: risk, Cost: cost}
			}
		}
		results = append(results, best)
	}
	sort.Slice(results, func(i, j int) bool {
		a, bv := results[i], results[j]
		as := a.Cost + e.options.RiskWeight*a.EstimatedRisk
		bs := bv.Cost + e.options.RiskWeight*bv.EstimatedRisk
		if as != bs {
			return as < bs
		}
		if a.EstimatedRisk != bv.EstimatedRisk {
			return a.EstimatedRisk < bv.EstimatedRisk
		}
		if a.Cost != bv.Cost {
			return a.Cost < bv.Cost
		}
		return a.TargetShelterID < bv.TargetShelterID
	})
	return results
}

func (e *DeterministicEngine) score(b *bundle, path []string, completesRefuge bool) (risk, cost, score float64) {
	for i := 1; i < len(path); i++ {
		from, to := path[i-1], path[i]
		for _, edge := range b.env.forward[from] {
			if edge.to == to {
				cost += edge.cost
				break
			}
		}
		risk += b.env.risk[to]
	}
	if completesRefuge && len(path) <= 2 {
		// A hard-safe arrival is admitted before the next zombie phase. Future
		// proximity at that refuge cannot threaten an already evacuated person.
		return 0, cost, cost
	}
	// Only the first two future positions receive forecast exposure. A possible
	// runner location next turn must not penalize an entire long route forever.
	if len(path) > 1 {
		forecast := b.forecast.OneTurnNodes[path[1]]
		if len(path) > 2 {
			// The next runner phase occurs after this first survivor step. Its
			// opposite-edge exposure therefore concerns the following segment.
			forecast += b.forecast.EdgeRisk[Transition{From: path[1], To: path[2]}]
			forecast += .35 * b.forecast.TwoTurnNodes[path[2]]
		}
		risk += e.options.PredictionWeight * forecast / e.options.RiskWeight
	}
	score = cost + e.options.RiskWeight*risk
	return
}

func validPath(env *environment, path []string, start string) bool {
	if len(path) == 0 || path[0] != start || !env.nodes[start] {
		return false
	}
	seen := map[string]bool{start: true}
	for i := 1; i < len(path); i++ {
		to := path[i]
		if seen[to] {
			return false
		}
		seen[to] = true
		valid := false
		for _, edge := range env.forward[path[i-1]] {
			if edge.to == to {
				valid = true
				break
			}
		}
		if !valid {
			return false
		}
	}
	return true
}
func (e *DeterministicEngine) assigned(b *bundle, s world.Survivor) (world.DecisionResult, bool) {
	if !validPath(b.env, s.PlannedRoute, s.CurrentNode) {
		return world.DecisionResult{}, false
	}
	if s.TargetShelterID != "" {
		sh, ok := b.shelters[s.TargetShelterID]
		if !ok || s.PlannedRoute[len(s.PlannedRoute)-1] != sh.NodeID {
			return world.DecisionResult{}, false
		}
	} else if len(s.PlannedRoute) > 2 {
		return world.DecisionResult{}, false
	}
	next := s.CurrentNode
	if len(s.PlannedRoute) > 1 {
		next = s.PlannedRoute[1]
	}
	risk, cost, _ := e.score(b, s.PlannedRoute, s.TargetShelterID != "")
	return world.DecisionResult{NextNode: next, TargetShelterID: s.TargetShelterID, Route: append([]string{}, s.PlannedRoute...), EstimatedRisk: risk, Cost: cost}, true
}
func (e *DeterministicEngine) escape(b *bundle, s world.Survivor) world.DecisionResult {
	urgent := b.env.danger[s.CurrentNode]
	currentForecast := b.forecast.OneTurnNodes[s.CurrentNode]
	if !urgent && currentForecast == 0 {
		return wait(s)
	}
	var best world.DecisionResult
	bestScore := math.Inf(1)
	for _, edge := range b.env.forward[s.CurrentNode] {
		points := []string{s.CurrentNode, edge.to}
		risk, cost, score := e.score(b, points, false)
		if !urgent && b.forecast.OneTurnNodes[edge.to] >= currentForecast {
			continue
		}
		if score < bestScore || (score == bestScore && (best.NextNode == "" || edge.to < best.NextNode)) {
			best = world.DecisionResult{NextNode: edge.to, Route: points, EstimatedRisk: risk, Cost: cost}
			bestScore = score
		}
	}
	if best.NextNode == "" {
		return wait(s)
	}
	return best
}

func buildEnvironment(ctx context.Context, w world.WorldSnapshot) (*environment, bool) {
	env := &environment{nodes: map[string]bool{}, topology: map[string][]string{}, forward: map[string][]arc{}, reverse: map[string][]arc{}, danger: map[string]bool{}, forbidden: map[Transition]bool{}, risk: map[string]float64{}}
	for _, n := range w.Graph.Nodes {
		env.nodes[n.ID] = true
	}
	for i, edge := range w.Graph.Edges {
		if i%64 == 0 && ctx.Err() != nil {
			return nil, false
		}
		if env.nodes[edge.From] && env.nodes[edge.To] {
			env.topology[edge.From] = append(env.topology[edge.From], edge.To)
			env.topology[edge.To] = append(env.topology[edge.To], edge.From)
		}
	}
	for n := range env.topology {
		sort.Strings(env.topology[n])
	}
	for _, z := range w.Zombies {
		if ctx.Err() != nil {
			return nil, false
		}
		if z.Type == world.Sleeper && !z.Awake {
			continue
		}
		env.danger[z.CurrentNode] = true
		if z.Type == world.Horde {
			for _, n := range env.topology[z.CurrentNode] {
				env.danger[n] = true
			}
		}
		for i := 1; i < len(z.Path); i++ {
			if z.Path[i] != z.Path[i-1] {
				env.forbidden[Transition{From: z.Path[i], To: z.Path[i-1]}] = true
			}
		}
		seen := map[string]bool{z.CurrentNode: true}
		frontier := []string{z.CurrentNode}
		for d := 1; d <= 2; d++ {
			next := []string{}
			for _, at := range frontier {
				for _, neighbor := range env.topology[at] {
					if seen[neighbor] {
						continue
					}
					seen[neighbor] = true
					next = append(next, neighbor)
					penalty := 2.
					if d == 1 {
						penalty = 10
					}
					if z.Type == world.Runner {
						penalty *= 3
					}
					env.risk[neighbor] += penalty
				}
			}
			frontier = next
		}
	}
	blocked := map[string]bool{}
	for _, id := range w.BlockedEdges {
		blocked[id] = true
	}
	overlay := roadOverlay(w)
	for id, condition := range overlay {
		if condition.blocked {
			blocked[id] = true
		}
	}
	add := func(from, to string, edge world.GraphEdge) {
		if env.danger[to] || env.forbidden[Transition{From: from, To: to}] {
			return
		}
		cost := 1 + edge.DistanceM/1000 + edge.DistanceM/(edge.SpeedMPS*100)
		if multiplier := overlay[edge.ID].multiplier; multiplier > 1 {
			cost *= multiplier
		}
		if math.IsInf(cost, 0) || math.IsNaN(cost) {
			return
		}
		a := arc{from: from, to: to, cost: cost}
		env.forward[from] = append(env.forward[from], a)
		env.reverse[to] = append(env.reverse[to], a)
	}
	for i, edge := range w.Graph.Edges {
		if i%64 == 0 && ctx.Err() != nil {
			return nil, false
		}
		if edge.Blocked || blocked[edge.ID] || !env.nodes[edge.From] || !env.nodes[edge.To] || edge.From == edge.To || edge.DistanceM <= 0 || edge.SpeedMPS <= 0 || math.IsNaN(edge.DistanceM) || math.IsNaN(edge.SpeedMPS) || math.IsInf(edge.DistanceM, 0) || math.IsInf(edge.SpeedMPS, 0) {
			continue
		}
		add(edge.From, edge.To, edge)
		if !edge.Directed {
			add(edge.To, edge.From, edge)
		}
	}
	for n := range env.forward {
		sort.Slice(env.forward[n], func(i, j int) bool {
			a, b := env.forward[n][i], env.forward[n][j]
			if a.to != b.to {
				return a.to < b.to
			}
			return a.cost < b.cost
		})
	}
	for n := range env.reverse {
		sort.Slice(env.reverse[n], func(i, j int) bool {
			a, b := env.reverse[n][i], env.reverse[n][j]
			if a.from != b.from {
				return a.from < b.from
			}
			return a.cost < b.cost
		})
	}
	return env, true
}

type roadEffect struct {
	blocked    bool
	multiplier float64
}

// Only effective restrictions and costs belong to routing. Descriptive risk
// values and update timestamps must not invalidate shared reverse searches.
func roadOverlay(w world.WorldSnapshot) map[string]roadEffect {
	if w.Scenario == nil {
		return nil
	}
	effects := make(map[string]roadEffect, len(w.Scenario.RoadConditions))
	for _, condition := range w.Scenario.RoadConditions {
		effect := effects[condition.EdgeID]
		if condition.State == "blocked" {
			effect.blocked = true
		}
		if condition.State == "caution" && condition.CostMultiplier > effect.multiplier && condition.CostMultiplier > 1 && !math.IsNaN(condition.CostMultiplier) && !math.IsInf(condition.CostMultiplier, 0) {
			effect.multiplier = condition.CostMultiplier
		}
		if effect.blocked || effect.multiplier > 1 {
			effects[condition.EdgeID] = effect
		}
	}
	return effects
}

func fingerprint(ctx context.Context, w world.WorldSnapshot, prediction bool) (uint64, uint64, bool) {
	h := fnv.New64a()
	var numeric [8]byte
	number := func(v uint64) { binary.LittleEndian.PutUint64(numeric[:], v); _, _ = h.Write(numeric[:]) }
	str := func(v string) { number(uint64(len(v))); _, _ = h.Write([]byte(v)) }
	boolean := func(v bool) {
		if v {
			number(1)
		} else {
			number(0)
		}
	}
	str(w.GraphVersion)
	str(w.Graph.Version)
	number(uint64(len(w.Graph.Nodes)))
	for i, n := range w.Graph.Nodes {
		if i%64 == 0 && ctx.Err() != nil {
			return 0, 0, false
		}
		str(n.ID)
	}
	overlay := roadOverlay(w)
	number(uint64(len(w.Graph.Edges)))
	for i, edge := range w.Graph.Edges {
		if i%64 == 0 && ctx.Err() != nil {
			return 0, 0, false
		}
		str(edge.ID)
		str(edge.From)
		str(edge.To)
		str(edge.RoadType)
		number(math.Float64bits(edge.DistanceM))
		number(math.Float64bits(edge.SpeedMPS))
		boolean(edge.Blocked || overlay[edge.ID].blocked)
		boolean(edge.Directed)
		if effect := overlay[edge.ID]; !edge.Blocked && !effect.blocked && effect.multiplier > 1 {
			str("scenario_road_cost")
			number(math.Float64bits(effect.multiplier))
		}
	}
	number(uint64(len(w.BlockedEdges)))
	for _, id := range w.BlockedEdges {
		str(id)
	}
	for _, z := range w.Zombies {
		if z.Type == world.Sleeper && !z.Awake {
			continue
		}
		str(z.ID)
		str(z.Type)
		str(z.CurrentNode)
		number(uint64(len(z.Path)))
		for _, node := range z.Path {
			str(node)
		}
	}
	number(uint64(len(w.Shelters)))
	for _, sh := range w.Shelters {
		str(sh.ID)
		str(sh.NodeID)
		number(uint64(sh.Capacity))
		number(uint64(sh.Occupancy))
		if world.ShelterUnavailable(w, sh.ID) {
			str("scenario_shelter_unavailable")
		}
	}
	routingKey := h.Sum64()
	visibleRunner := false
	for _, z := range w.Zombies {
		if z.Type == world.Runner {
			visibleRunner = true
			break
		}
	}
	if prediction && visibleRunner {
		for _, s := range w.Survivors {
			if s.Status == world.Active {
				str(s.ID)
				str(s.CurrentNode)
			}
		}
	}
	return h.Sum64(), routingKey, ctx.Err() == nil
}
