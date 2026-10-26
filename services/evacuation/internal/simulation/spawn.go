package simulation

import (
	"fmt"
	"math"
	"sort"

	"corodev/evacuation/internal/world"
)

type weightedZone struct {
	zone              world.SpawnZone
	weight, remainder float64
	count             int
	candidates        []string
}

func (s *Simulator) initializeZoneSurvivors(cfg Config, shelterNodes map[string]bool) error {
	if len(s.graph.SpawnZones) == 0 {
		return fmt.Errorf("use_spawn_zones requires verified graph spawn zones")
	}
	overrides := map[string]float64{}
	for _, entry := range cfg.SpawnZoneWeights {
		if entry.ZoneID == "" || math.IsNaN(entry.Weight) || math.IsInf(entry.Weight, 0) || entry.Weight < 0 {
			return fmt.Errorf("spawn zone weights must be finite and nonnegative")
		}
		if _, duplicate := overrides[entry.ZoneID]; duplicate {
			return fmt.Errorf("duplicate spawn zone weight")
		}
		overrides[entry.ZoneID] = entry.Weight
	}
	zones := []weightedZone{}
	total := 0.0
	seen := map[string]bool{}
	for _, z := range s.graph.SpawnZones {
		if seen[z.ID] || z.ID == "" {
			return fmt.Errorf("spawn zone IDs must be unique")
		}
		seen[z.ID] = true
		weight := z.Weight
		if custom, ok := overrides[z.ID]; ok {
			weight = custom
			delete(overrides, z.ID)
		}
		if weight < 0 || math.IsNaN(weight) || math.IsInf(weight, 0) {
			return fmt.Errorf("invalid spawn zone weight")
		}
		candidates := []string{}
		unique := map[string]bool{}
		for _, id := range z.NodeIDs {
			node, ok := s.index.Node(id)
			if !ok {
				return fmt.Errorf("zone %s references missing node", z.ID)
			}
			if len(z.Geometry) < 3 || !insideZone(node.Lat, node.Lng, z.Geometry) {
				return fmt.Errorf("zone %s candidate outside verified geometry", z.ID)
			}
			if !shelterNodes[id] && !unique[id] {
				candidates = append(candidates, id)
				unique[id] = true
			}
		}
		sort.Strings(candidates)
		if weight > 0 && len(candidates) == 0 {
			return fmt.Errorf("spawn zone %s has no non-shelter candidates", z.ID)
		}
		zones = append(zones, weightedZone{zone: z, weight: weight, candidates: candidates})
		total += weight
	}
	if len(overrides) > 0 {
		return fmt.Errorf("spawn weight references unknown zone")
	}
	if total <= 0 {
		return fmt.Errorf("spawn zone weights must have a positive total")
	}
	sort.Slice(zones, func(i, j int) bool { return zones[i].zone.ID < zones[j].zone.ID })
	allocated := 0
	for i := range zones {
		share := float64(cfg.Survivors) * zones[i].weight / total
		zones[i].count = int(math.Floor(share))
		zones[i].remainder = share - float64(zones[i].count)
		allocated += zones[i].count
	}
	order := make([]int, len(zones))
	for i := range order {
		order[i] = i
	}
	sort.SliceStable(order, func(i, j int) bool { return zones[order[i]].remainder > zones[order[j]].remainder })
	for i := 0; i < cfg.Survivors-allocated; i++ {
		zones[order[i%len(order)]].count++
	}
	for _, z := range zones {
		for i := 0; i < z.count; i++ {
			s.survivors = append(s.survivors, world.Survivor{ID: fmt.Sprintf("S-%04d", len(s.survivors)+1), CurrentNode: z.candidates[s.rng.Intn(len(z.candidates))], Status: world.Active, PlannedRoute: []string{}, SpawnZoneID: z.zone.ID})
		}
	}
	return nil
}

func insideZone(lat, lng float64, polygon []world.GeoPoint) bool {
	inside := false
	for i, j := 0, len(polygon)-1; i < len(polygon); j, i = i, i+1 {
		a, b := polygon[j], polygon[i]
		cross := (lng-a.Lng)*(b.Lat-a.Lat) - (lat-a.Lat)*(b.Lng-a.Lng)
		if math.Abs(cross) < 1e-12 && lng >= math.Min(a.Lng, b.Lng)-1e-12 && lng <= math.Max(a.Lng, b.Lng)+1e-12 && lat >= math.Min(a.Lat, b.Lat)-1e-12 && lat <= math.Max(a.Lat, b.Lat)+1e-12 {
			return true
		}
		if (a.Lat > lat) != (b.Lat > lat) && lng < (b.Lng-a.Lng)*(lat-a.Lat)/(b.Lat-a.Lat)+a.Lng {
			inside = !inside
		}
	}
	return inside
}

func (s *Simulator) zombieCandidates(nodes []string, kind string) []string {
	prohibited := map[string]bool{}
	for _, v := range s.survivors {
		prohibited[v.CurrentNode] = true
		if kind == world.Horde {
			for _, n := range s.proximity[v.CurrentNode] {
				prohibited[n] = true
			}
		}
	}
	candidates := []string{}
	for _, id := range nodes {
		if !prohibited[id] {
			candidates = append(candidates, id)
		}
	}
	return candidates
}
