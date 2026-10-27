package simulation

import (
	"context"
	"errors"
	"fmt"
	"math"
	"math/rand"
	"net"
	"sort"
	"sync"
	"time"

	"corodev/evacuation/internal/diagnostics"
	"corodev/evacuation/internal/graph"
	"corodev/evacuation/internal/world"
)

type zombieState struct {
	observable world.Zombie
	awakeTurns int // Hidden cadence is not input to decision engines.
	memory     movementMemory
}

// Simulator is the single writer. Snapshot reads are served by the independent
// immutable Store, so HTTP decisions never need the turn mutex.
type Simulator struct {
	mu           sync.Mutex
	graph        *world.Graph
	index        *graph.Index
	store        *world.Store
	config       Config
	client       DecisionClient
	rng          *rand.Rand
	turn         int
	version      uint64
	zombies      []zombieState
	survivors    []world.Survivor
	shelters     []world.Shelter
	blocked      map[string]bool
	proximity    map[string][]string
	events       []ScheduledEvent
	metrics      world.Metrics
	latencies    []time.Duration
	planner      world.TurnPlanner
	diagnostic   diagnosticState
	scenario     threatScenario
	fleet        []world.RescueVehicle
	fleetMetrics world.RescueFleetMetrics
}

func New(g *world.Graph, store *world.Store, cfg Config, client DecisionClient) (*Simulator, error) {
	if store == nil || client == nil {
		return nil, fmt.Errorf("snapshot store and decision client are required")
	}
	var configErr error
	cfg, configErr = normalizeScenario(cfg)
	if configErr != nil {
		return nil, configErr
	}
	idx, err := graph.New(g)
	if err != nil {
		return nil, fmt.Errorf("simulation graph: %w", err)
	}
	if cfg.Turns == 0 {
		cfg.Turns = 150
	}
	if cfg.Concurrency == 0 {
		cfg.Concurrency = 16
	}
	if cfg.Concurrency < 1 || cfg.Concurrency > 200 || cfg.HordeMoveEvery < 0 || cfg.Turns < 1 || cfg.Survivors < 0 || cfg.Survivors > 200 || cfg.Walkers < 0 || cfg.Runners < 0 || cfg.Hordes < 0 || cfg.Sleepers < 0 || len(cfg.InitialSurvivors) > 200 || cfg.InitialRandomNodeCount < 0 {
		return nil, fmt.Errorf("invalid simulation counts, turns or concurrency")
	}
	s := &Simulator{
		graph: g.Clone(), index: idx, store: store, config: cfg, client: client,
		rng: rand.New(rand.NewSource(cfg.Seed)), version: 1,
		blocked: map[string]bool{}, proximity: map[string][]string{},
		shelters: append([]world.Shelter{}, g.Shelters...),
	}
	for _, edge := range g.Edges {
		if edge.Blocked {
			s.blocked[edge.ID] = true
		}
		s.proximity[edge.From] = append(s.proximity[edge.From], edge.To)
		s.proximity[edge.To] = append(s.proximity[edge.To], edge.From)
	}
	for node, neighbors := range s.proximity {
		sort.Strings(neighbors)
		unique := neighbors[:0]
		for _, n := range neighbors {
			if len(unique) == 0 || unique[len(unique)-1] != n {
				unique = append(unique, n)
			}
		}
		s.proximity[node] = unique
	}
	if err := s.initialize(cfg); err != nil {
		return nil, err
	}
	if err := s.schedule(cfg.Events); err != nil {
		return nil, err
	}
	s.scenario, err = newThreatScenario(s)
	if err != nil {
		return nil, err
	}
	s.initDiagnostics()
	s.initializeFleet()
	s.publish(nil)
	return s, nil
}

func (s *Simulator) initialize(cfg Config) error {
	nodes := append([]world.GraphNode{}, s.graph.Nodes...)
	sort.Slice(nodes, func(i, j int) bool { return nodes[i].ID < nodes[j].ID })
	shelterNodes := map[string]bool{}
	// An explicit original exclusion set freezes spawn geography when shelters
	// are replaced. Unioning the edited locations would change the population/RNG.
	if len(cfg.SpawnExcludedNodeIDs) == 0 {
		for _, shelter := range s.shelters {
			shelterNodes[shelter.NodeID] = true
		}
	}
	for _, node := range cfg.SpawnExcludedNodeIDs {
		shelterNodes[node] = true
	}
	spawn := []string{}
	for _, n := range nodes {
		if !shelterNodes[n.ID] {
			spawn = append(spawn, n.ID)
		}
	}
	if len(spawn) == 0 {
		for _, n := range nodes {
			spawn = append(spawn, n.ID)
		}
	}
	if len(cfg.InitialSurvivors) > 0 {
		for _, survivor := range cfg.InitialSurvivors {
			survivor.PlannedRoute = append([]string{}, survivor.PlannedRoute...)
			s.survivors = append(s.survivors, survivor)
		}
	} else if cfg.UseSpawnZones {
		if err := s.initializeZoneSurvivors(cfg, shelterNodes); err != nil {
			return err
		}
	} else {
		for i := 0; i < cfg.Survivors; i++ {
			s.survivors = append(s.survivors, world.Survivor{ID: fmt.Sprintf("S-%04d", i+1), CurrentNode: spawn[s.rng.Intn(len(spawn))], Status: world.Active, PlannedRoute: []string{}})
		}
	}
	seen := map[string]bool{}
	for i := range s.survivors {
		v := &s.survivors[i]
		if _, ok := s.index.Node(v.CurrentNode); !ok || v.ID == "" || seen[v.ID] {
			return fmt.Errorf("invalid or duplicate survivor spawn")
		}
		seen[v.ID] = true
		if v.Status == "" {
			v.Status = world.Active
		}
		if v.Status != world.Active {
			return fmt.Errorf("initial survivors must be active")
		}
		if v.VehicleID != "" {
			return fmt.Errorf("initial survivors cannot already be passengers")
		}
		v.PlannedRoute = append([]string{}, v.PlannedRoute...)
	}
	sort.Slice(s.survivors, func(i, j int) bool { return s.survivors[i].ID < s.survivors[j].ID })
	initial := append([]world.Zombie{}, cfg.InitialZombies...)
	if len(initial) == 0 {
		for _, count := range []struct {
			kind string
			n    int
		}{{world.Walker, cfg.Walkers}, {world.Runner, cfg.Runners}, {world.Horde, cfg.Hordes}, {world.Sleeper, cfg.Sleepers}} {
			for i := 0; i < count.n; i++ {
				candidates := spawn
				if cfg.UseSpawnZones && !cfg.AllowInitialOverlaps {
					candidates = s.zombieCandidates(spawn, count.kind)
					if len(candidates) == 0 {
						return fmt.Errorf("no valid zombie spawn nodes")
					}
				}
				initial = append(initial, world.Zombie{ID: fmt.Sprintf("Z-%04d", len(initial)+1), Type: count.kind, CurrentNode: candidates[s.rng.Intn(len(candidates))], Awake: count.kind != world.Sleeper})
			}
		}
	}
	seen = map[string]bool{}
	for _, z := range initial {
		if _, ok := s.index.Node(z.CurrentNode); !ok || z.ID == "" || seen[z.ID] {
			return fmt.Errorf("invalid or duplicate zombie spawn")
		}
		seen[z.ID] = true
		if z.Type != world.Walker && z.Type != world.Runner && z.Type != world.Horde && z.Type != world.Sleeper {
			return fmt.Errorf("invalid zombie type")
		}
		if z.Type != world.Sleeper {
			z.Awake = true
		}
		z.Path = []string{z.CurrentNode}
		z.MovementState = "resting"
		s.zombies = append(s.zombies, zombieState{observable: z})
	}
	sort.Slice(s.zombies, func(i, j int) bool { return s.zombies[i].observable.ID < s.zombies[j].observable.ID })
	if cfg.InitialRandomNodeCount > 0 {
		if len(cfg.InitialSurvivors) == 0 || len(cfg.InitialZombies) == 0 {
			return fmt.Errorf("initial_random_node_count requires explicit survivors and zombies")
		}
		for i := 0; i < len(s.survivors)+len(s.zombies); i++ {
			s.rng.Intn(cfg.InitialRandomNodeCount)
		}
	}
	return nil
}

func (s *Simulator) schedule(events []ScheduledEvent) error {
	edges := append([]world.GraphEdge{}, s.graph.Edges...)
	sort.Slice(edges, func(i, j int) bool { return edges[i].ID < edges[j].ID })
	ids := map[string]bool{}
	for _, edge := range edges {
		ids[edge.ID] = true
	}
	for _, event := range events {
		if event.Turn < 1 || event.Turn > s.config.Turns {
			return fmt.Errorf("event turn is outside scenario")
		}
		if event.EdgeID == "" {
			if event.EdgeIndex < 0 || event.EdgeIndex >= len(edges) {
				return fmt.Errorf("event edge index is outside graph")
			}
			event.EdgeID = edges[event.EdgeIndex].ID
		}
		if !ids[event.EdgeID] {
			return fmt.Errorf("event references unknown edge")
		}
		if event.Type == "" {
			event.Type = "street_block"
		}
		s.events = append(s.events, event)
	}
	sort.SliceStable(s.events, func(i, j int) bool { return s.events[i].Turn < s.events[j].Turn })
	return nil
}

func (s *Simulator) Snapshot() world.WorldSnapshot {
	w, _ := s.store.Load()
	return w
}

func (s *Simulator) Step(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	if s.config.ScenarioType == "urban_flood" && s.turn >= s.config.Turns {
		return fmt.Errorf("urban_flood simulation has completed")
	}
	started := time.Now()
	defer func() { s.diagnostic.turn = append(s.diagnostic.turn, time.Since(started)) }()
	s.turn++
	events := []world.Event{}
	for _, event := range s.events {
		if event.Turn != s.turn {
			continue
		}
		s.scenario.roadEvent(s, event)
		events = append(events, world.Event{Turn: s.turn, Type: event.Type, EdgeID: event.EdgeID, Message: "Scheduled road state applied"})
	}
	s.scenario.advance(s, &events)
	s.moveFleet(&events)
	s.version++
	s.prepare(ctx, events)
	s.publish(events) // Every HTTP request in this turn observes this exact world.
	routes := s.routeAvailability()
	results := s.decisions(ctx)
	hordeBlocked := s.hordeBlockedNodes()
	for i := range s.survivors {
		v := &s.survivors[i]
		if v.Status != world.Active || v.VehicleID != "" {
			continue
		}
		from := v.CurrentNode
		result := results[i]
		s.latencies = append(s.latencies, result.elapsed)
		next := result.next
		if s.scenario.waiting(v.ID) {
			next = from
		}
		valid := result.err == nil && s.index.CanMove(from, next, s.blocked) && (from == next || !hordeBlocked[next])
		if result.timeout {
			s.metrics.RequestsTimeout++
			events = append(events, world.Event{Turn: s.turn, Type: "decision_timeout", EntityID: v.ID, Message: "Decision deadline exceeded; survivor stays"})
		} else if !valid {
			s.metrics.RequestsInvalid++
			events = append(events, world.Event{Turn: s.turn, Type: "decision_invalid", EntityID: v.ID, Message: "Decision failed validation; survivor stays"})
		} else {
			s.metrics.RequestsSuccess++
		}
		if !valid || result.timeout {
			next = from
		}
		s.recordDecision(*v, from, next, routes, valid, result.timeout)
		v.CurrentNode = next
		if s.planner == nil {
			v.PlannedRoute = []string{}
		} else {
			v.PlannedRoute = trimRoute(v.PlannedRoute, next)
		}
		if z, mechanism, bitten := s.collision(from, next); bitten {
			v.Status = world.Bitten
			v.TargetShelterID = ""
			v.PlannedRoute = []string{}
			s.diagnostic.bites = append(s.diagnostic.bites, diagnostics.Bite{Turn: s.turn, SurvivorID: v.ID, ZombieID: z.ID, ZombieType: z.Type, Mechanism: mechanism, From: from, To: next, InitialOverlap: s.diagnostic.initialOverlap[v.ID]})
			events = append(events, world.Event{Turn: s.turn, Type: "bitten", EntityID: v.ID, Message: "Survivor eliminated"})
			continue
		}
		for j := range s.shelters {
			shelter := &s.shelters[j]
			ownsReservation := s.planner != nil && v.TargetShelterID == shelter.ID
			spaceAvailable := s.planner == nil && !s.config.RescueFleet || ownsReservation || shelter.Capacity-shelter.Occupancy-shelter.Reserved > 0
			if shelter.NodeID == next && shelter.Occupancy < shelter.Capacity && spaceAvailable && s.scenario.admits(shelter.ID) {
				shelter.Occupancy++
				if ownsReservation && shelter.Reserved > 0 {
					shelter.Reserved--
				}
				v.TargetShelterID = shelter.ID
				v.Status = world.Evacuated
				record := s.diagnostic.records[v.ID]
				record.EvacuationTurn = s.turn
				if record.Moves == 0 {
					record.RouteEfficiency = 1
				} else if record.InitialNearestShelterHops >= 0 {
					record.RouteEfficiency = float64(record.InitialNearestShelterHops) / float64(record.Moves)
				}
				events = append(events, world.Event{Turn: s.turn, Type: "evacuated", EntityID: v.ID, Message: "Survivor entered shelter"})
				break
			}
		}
	}
	if s.planner != nil || s.config.RescueFleet {
		s.reconcileReservations()
	}
	// Final failure labels use post-admission occupancy. Decision diagnostics
	// above deliberately retain the pre-movement routes each request observed.
	s.finishDiagnostics(s.routeAvailability())
	s.version++
	s.scenario.finishStep(s, time.Since(started))
	s.publish(events)
	return ctx.Err()
}

func (s *Simulator) Run(ctx context.Context, turns int, interval time.Duration) error {
	if turns < 0 || interval < 0 {
		return fmt.Errorf("turn count and interval must be nonnegative")
	}
	for i := 0; i < turns; i++ {
		started := time.Now()
		if err := s.Step(ctx); err != nil {
			return err
		}
		// Normal mode has a nominal 2s turn period; accelerated mode has no timer.
		if remaining := interval - time.Since(started); remaining > 0 {
			timer := time.NewTimer(remaining)
			select {
			case <-ctx.Done():
				timer.Stop()
				return ctx.Err()
			case <-timer.C:
			}
		}
	}
	return nil
}

type decision struct {
	next    string
	err     error
	elapsed time.Duration
	timeout bool
}

func (s *Simulator) decisions(ctx context.Context) []decision {
	results := make([]decision, len(s.survivors))
	jobs := make(chan int)
	var workers sync.WaitGroup
	for n := 0; n < s.config.Concurrency; n++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for i := range jobs {
				v := s.survivors[i]
				callCtx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
				start := time.Now()
				response, err := s.client.NextStep(callCtx, world.StepRequest{SurvivorID: v.ID, CurrentNode: v.CurrentNode, Turn: s.turn})
				elapsed := time.Since(start)
				if err == nil && callCtx.Err() != nil {
					err = callCtx.Err()
				}
				timeout := errors.Is(err, context.DeadlineExceeded) || errors.Is(callCtx.Err(), context.DeadlineExceeded) || elapsed > 500*time.Millisecond
				var netErr net.Error
				if errors.As(err, &netErr) && netErr.Timeout() {
					timeout = true
				}
				cancel()
				results[i] = decision{next: response.NextNode, err: err, elapsed: elapsed, timeout: timeout}
			}
		}()
	}
	for i, v := range s.survivors {
		if v.Status == world.Active && v.VehicleID == "" {
			jobs <- i
		}
	}
	close(jobs)
	workers.Wait()
	return results
}

func (s *Simulator) observable(events []world.Event) world.WorldSnapshot {
	s.metrics.Evacuated, s.metrics.Bitten, s.metrics.Active = 0, 0, 0
	for _, v := range s.survivors {
		switch v.Status {
		case world.Evacuated:
			s.metrics.Evacuated++
		case world.Bitten:
			s.metrics.Bitten++
		case world.Active:
			s.metrics.Active++
		}
	}
	s.metrics.Turns = s.turn
	total := s.metrics.RequestsSuccess + s.metrics.RequestsInvalid + s.metrics.RequestsTimeout
	s.metrics.Availability = 1
	if total > 0 {
		s.metrics.Availability = float64(s.metrics.RequestsSuccess) / float64(total)
	}
	if len(s.latencies) > 0 {
		latencies := append([]time.Duration{}, s.latencies...)
		sort.Slice(latencies, func(i, j int) bool { return latencies[i] < latencies[j] })
		percentile := func(p float64) float64 {
			return float64(latencies[int(math.Ceil(p*float64(len(latencies))))-1]) / float64(time.Millisecond)
		}
		s.metrics.HTTPP50MS, s.metrics.HTTPP95MS, s.metrics.HTTPP99MS = percentile(.5), percentile(.95), percentile(.99)
	}
	w := world.WorldSnapshot{
		Turn: s.turn, WorldVersion: s.version, GraphVersion: s.graph.Version, Graph: s.graph,
		Survivors: s.survivors, Shelters: s.shelters, Events: events, Metrics: s.metrics,
		Zombies: []world.Zombie{}, BlockedEdges: []string{},
	}
	if s.config.RescueFleet {
		w.Fleet = s.fleet
		metrics := s.fleetMetrics
		w.FleetMetrics = &metrics
	}
	for _, z := range s.zombies {
		if z.observable.Awake {
			w.Zombies = append(w.Zombies, z.observable)
		}
	}
	for edge, blocked := range s.blocked {
		if blocked {
			w.BlockedEdges = append(w.BlockedEdges, edge)
		}
	}
	sort.Strings(w.BlockedEdges)
	w.Scenario = s.scenario.snapshot(s)
	if w.Scenario != nil {
		w.ScenarioType = w.Scenario.ScenarioType
	}
	return w
}

func (s *Simulator) publish(events []world.Event) {
	started := time.Now()
	s.store.Publish(s.observable(events))
	s.diagnostic.publication = append(s.diagnostic.publication, time.Since(started))
}

func (s *Simulator) bitten(from, to string) bool {
	_, _, yes := s.collision(from, to)
	return yes
}

func (s *Simulator) hordeBlockedNodes() map[string]bool {
	blocked := map[string]bool{}
	for _, z := range s.zombies {
		if z.observable.Type == world.Horde {
			blocked[z.observable.CurrentNode] = true
			for _, n := range s.proximity[z.observable.CurrentNode] {
				blocked[n] = true
			}
		}
	}
	return blocked
}
