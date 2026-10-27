// Package coordination prepares capacity-constrained destinations before HTTP
// requests read a turn. Reservations are derived from the complete active set.
package coordination

import (
	"context"
	"math"
	"sort"
	"sync"
	"time"

	"corodev/evacuation/internal/world"
)

type RouteProvider interface {
	Candidates(context.Context, world.WorldSnapshot, world.Survivor) []world.DecisionResult
}

type escapeProvider interface {
	Escape(context.Context, world.WorldSnapshot, world.Survivor) world.DecisionResult
}

type Options struct {
	// DisableAssignment uses independent ID-ordered choices rather than global
	// constraint/regret allocation. Capacity is still enforced atomically.
	DisableAssignment bool
	// Stickiness is a fractional movement-cost tolerance for preserving a target
	// with the same estimated risk. Zero selects the default 0.15.
	Stickiness float64
}

type Statistics struct {
	Turn               int     `json:"turn"`
	WorldVersion       uint64  `json:"world_version"`
	Active             int     `json:"active"`
	Assigned           int     `json:"assigned"`
	Retained           int     `json:"retained"`
	Reassigned         int     `json:"reassigned"`
	Unassigned         int     `json:"unassigned"`
	NoRoute            int     `json:"no_route"`
	CapacityLimited    int     `json:"capacity_limited"`
	RejectedCandidates int     `json:"rejected_candidates"`
	DurationMS         float64 `json:"duration_ms"`
	Canceled           bool    `json:"canceled"`
}

// Planner owns no authoritative allocation state. Concurrent Prepare calls use
// independent snapshots; only the last statistics value needs synchronization.
type Planner struct {
	provider          RouteProvider
	stickiness        float64
	mu                sync.RWMutex
	statistics        Statistics
	disableAssignment bool
}

func New(provider RouteProvider, options Options) *Planner {
	stickiness := options.Stickiness
	if stickiness <= 0 || math.IsNaN(stickiness) || math.IsInf(stickiness, 0) {
		stickiness = .15
	}
	return &Planner{provider: provider, stickiness: stickiness, disableAssignment: options.DisableAssignment}
}

func (p *Planner) Stats() Statistics {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.statistics
}

type pair struct{ from, to string }
type topology struct {
	nodes     map[string]bool
	legal     map[pair]bool
	danger    map[string]bool
	horde     map[string]bool
	forbidden map[pair]bool
}

func index(w world.WorldSnapshot) topology {
	t := topology{nodes: map[string]bool{}, legal: map[pair]bool{}, danger: map[string]bool{}, horde: map[string]bool{}, forbidden: map[pair]bool{}}
	if w.Graph == nil {
		return t
	}
	blocked := map[string]bool{}
	for _, id := range w.BlockedEdges {
		blocked[id] = true
	}
	if w.Scenario != nil {
		for _, condition := range w.Scenario.RoadConditions {
			if condition.State == "blocked" {
				blocked[condition.EdgeID] = true
			}
		}
	}
	for _, n := range w.Graph.Nodes {
		t.nodes[n.ID] = true
	}
	physical := map[string][]string{}
	for _, e := range w.Graph.Edges {
		if !t.nodes[e.From] || !t.nodes[e.To] || e.From == e.To {
			continue
		}
		physical[e.From] = append(physical[e.From], e.To)
		physical[e.To] = append(physical[e.To], e.From)
		if e.Blocked || blocked[e.ID] {
			continue
		}
		t.legal[pair{e.From, e.To}] = true
		if !e.Directed {
			t.legal[pair{e.To, e.From}] = true
		}
	}
	for _, z := range w.Zombies {
		if z.Type == world.Sleeper && !z.Awake {
			continue
		}
		t.danger[z.CurrentNode] = true
		if z.Type == world.Horde {
			t.horde[z.CurrentNode] = true
			for _, at := range physical[z.CurrentNode] {
				t.danger[at] = true
				t.horde[at] = true
			}
		}
		for i := 1; i < len(z.Path); i++ {
			if z.Path[i] != z.Path[i-1] {
				t.forbidden[pair{z.Path[i], z.Path[i-1]}] = true
			}
		}
	}
	return t
}

func (t topology) validRoute(route []string, current string) bool {
	if len(route) == 0 || route[0] != current || !t.nodes[current] {
		return false
	}
	seen := map[string]bool{current: true}
	for i := 1; i < len(route); i++ {
		if !t.legal[pair{route[i-1], route[i]}] || seen[route[i]] || t.horde[route[i]] {
			return false
		}
		seen[route[i]] = true
		// Immediate movement must satisfy all observable hard restrictions.
		// Threats farther down a dynamic route remain estimates for future turns.
		if i == 1 && (t.danger[route[i]] || t.forbidden[pair{route[0], route[i]}]) {
			return false
		}
	}
	return true
}

type request struct {
	index      int
	survivor   world.Survivor
	candidates []world.DecisionResult
}

func better(a, b world.DecisionResult) bool {
	if a.EstimatedRisk != b.EstimatedRisk {
		return a.EstimatedRisk < b.EstimatedRisk
	}
	if a.Cost != b.Cost {
		return a.Cost < b.Cost
	}
	if a.TargetShelterID != b.TargetShelterID {
		return a.TargetShelterID < b.TargetShelterID
	}
	if len(a.Route) != len(b.Route) {
		return len(a.Route) < len(b.Route)
	}
	for i := range a.Route {
		if a.Route[i] != b.Route[i] {
			return a.Route[i] < b.Route[i]
		}
	}
	return a.NextNode < b.NextNode
}

func (p *Planner) Prepare(ctx context.Context, input world.WorldSnapshot) world.WorldSnapshot {
	started := time.Now()
	output := input.Clone()
	stats := Statistics{Turn: input.Turn, WorldVersion: input.WorldVersion}
	defer func() {
		stats.DurationMS = float64(time.Since(started)) / float64(time.Millisecond)
		p.mu.Lock()
		p.statistics = stats
		p.mu.Unlock()
	}()
	// Previous reserved counts are observations of the previous allocation, not
	// additional occupied seats. Rebuild them from all current active survivors.
	capacity := map[string]int{}
	shelters := map[string]world.Shelter{}
	for i := range output.Shelters {
		sh := &output.Shelters[i]
		sh.Reserved = 0
		sh.Available = sh.Capacity - sh.Occupancy
		if sh.Available < 0 {
			sh.Available = 0
		}
		capacity[sh.ID] = sh.Available
		shelters[sh.ID] = *sh
	}
	for i := range output.Survivors {
		v := &output.Survivors[i]
		if v.Status == world.Active {
			stats.Active++
			v.TargetShelterID = ""
			v.PlannedRoute = []string{v.CurrentNode}
			if world.AgentWaiting(input, v.ID) {
				stats.Unassigned++
			}
		}
		if v.Status == world.Bitten {
			v.TargetShelterID = ""
			v.PlannedRoute = []string{}
		}
	}
	if ctx.Err() != nil || p.provider == nil || input.Graph == nil {
		stats.Canceled = ctx.Err() != nil
		stats.Unassigned = stats.Active
		return output
	}
	top := index(input)
	requests := make([]request, 0, stats.Active)
	order := make([]int, 0, stats.Active)
	for i, v := range input.Survivors {
		if v.Status == world.Active && !world.AgentWaiting(input, v.ID) {
			order = append(order, i)
		}
	}
	sort.Slice(order, func(i, j int) bool { return input.Survivors[order[i]].ID < input.Survivors[order[j]].ID })
	for _, i := range order {
		if ctx.Err() != nil {
			stats.Canceled = true
			stats.Unassigned = stats.Active
			return output
		}
		v := input.Survivors[i]
		byShelter := map[string]world.DecisionResult{}
		for _, candidate := range p.provider.Candidates(ctx, input, v) {
			sh, exists := shelters[candidate.TargetShelterID]
			valid := exists && !world.ShelterUnavailable(input, sh.ID) && capacity[sh.ID] > 0 && len(candidate.Route) > 0 && candidate.Route[len(candidate.Route)-1] == sh.NodeID && top.validRoute(candidate.Route, v.CurrentNode) && !(len(candidate.Route) == 1 && top.danger[v.CurrentNode]) && candidate.Cost >= 0 && candidate.EstimatedRisk >= 0 && !math.IsNaN(candidate.Cost) && !math.IsNaN(candidate.EstimatedRisk) && !math.IsInf(candidate.Cost, 0) && !math.IsInf(candidate.EstimatedRisk, 0)
			if valid {
				next := v.CurrentNode
				if len(candidate.Route) > 1 {
					next = candidate.Route[1]
				}
				valid = candidate.NextNode == next
			}
			if !valid {
				stats.RejectedCandidates++
				continue
			}
			candidate.Route = append([]string{}, candidate.Route...)
			if old, found := byShelter[sh.ID]; !found || better(candidate, old) {
				byShelter[sh.ID] = candidate
			}
		}
		candidates := make([]world.DecisionResult, 0, len(byShelter))
		for _, candidate := range byShelter {
			candidates = append(candidates, candidate)
		}
		sort.Slice(candidates, func(i, j int) bool { return better(candidates[i], candidates[j]) })
		requests = append(requests, request{index: i, survivor: v, candidates: candidates})
	}
	reserved := map[string]int{}
	assigned := map[string]bool{}
	assign := func(r request, candidate world.DecisionResult, retained bool) {
		v := &output.Survivors[r.index]
		v.TargetShelterID = candidate.TargetShelterID
		v.PlannedRoute = append([]string{}, candidate.Route...)
		reserved[candidate.TargetShelterID]++
		assigned[v.ID] = true
		stats.Assigned++
		if retained {
			stats.Retained++
		} else if r.survivor.TargetShelterID != "" && r.survivor.TargetShelterID != candidate.TargetShelterID {
			stats.Reassigned++
		}
	}
	// Valid existing reservations are released only when risk/cost has become
	// materially worse or the route/capacity is no longer viable.
	for _, r := range requests {
		if p.disableAssignment {
			break
		}
		if len(r.candidates) == 0 || r.survivor.TargetShelterID == "" {
			continue
		}
		best := r.candidates[0]
		for _, candidate := range r.candidates {
			if candidate.TargetShelterID == r.survivor.TargetShelterID && reserved[candidate.TargetShelterID] < capacity[candidate.TargetShelterID] && candidate.EstimatedRisk <= best.EstimatedRisk && candidate.Cost <= best.Cost*(1+p.stickiness)+1e-9 {
				assign(r, candidate, true)
				break
			}
		}
	}
	// Most constrained survivors go first. Among equally constrained requests,
	// prioritize the largest risk/cost regret from losing their best destination.
	sort.Slice(requests, func(i, j int) bool {
		if p.disableAssignment {
			return requests[i].survivor.ID < requests[j].survivor.ID
		}
		a, b := requests[i], requests[j]
		if len(a.candidates) != len(b.candidates) {
			return len(a.candidates) < len(b.candidates)
		}
		if len(a.candidates) > 1 {
			ar, br := a.candidates[1].EstimatedRisk-a.candidates[0].EstimatedRisk, b.candidates[1].EstimatedRisk-b.candidates[0].EstimatedRisk
			if ar != br {
				return ar > br
			}
			ac, bc := a.candidates[1].Cost-a.candidates[0].Cost, b.candidates[1].Cost-b.candidates[0].Cost
			if ac != bc {
				return ac > bc
			}
		}
		return a.survivor.ID < b.survivor.ID
	})
	for _, r := range requests {
		if assigned[r.survivor.ID] {
			continue
		}
		var selected world.DecisionResult
		found := false
		for _, candidate := range r.candidates {
			if reserved[candidate.TargetShelterID] >= capacity[candidate.TargetShelterID] {
				continue
			}
			choose := !found || candidate.EstimatedRisk < selected.EstimatedRisk || (candidate.EstimatedRisk == selected.EstimatedRisk && candidate.Cost < selected.Cost)
			if found && !p.disableAssignment && candidate.EstimatedRisk == selected.EstimatedRisk && candidate.Cost == selected.Cost {
				a, b := shelters[candidate.TargetShelterID], shelters[selected.TargetShelterID]
				left, right := (a.Occupancy+reserved[a.ID]+1)*b.Capacity, (b.Occupancy+reserved[b.ID]+1)*a.Capacity
				choose = left < right || (left == right && candidate.TargetShelterID < selected.TargetShelterID)
			}
			if choose {
				selected, found = candidate, true
			}
		}
		if found {
			assign(r, selected, false)
			continue
		}
		stats.Unassigned++
		if len(r.candidates) == 0 {
			stats.NoRoute++
		} else {
			stats.CapacityLimited++
		}
		// Forecast danger can justify an escape before a runner reaches the
		// current node. Let the predictor decide for every unassigned survivor;
		// it returns a wait when no justified improvement exists. The selected
		// move reserves no capacity and passes the same hard movement guards.
		v := r.survivor
		v.TargetShelterID = ""
		v.PlannedRoute = []string{}
		var step world.DecisionResult
		if provider, ok := p.provider.(escapeProvider); ok {
			step = provider.Escape(ctx, input, v)
		} else if provider, ok := p.provider.(world.DecisionEngine); ok && top.danger[v.CurrentNode] {
			step = provider.NextStep(ctx, input, v)
		}
		route := []string{v.CurrentNode, step.NextNode}
		if step.NextNode != v.CurrentNode && top.validRoute(route, v.CurrentNode) {
			output.Survivors[r.index].PlannedRoute = route
		}
	}
	for i := range output.Shelters {
		sh := &output.Shelters[i]
		sh.Reserved = reserved[sh.ID]
		sh.Available = capacity[sh.ID] - sh.Reserved
	}
	return output
}
