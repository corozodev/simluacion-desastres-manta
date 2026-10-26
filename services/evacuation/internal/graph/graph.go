// Package graph loads validated, immutable road networks and indexes adjacency.
package graph

import (
	"encoding/json"
	"fmt"
	"io"
	"math"
	"os"
	"sort"

	"corodev/evacuation/internal/world"
)

// Arc represents a legal direction along a road edge.
type Arc struct {
	To   string
	Edge world.GraphEdge
}

// Index owns a copy of its graph. Its methods are safe for concurrent reads.
type Index struct {
	nodes     map[string]world.GraphNode
	adjacency map[string][]Arc
}

func Load(path string) (*world.Graph, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open graph: %w", err)
	}
	defer f.Close()
	var g world.Graph
	dec := json.NewDecoder(io.LimitReader(f, 32<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&g); err != nil {
		return nil, fmt.Errorf("decode graph: %w", err)
	}
	if err := dec.Decode(new(any)); err != io.EOF {
		return nil, fmt.Errorf("graph must contain one JSON document")
	}
	if err := Validate(&g); err != nil {
		return nil, err
	}
	return &g, nil
}

func finite(x float64) bool { return !math.IsNaN(x) && !math.IsInf(x, 0) }

var roadTypes = map[string]bool{"primary": true, "primary_link": true, "secondary": true, "secondary_link": true, "tertiary": true, "tertiary_link": true, "unclassified": true, "residential": true, "living_street": true, "service": true, "pedestrian": true, "footway": true, "path": true, "steps": true, "trunk": true, "trunk_link": true}

func validPoint(p world.GeoPoint) bool {
	return finite(p.Lat) && finite(p.Lng) && p.Lat >= -90 && p.Lat <= 90 && p.Lng >= -180 && p.Lng <= 180
}

// Contains uses a sourced closed ring in longitude/latitude. Spawn polygons are
// origin areas only and never constrain movement after initialization.
func Contains(ring []world.GeoPoint, p world.GeoPoint) bool {
	inside := false
	for i := 1; i < len(ring); i++ {
		a, b := ring[i-1], ring[i]
		if (a.Lat > p.Lat) != (b.Lat > p.Lat) && p.Lng < (b.Lng-a.Lng)*(p.Lat-a.Lat)/(b.Lat-a.Lat)+a.Lng {
			inside = !inside
		}
	}
	return inside
}

// Validate checks coordinates, identities, topology and directed reachability to
// every shelter. Dynamic blocks are validated by the simulator, not this base graph.
func Validate(g *world.Graph) error {
	if g == nil || g.Version == "" || g.Source == "" || len(g.Nodes) == 0 {
		return fmt.Errorf("graph requires version, source and nodes")
	}
	nodes := make(map[string]bool, len(g.Nodes))
	positions := make(map[string]world.GeoPoint, len(g.Nodes))
	reverse := make(map[string][]string, len(g.Nodes))
	for _, n := range g.Nodes {
		if n.ID == "" || nodes[n.ID] {
			return fmt.Errorf("empty or duplicate node ID %q", n.ID)
		}
		if !finite(n.Lat) || !finite(n.Lng) || n.Lat < -90 || n.Lat > 90 || n.Lng < -180 || n.Lng > 180 {
			return fmt.Errorf("invalid coordinates for %q", n.ID)
		}
		nodes[n.ID] = true
		positions[n.ID] = world.GeoPoint{Lat: n.Lat, Lng: n.Lng}
	}
	edges := make(map[string]bool, len(g.Edges))
	duplicates := make(map[string]bool, len(g.Edges))
	for _, e := range g.Edges {
		if e.ID == "" || edges[e.ID] {
			return fmt.Errorf("empty or duplicate edge ID %q", e.ID)
		}
		if !nodes[e.From] || !nodes[e.To] || e.From == e.To {
			return fmt.Errorf("invalid endpoints for %q", e.ID)
		}
		if !finite(e.DistanceM) || !finite(e.SpeedMPS) || e.DistanceM <= 0 || e.SpeedMPS <= 0 || !roadTypes[e.RoadType] {
			return fmt.Errorf("invalid distance, speed or road type for %q", e.ID)
		}
		if len(e.Geometry) > 0 {
			if len(e.Geometry) < 2 || e.Geometry[0] != positions[e.From] || e.Geometry[len(e.Geometry)-1] != positions[e.To] {
				return fmt.Errorf("geometry endpoints do not match edge %q", e.ID)
			}
			for _, point := range e.Geometry {
				if !validPoint(point) {
					return fmt.Errorf("invalid geometry on edge %q", e.ID)
				}
			}
		}
		from, to := e.From, e.To
		if !e.Directed && from > to {
			from, to = to, from
		}
		key := fmt.Sprintf("%s\x00%s\x00%t\x00%s\x00%.9g\x00%.9g", from, to, e.Directed, e.RoadType, e.DistanceM, e.SpeedMPS)
		if duplicates[key] {
			return fmt.Errorf("duplicate road edge %q", e.ID)
		}
		duplicates[key], edges[e.ID] = true, true
		if !e.Blocked {
			reverse[e.To] = append(reverse[e.To], e.From)
			if !e.Directed {
				reverse[e.From] = append(reverse[e.From], e.To)
			}
		}
	}
	if len(g.Shelters) == 0 {
		return fmt.Errorf("graph requires a shelter")
	}
	shelters := map[string]bool{}
	for _, s := range g.Shelters {
		if s.ID == "" || shelters[s.ID] || !nodes[s.NodeID] || s.Capacity <= 0 || s.Occupancy < 0 || s.Occupancy > s.Capacity || s.Reserved < 0 || s.Reserved > s.Capacity-s.Occupancy {
			return fmt.Errorf("invalid shelter %q", s.ID)
		}
		shelters[s.ID] = true
		seen, queue := map[string]bool{s.NodeID: true}, []string{s.NodeID}
		for head := 0; head < len(queue); head++ {
			for _, prior := range reverse[queue[head]] {
				if !seen[prior] {
					seen[prior] = true
					queue = append(queue, prior)
				}
			}
		}
		if len(seen) != len(nodes) {
			return fmt.Errorf("shelter %q unreachable from %d nodes", s.ID, len(nodes)-len(seen))
		}
	}
	zoneIDs := map[string]bool{}
	for _, zone := range g.SpawnZones {
		if zone.ID == "" || zoneIDs[zone.ID] || zone.Name == "" || zone.Source == "" || !finite(zone.Weight) || zone.Weight < 0 || len(zone.Geometry) < 4 || zone.Geometry[0] != zone.Geometry[len(zone.Geometry)-1] || len(zone.NodeIDs) == 0 {
			return fmt.Errorf("invalid spawn zone %q", zone.ID)
		}
		zoneIDs[zone.ID] = true
		for _, point := range zone.Geometry {
			if !validPoint(point) {
				return fmt.Errorf("invalid geometry on zone %q", zone.ID)
			}
		}
		seen := map[string]bool{}
		for _, id := range zone.NodeIDs {
			if !nodes[id] || seen[id] || !Contains(zone.Geometry, positions[id]) {
				return fmt.Errorf("spawn zone %q has invalid candidate %q", zone.ID, id)
			}
			seen[id] = true
		}
	}
	if len(g.Coverage) > 0 {
		if len(g.Coverage) < 4 || g.Coverage[0] != g.Coverage[len(g.Coverage)-1] {
			return fmt.Errorf("coverage envelope must be a closed polygon")
		}
		for _, point := range g.Coverage {
			if !validPoint(point) {
				return fmt.Errorf("coverage envelope has invalid coordinates")
			}
		}
	}
	return nil
}

func New(g *world.Graph) (*Index, error) {
	if err := Validate(g); err != nil {
		return nil, err
	}
	idx := &Index{nodes: make(map[string]world.GraphNode, len(g.Nodes)), adjacency: make(map[string][]Arc, len(g.Nodes))}
	for _, n := range g.Nodes {
		idx.nodes[n.ID] = n
	}
	for _, e := range g.Edges {
		idx.adjacency[e.From] = append(idx.adjacency[e.From], Arc{To: e.To, Edge: e})
		if !e.Directed {
			idx.adjacency[e.To] = append(idx.adjacency[e.To], Arc{To: e.From, Edge: e})
		}
	}
	for node := range idx.adjacency {
		sort.Slice(idx.adjacency[node], func(i, j int) bool {
			a, b := idx.adjacency[node][i], idx.adjacency[node][j]
			if a.To != b.To {
				return a.To < b.To
			}
			return a.Edge.ID < b.Edge.ID
		})
	}
	return idx, nil
}

func (idx *Index) Node(id string) (world.GraphNode, bool) { n, ok := idx.nodes[id]; return n, ok }

// Neighbors returns a fresh, deterministically sorted list of traversable arcs.
func (idx *Index) Neighbors(nodeID string, blocked map[string]bool) []Arc {
	result := []Arc{}
	for _, arc := range idx.adjacency[nodeID] {
		if !arc.Edge.Blocked && !blocked[arc.Edge.ID] {
			result = append(result, arc)
		}
	}
	return result
}

// CanMove permits waiting at a valid node and crossing one unblocked neighbor.
func (idx *Index) CanMove(from, to string, blocked map[string]bool) bool {
	if _, ok := idx.nodes[from]; !ok {
		return false
	}
	if from == to {
		return true
	}
	for _, arc := range idx.adjacency[from] {
		if arc.To == to && !arc.Edge.Blocked && !blocked[arc.Edge.ID] {
			return true
		}
	}
	return false
}
