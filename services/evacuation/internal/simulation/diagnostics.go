package simulation

import (
	"time"

	"corodev/evacuation/internal/diagnostics"
	"corodev/evacuation/internal/world"
)

type diagnosticState struct {
	initialSurvivors            []diagnostics.Spawn
	initialZombies              []diagnostics.Spawn
	records                     map[string]*diagnostics.Survivor
	previous                    map[string]string
	lastDestination             map[string]string
	initialOverlap              map[string]bool
	bites                       []diagnostics.Bite
	timeline                    []diagnostics.Turn
	failures                    map[string]int
	static                      map[string]int
	planning, publication, turn []time.Duration
	initialHordeExclusions      int
}

type traversal struct{ from, to string }

type availability struct{ static, blocked, safe, available map[string]int }

func (s *Simulator) initDiagnostics() {
	d := diagnosticState{records: map[string]*diagnostics.Survivor{}, previous: map[string]string{}, lastDestination: map[string]string{}, initialOverlap: map[string]bool{}, failures: map[string]int{}, bites: []diagnostics.Bite{}, timeline: []diagnostics.Turn{}, initialSurvivors: []diagnostics.Spawn{}, initialZombies: []diagnostics.Spawn{}}
	d.static = s.refugeDistances(nil, nil, nil, false)
	horde := s.hordeBlockedNodes()
	for _, v := range s.survivors {
		node, _ := s.index.Node(v.CurrentNode)
		hops, ok := d.static[v.CurrentNode]
		if !ok {
			hops = -1
		}
		d.records[v.ID] = &diagnostics.Survivor{ID: v.ID, InitialNode: v.CurrentNode, ZoneID: v.SpawnZoneID, InitialNearestShelterHops: hops, CurrentNode: v.CurrentNode, Status: v.Status}
		d.initialSurvivors = append(d.initialSurvivors, diagnostics.Spawn{ID: v.ID, Type: "survivor", NodeID: v.CurrentNode, Lat: node.Lat, Lng: node.Lng, ZoneID: v.SpawnZoneID})
		if horde[v.CurrentNode] {
			d.initialHordeExclusions++
		}
		for _, z := range s.zombies {
			if z.observable.CurrentNode == v.CurrentNode {
				d.initialOverlap[v.ID] = true
			}
		}
	}
	for _, state := range s.zombies {
		z := state.observable
		node, _ := s.index.Node(z.CurrentNode)
		d.initialZombies = append(d.initialZombies, diagnostics.Spawn{ID: z.ID, Type: z.Type, NodeID: z.CurrentNode, Lat: node.Lat, Lng: node.Lng})
	}
	s.diagnostic = d
}

// Distances are reverse BFS movement counts. Forbidden destinations are omitted;
// an endangered current node can still have a legal escaping edge.
func (s *Simulator) refugeDistances(blocked map[string]bool, danger map[string]bool, opposite map[traversal]bool, availableOnly bool) map[string]int {
	reverse := map[string][]string{}
	add := func(from, to string) {
		if !danger[to] && !opposite[traversal{from, to}] {
			reverse[to] = append(reverse[to], from)
		}
	}
	for _, e := range s.graph.Edges {
		if e.Blocked || blocked[e.ID] {
			continue
		}
		add(e.From, e.To)
		if !e.Directed {
			add(e.To, e.From)
		}
	}
	distance := map[string]int{}
	queue := []string{}
	for _, shelter := range s.shelters {
		if danger[shelter.NodeID] || (availableOnly && shelter.Occupancy >= shelter.Capacity) {
			continue
		}
		if _, seen := distance[shelter.NodeID]; !seen {
			distance[shelter.NodeID] = 0
			queue = append(queue, shelter.NodeID)
		}
	}
	for head := 0; head < len(queue); head++ {
		at := queue[head]
		for _, previous := range reverse[at] {
			if _, seen := distance[previous]; !seen {
				distance[previous] = distance[at] + 1
				queue = append(queue, previous)
			}
		}
	}
	return distance
}

func (s *Simulator) routeAvailability() availability {
	danger := s.hordeBlockedNodes()
	opposite := map[traversal]bool{}
	for _, state := range s.zombies {
		z := state.observable
		if !z.Awake {
			continue
		}
		danger[z.CurrentNode] = true
		for i := 1; i < len(z.Path); i++ {
			opposite[traversal{z.Path[i], z.Path[i-1]}] = true
		}
	}
	return availability{static: s.diagnostic.static, blocked: s.refugeDistances(s.blocked, nil, nil, false), safe: s.refugeDistances(s.blocked, danger, opposite, false), available: s.refugeDistances(s.blocked, danger, opposite, true)}
}

func reason(routes availability, node string) string {
	if _, ok := routes.static[node]; !ok {
		return "no_geographic_route"
	}
	if _, ok := routes.blocked[node]; !ok {
		return "blocked_route"
	}
	if _, ok := routes.safe[node]; !ok {
		return "visible_threat_route"
	}
	if _, ok := routes.available[node]; !ok {
		return "shelter_full"
	}
	return ""
}

func (s *Simulator) recordDecision(v world.Survivor, from, to string, routes availability, valid, timedOut bool) {
	d := &s.diagnostic
	record := d.records[v.ID]
	record.CurrentNode = to
	if from == to {
		record.StationaryTurns++
	} else {
		record.Moves++
		if d.previous[v.ID] == to {
			record.Reversals++
		}
		d.previous[v.ID] = from
	}
	failure := reason(routes, from)
	if failure != "" {
		record.NoRouteTurns++
		d.failures[failure]++
		switch failure {
		case "no_geographic_route":
			record.GeographicNoRouteTurns++
		case "blocked_route":
			record.BlockedRouteTurns++
		case "visible_threat_route":
			record.ThreatRouteTurns++
		case "shelter_full":
			record.FullShelterTurns++
		}
	}
	if timedOut {
		d.failures["timeout"]++
	} else if !valid {
		d.failures["invalid_movement"]++
	} else if from == to && failure == "" && routes.available[from] > 0 {
		d.failures["wait_with_route"]++
	}
	previous := d.lastDestination[v.ID]
	if previous != "" && v.TargetShelterID != "" && previous != v.TargetShelterID {
		record.DestinationChanges++
	}
	if v.TargetShelterID != "" {
		d.lastDestination[v.ID] = v.TargetShelterID
	}
}

func (s *Simulator) collision(from, to string) (world.Zombie, string, bool) {
	for _, state := range s.zombies {
		z := state.observable
		if !z.Awake {
			continue
		}
		if z.CurrentNode == to {
			return z, "same_node", true
		}
		for i := 1; i < len(z.Path); i++ {
			if from != to && z.Path[i-1] == to && z.Path[i] == from {
				return z, "opposite_edge", true
			}
		}
	}
	return world.Zombie{}, "", false
}

func (s *Simulator) finishDiagnostics(routes availability) {
	turn := diagnostics.Turn{Turn: s.turn}
	for _, v := range s.survivors {
		record := s.diagnostic.records[v.ID]
		record.CurrentNode, record.Status = v.CurrentNode, v.Status
		switch v.Status {
		case world.Active:
			turn.Active++
			record.FinalFailure = reason(routes, v.CurrentNode)
			if record.FinalFailure == "" {
				record.FinalFailure = "in_transit"
			}
		case world.Bitten:
			turn.Bitten++
		case world.Evacuated:
			turn.Evacuated++
		}
	}
	for _, record := range s.diagnostic.records {
		turn.Stationary += record.StationaryTurns
		turn.NoRoute += record.NoRouteTurns
	}
	s.diagnostic.timeline = append(s.diagnostic.timeline, turn)
}

// Diagnostics returns a detached offline report, including initial hidden zombie
// positions for reproducible experiments. It must never be served by /estado.
func (s *Simulator) Diagnostics() diagnostics.Report {
	s.mu.Lock()
	defer s.mu.Unlock()
	d := &s.diagnostic
	result := diagnostics.Report{Scenario: s.config.Name, Seed: s.config.Seed, GraphVersion: s.graph.Version, Turns: s.turn, InitialSurvivors: append([]diagnostics.Spawn{}, d.initialSurvivors...), InitialZombies: append([]diagnostics.Spawn{}, d.initialZombies...), Bites: append([]diagnostics.Bite{}, d.bites...), Timeline: append([]diagnostics.Turn{}, d.timeline...), Survivors: []diagnostics.Survivor{}, Failures: map[string]int{}, Summary: diagnostics.Summary{InitialHordeExclusions: d.initialHordeExclusions}, Timings: diagnostics.Timings{Planning: diagnostics.Measure(d.planning), Publication: diagnostics.Measure(d.publication), Turn: diagnostics.Measure(d.turn)}}
	for key, count := range d.failures {
		result.Failures[key] = count
	}
	for _, v := range s.survivors {
		record := *d.records[v.ID]
		result.Survivors = append(result.Survivors, record)
		result.Summary.StationaryTurns += record.StationaryTurns
		result.Summary.NoRouteTurns += record.NoRouteTurns
		result.Summary.DestinationChanges += record.DestinationChanges
		result.Summary.RouteInvalidations += record.RouteInvalidations
		if d.initialOverlap[v.ID] {
			result.Summary.InitialOverlaps++
		}
		switch v.Status {
		case world.Active:
			result.Summary.Active++
		case world.Bitten:
			result.Summary.Bitten++
		case world.Evacuated:
			result.Summary.Evacuated++
			result.Summary.MeanEvacuationTurn += float64(record.EvacuationTurn)
			result.Summary.MeanRouteEfficiency += record.RouteEfficiency
		}
	}
	result.Summary.Alive = result.Summary.Active + result.Summary.Evacuated
	if result.Summary.Evacuated > 0 {
		result.Summary.MeanEvacuationTurn /= float64(result.Summary.Evacuated)
		result.Summary.MeanRouteEfficiency /= float64(result.Summary.Evacuated)
	}
	for _, shelter := range s.shelters {
		if shelter.Occupancy >= shelter.Capacity {
			result.Summary.SheltersFull++
		}
		result.Summary.ShelterUnoccupiedCapacity += shelter.Capacity - shelter.Occupancy
		result.Summary.ShelterReserved += shelter.Reserved
		result.Summary.ShelterCapacityAvailable += shelter.Capacity - shelter.Occupancy - shelter.Reserved
	}
	return result
}
