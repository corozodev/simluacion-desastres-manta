// Frozen FASE 1 engine for evaluation only; production uses decision.
// Package decision provides deterministic, local routing from observable state.
package phase1

import (
	"container/heap"
	"context"
	"encoding/binary"
	"hash/fnv"
	"math"
	"sort"

	"corodev/evacuation/internal/world"
)

// DeterministicEngine shares one reverse, multi-source Dijkstra plan among all
// requests for an immutable snapshot. The cache retains only the latest plan.
type DeterministicEngine struct {
	gate  chan struct{}
	key   uint64
	ready bool
	plan  map[string]choice
}

func New() *DeterministicEngine { return &DeterministicEngine{gate: make(chan struct{}, 1)} }

type choice struct {
	next, shelter string
	risk          int
	cost          float64
}
type arc struct {
	from, to string
	cost     float64
}
type pair struct{ from, to string }
type queued struct {
	node   string
	choice choice
}
type queue []queued

func (q queue) Len() int { return len(q) }
func (q queue) Less(i, j int) bool {
	a, b := q[i], q[j]
	if less(a.choice, b.choice) {
		return true
	}
	if less(b.choice, a.choice) {
		return false
	}
	return a.node < b.node
}
func (q queue) Swap(i, j int) { q[i], q[j] = q[j], q[i] }
func (q *queue) Push(v any)   { *q = append(*q, v.(queued)) }
func (q *queue) Pop() any     { old := *q; v := old[len(old)-1]; *q = old[:len(old)-1]; return v }

func less(a, b choice) bool {
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

// NextStep may leave an endangered current node, but will never enter a visible
// zombie node, a horde exclusion node, a blocked road or an opposite traversal.
// A survivor crosses at most one edge, regardless of the road's speed.
func (e *DeterministicEngine) NextStep(ctx context.Context, w world.WorldSnapshot, s world.Survivor) world.DecisionResult {
	wait := world.DecisionResult{NextNode: s.CurrentNode, Route: []string{s.CurrentNode}}
	if ctx.Err() != nil || s.Status != world.Active || w.Graph == nil {
		return wait
	}
	key, ok := fingerprint(ctx, w)
	if !ok {
		return wait
	}
	select {
	case e.gate <- struct{}{}:
	case <-ctx.Done():
		return wait
	}
	defer func() { <-e.gate }()
	if ctx.Err() != nil {
		return wait
	}
	if !e.ready || e.key != key {
		plan, ok := buildPlan(ctx, w)
		if !ok {
			return wait
		}
		e.plan, e.key, e.ready = plan, key, true
	}
	current, exists := e.plan[s.CurrentNode]
	if !exists {
		return wait
	}
	// An emergency escape has no shelter continuation. It is deliberately one
	// edge long so the next observable snapshot can reassess the situation.
	if current.shelter == "" {
		return world.DecisionResult{NextNode: current.next, Route: []string{s.CurrentNode, current.next}}
	}
	route := []string{s.CurrentNode}
	node := s.CurrentNode
	visited := map[string]bool{node: true}
	for len(route) <= len(w.Graph.Nodes) {
		if ctx.Err() != nil {
			return wait
		}
		step, found := e.plan[node]
		if !found {
			return wait
		}
		if step.next == node {
			break
		}
		node = step.next
		if visited[node] {
			return wait
		}
		visited[node] = true
		route = append(route, node)
	}
	if len(route) > len(w.Graph.Nodes) {
		return wait
	}
	return world.DecisionResult{NextNode: current.next, TargetShelterID: current.shelter, Route: route}
}

// Fingerprint actual routing inputs as well as versions. This also invalidates
// safely when a producer accidentally reuses a version after modifying a block,
// zombie path, shelter occupancy or graph edge. Survivor lists do not affect this
// independent routing policy, so 200 callers can reuse the same plan.
func fingerprint(ctx context.Context, w world.WorldSnapshot) (uint64, bool) {
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
	number(w.WorldVersion)
	str(w.Graph.Version)
	number(uint64(len(w.Graph.Nodes)))
	for i, n := range w.Graph.Nodes {
		if i%64 == 0 && ctx.Err() != nil {
			return 0, false
		}
		str(n.ID)
	}
	number(uint64(len(w.Graph.Edges)))
	for i, edge := range w.Graph.Edges {
		if i%64 == 0 && ctx.Err() != nil {
			return 0, false
		}
		str(edge.ID)
		str(edge.From)
		str(edge.To)
		str(edge.RoadType)
		number(math.Float64bits(edge.DistanceM))
		number(math.Float64bits(edge.SpeedMPS))
		boolean(edge.Blocked)
		boolean(edge.Directed)
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
	for _, s := range w.Shelters {
		str(s.ID)
		str(s.NodeID)
		number(uint64(s.Capacity))
		number(uint64(s.Occupancy))
	}
	return h.Sum64(), ctx.Err() == nil
}

func buildPlan(ctx context.Context, w world.WorldSnapshot) (map[string]choice, bool) {
	nodes := make(map[string]bool, len(w.Graph.Nodes))
	topology := make(map[string][]string, len(w.Graph.Nodes))
	for _, n := range w.Graph.Nodes {
		nodes[n.ID] = true
	}
	for i, edge := range w.Graph.Edges {
		if i%64 == 0 && ctx.Err() != nil {
			return nil, false
		}
		if !nodes[edge.From] || !nodes[edge.To] {
			continue
		}
		topology[edge.From] = append(topology[edge.From], edge.To)
		topology[edge.To] = append(topology[edge.To], edge.From)
	}
	danger := map[string]bool{}
	forbidden := map[pair]bool{}
	risk := map[string]int{}
	for _, z := range w.Zombies {
		if ctx.Err() != nil {
			return nil, false
		}
		if z.Type == world.Sleeper && !z.Awake {
			continue
		}
		danger[z.CurrentNode] = true
		if z.Type == world.Horde {
			for _, neighbor := range topology[z.CurrentNode] {
				danger[neighbor] = true
			}
		}
		for i := 1; i < len(z.Path); i++ {
			if z.Path[i] != z.Path[i-1] {
				forbidden[pair{z.Path[i], z.Path[i-1]}] = true
			}
		}
		// Proximity is physical (undirected), while legal movement below respects
		// edge direction. Only the observable current positions influence risk.
		seen := map[string]bool{z.CurrentNode: true}
		frontier := []string{z.CurrentNode}
		for distance := 1; distance <= 2; distance++ {
			next := []string{}
			for _, at := range frontier {
				for _, neighbor := range topology[at] {
					if !seen[neighbor] {
						seen[neighbor] = true
						next = append(next, neighbor)
						penalty := 2
						if distance == 1 {
							penalty = 10
						}
						if z.Type == world.Runner {
							penalty *= 3
						}
						risk[neighbor] += penalty
					}
				}
			}
			frontier = next
		}
	}
	blocked := map[string]bool{}
	for _, id := range w.BlockedEdges {
		blocked[id] = true
	}
	reverse := make(map[string][]arc, len(nodes))
	forward := make(map[string][]arc, len(nodes))
	add := func(from, to string, edge world.GraphEdge) {
		if danger[to] || forbidden[pair{from, to}] {
			return
		}
		cost := 1 + edge.DistanceM/1000 + edge.DistanceM/(edge.SpeedMPS*100)
		if math.IsInf(cost, 0) || math.IsNaN(cost) {
			return
		}
		reverse[to] = append(reverse[to], arc{from: from, to: to, cost: cost})
		forward[from] = append(forward[from], arc{from: from, to: to, cost: cost})
	}
	for i, edge := range w.Graph.Edges {
		if i%64 == 0 && ctx.Err() != nil {
			return nil, false
		}
		if edge.Blocked || blocked[edge.ID] || !nodes[edge.From] || !nodes[edge.To] || edge.From == edge.To || edge.DistanceM <= 0 || edge.SpeedMPS <= 0 || math.IsNaN(edge.DistanceM) || math.IsNaN(edge.SpeedMPS) || math.IsInf(edge.DistanceM, 0) || math.IsInf(edge.SpeedMPS, 0) {
			continue
		}
		add(edge.From, edge.To, edge)
		if !edge.Directed {
			add(edge.To, edge.From, edge)
		}
	}
	for key := range reverse {
		sort.Slice(reverse[key], func(i, j int) bool {
			a, b := reverse[key][i], reverse[key][j]
			if a.from != b.from {
				return a.from < b.from
			}
			return a.cost < b.cost
		})
	}
	plan := make(map[string]choice, len(nodes))
	pq := &queue{}
	for _, s := range w.Shelters {
		if !nodes[s.NodeID] || danger[s.NodeID] || s.Capacity <= s.Occupancy {
			continue
		}
		candidate := choice{next: s.NodeID, shelter: s.ID}
		if old, exists := plan[s.NodeID]; !exists || less(candidate, old) {
			plan[s.NodeID] = candidate
			heap.Push(pq, queued{node: s.NodeID, choice: candidate})
		}
	}
	for pq.Len() > 0 {
		if ctx.Err() != nil {
			return nil, false
		}
		item := heap.Pop(pq).(queued)
		if current := plan[item.node]; current != item.choice {
			continue
		}
		for _, edge := range reverse[item.node] {
			candidate := choice{next: item.node, shelter: item.choice.shelter, risk: item.choice.risk + risk[item.node], cost: item.choice.cost + edge.cost}
			if old, exists := plan[edge.from]; !exists || less(candidate, old) {
				plan[edge.from] = candidate
				heap.Push(pq, queued{node: edge.from, choice: candidate})
			}
		}
	}
	// A missing shelter route does not justify waiting on a visible threat
	// when a safe exit exists. Add only local escapes for endangered nodes;
	// never propagate these choices through the refuge routing plan.
	for node := range nodes {
		if ctx.Err() != nil {
			return nil, false
		}
		if _, found := plan[node]; found || !danger[node] {
			continue
		}
		for _, edge := range forward[node] {
			candidate := choice{next: edge.to, risk: risk[edge.to], cost: edge.cost}
			if old, found := plan[node]; !found || less(candidate, old) {
				plan[node] = candidate
			}
		}
	}
	return plan, true
}
