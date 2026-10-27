package world

import "sync"

// Store owns its published data. Copies on both boundaries prevent callers from
// mutating authoritative snapshots while HTTP requests run concurrently.
type Store struct {
	mu          sync.RWMutex
	snapshot    WorldSnapshot
	ready       bool
	sourceGraph *Graph
}

func NewStore() *Store { return &Store{} }

func (s *Store) Publish(snapshot WorldSnapshot) {
	// Topology never changes during a run. Own one defensive copy, and only
	// clone dynamic entities on each publication.
	s.mu.RLock()
	shared := s.snapshot.Graph
	same := s.sourceGraph == snapshot.Graph
	s.mu.RUnlock()
	if !same {
		shared = snapshot.Graph.Clone()
	}
	source := snapshot.Graph
	snapshot.Graph = nil
	copy := snapshot.Clone()
	copy.Graph = shared
	visible := make([]Zombie, 0, len(copy.Zombies))
	for _, zombie := range copy.Zombies {
		if zombie.Type != Sleeper || zombie.Awake {
			visible = append(visible, zombie)
		}
	}
	copy.Zombies = visible
	s.mu.Lock()
	s.snapshot, s.ready = copy, true
	s.sourceGraph = source
	s.mu.Unlock()
}

// LoadCompact returns independently owned observable state without topology.
func (s *Store) LoadCompact() (WorldSnapshot, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	w := s.snapshot
	w.Graph = nil
	return w.Clone(), s.ready
}

// LoadForDecision is for trusted read-only decision engines inside this process.
// Mutable entities are defensive copies; Graph must never be mutated by callers.
func (s *Store) LoadForDecision() (WorldSnapshot, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	w := s.snapshot
	w.Graph = nil
	w = w.Clone()
	w.Graph = s.snapshot.Graph
	return w, s.ready
}

func (s *Store) Load() (WorldSnapshot, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.snapshot.Clone(), s.ready
}

func (g *Graph) Clone() *Graph {
	if g == nil {
		return nil
	}
	copy := *g
	copy.Nodes = append([]GraphNode{}, g.Nodes...)
	copy.Edges = append([]GraphEdge{}, g.Edges...)
	for i := range copy.Edges {
		copy.Edges[i].Geometry = append([]GeoPoint{}, g.Edges[i].Geometry...)
	}
	copy.Shelters = append([]Shelter{}, g.Shelters...)
	for i := range copy.Shelters {
		copy.Shelters[i].Available = copy.Shelters[i].Capacity - copy.Shelters[i].Occupancy - copy.Shelters[i].Reserved
	}
	copy.Coverage = append([]GeoPoint{}, g.Coverage...)
	copy.SpawnZones = append([]SpawnZone{}, g.SpawnZones...)
	for i := range copy.SpawnZones {
		copy.SpawnZones[i].Geometry = append([]GeoPoint{}, g.SpawnZones[i].Geometry...)
		copy.SpawnZones[i].NodeIDs = append([]string{}, g.SpawnZones[i].NodeIDs...)
	}
	return &copy
}

func (w WorldSnapshot) Clone() WorldSnapshot {
	copy := w
	copy.Scenario = w.Scenario.Clone()
	if w.Simulation != nil {
		info := *w.Simulation
		copy.Simulation = &info
	}
	copy.Graph = w.Graph.Clone()
	copy.Zombies = append([]Zombie{}, w.Zombies...)
	for i := range copy.Zombies {
		copy.Zombies[i].Path = append([]string{}, w.Zombies[i].Path...)
	}
	copy.Survivors = append([]Survivor{}, w.Survivors...)
	for i := range copy.Survivors {
		copy.Survivors[i].PlannedRoute = append([]string{}, w.Survivors[i].PlannedRoute...)
	}
	copy.Shelters = append([]Shelter{}, w.Shelters...)
	for i := range copy.Shelters {
		copy.Shelters[i].Available = copy.Shelters[i].Capacity - copy.Shelters[i].Occupancy - copy.Shelters[i].Reserved
	}
	copy.BlockedEdges = append([]string{}, w.BlockedEdges...)
	copy.Events = append([]Event{}, w.Events...)
	return copy
}
