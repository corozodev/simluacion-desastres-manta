package flood

import (
	"fmt"
	"math"
	"math/rand"
	"sort"

	"corodev/evacuation/internal/graph"
	"corodev/evacuation/internal/world"
)

// ElevationProvider is a future adapter contract. A missing observation must be
// reported as unavailable; this model never supplies or invents elevations.
// Elevation alone cannot establish the safety of a location or its access.
type ElevationProvider interface {
	ElevationAt(world.GeoPoint) (metres float64, available bool, provenance string)
}

type focus struct {
	config ZoneConfig
	center world.GeoPoint
	factor float64
	level  float64
	radius float64
}

type distance struct {
	focus int
	value float64
}

type road struct {
	condition world.RoadCondition
	distances []distance
}

// Model belongs to the simulator's single writer. Public slices are independent
// copies; HTTP readers consume the simulator's published immutable snapshot.
// Memory is bounded by the graph and at most 32 pre-indexed synthetic zones.
type Model struct {
	config       Config
	step         int
	rainfall     float64
	foci         []focus
	roads        []road
	nodes        map[string]world.GeoPoint
	shelters     []world.ShelterCondition
	shelterNodes []string
}

func New(g *world.Graph, seed int64, cfg Config) (*Model, error) {
	cfg, err := cfg.WithDefaults()
	if err != nil {
		return nil, err
	}
	if err := graph.Validate(g); err != nil {
		return nil, fmt.Errorf("flood graph: %w", err)
	}
	m := &Model{config: cfg, nodes: map[string]world.GeoPoint{}}
	for _, n := range g.Nodes {
		m.nodes[n.ID] = world.GeoPoint{Lat: n.Lat, Lng: n.Lng}
	}
	// This PRNG never consumes the simulator's agent/zombie random sequence.
	rng := rand.New(rand.NewSource(seed ^ 0x464c4f4f44))
	zones := append([]ZoneConfig(nil), cfg.Zones...)
	generated := len(zones) == 0
	if generated {
		nodes := append([]world.GraphNode(nil), g.Nodes...)
		sort.Slice(nodes, func(i, j int) bool { return nodes[i].ID < nodes[j].ID })
		order := rng.Perm(len(nodes))
		for i := 0; i < 3 && i < len(nodes); i++ {
			zones = append(zones, ZoneConfig{ID: fmt.Sprintf("synthetic-%02d", i+1), CenterNode: nodes[order[i]].ID, RadiusMinM: 150, RadiusMaxM: 800})
		}
	}
	for _, z := range zones {
		center, ok := m.nodes[z.CenterNode]
		if !ok {
			return nil, fmt.Errorf("flood zone %q references unknown center_node %q", z.ID, z.CenterNode)
		}
		factor := 1.0
		if generated {
			factor = .85 + .30*rng.Float64()
		}
		m.foci = append(m.foci, focus{config: z, center: center, factor: factor, radius: z.RadiusMinM})
	}
	// Precompute centre-to-polyline distances once. The per-step road loop never
	// reconstructs graph topology or scans unaffected streets.
	for _, edge := range g.Edges {
		geometry := edge.Geometry
		if len(geometry) == 0 {
			geometry = []world.GeoPoint{m.nodes[edge.From], m.nodes[edge.To]}
		}
		r := road{condition: world.RoadCondition{EdgeID: edge.ID, State: "passable", RiskSource: "synthetic_urban_flood", CostMultiplier: 1}}
		for i, f := range m.foci {
			d := polylineDistance(f.center, geometry)
			if d <= f.config.RadiusMaxM {
				r.distances = append(r.distances, distance{focus: i, value: d})
			}
		}
		if len(r.distances) > 0 {
			m.roads = append(m.roads, r)
		}
	}
	sort.Slice(m.roads, func(i, j int) bool { return m.roads[i].condition.EdgeID < m.roads[j].condition.EdgeID })
	shelters := append([]world.Shelter(nil), g.Shelters...)
	sort.Slice(shelters, func(i, j int) bool { return shelters[i].ID < shelters[j].ID })
	for _, sh := range shelters {
		m.shelters = append(m.shelters, world.ShelterCondition{ShelterID: sh.ID, State: "available"})
		m.shelterNodes = append(m.shelterNodes, sh.NodeID)
	}
	return m, nil
}

func (m *Model) Config() Config {
	c := m.config
	c.Zones = append([]ZoneConfig(nil), c.Zones...)
	return c
}

func clamp(v float64) float64 { return math.Max(0, math.Min(1, v)) }

func (m *Model) profile(t float64) float64 {
	x := t / m.config.SimulationDuration
	if x >= 1 {
		return 0
	}
	switch m.config.RainfallProfile {
	case "constant":
		return 1
	case "pulse":
		if x >= .15 && x < .45 {
			return 1
		}
	default: // storm
		if x < .55 {
			return 1
		}
	}
	return 0
}

// Advance applies every omitted step in order. Repeated or older step numbers
// are idempotent. Simulation time is step*time_step, capped at duration.
func (m *Model) Advance(step int) {
	last := int(math.Ceil(m.config.SimulationDuration / m.config.TimeStep))
	if step > last {
		step = last
	}
	for m.step < step {
		start := float64(m.step) * m.config.TimeStep
		dt := math.Min(m.config.TimeStep, m.config.SimulationDuration-start)
		m.rainfall = 0
		end := start + dt
		// Integrate across the profile boundaries even when a configured step
		// spans an entire storm. A larger time_step cannot extend the rainfall.
		for at := start; at < end; {
			next := end
			for _, fraction := range [...]float64{.15, .45, .55} {
				boundary := fraction * m.config.SimulationDuration
				if boundary > at && boundary < next {
					next = boundary
				}
			}
			segment := next - at
			rainfall := m.config.RainfallIntensity * m.profile(at)
			m.rainfall += rainfall * segment / dt
			for i := range m.foci {
				f := &m.foci[i]
				input := m.config.FloodGrowthRate * rainfall * f.factor
				if m.config.DrainageFactor == 0 {
					f.level = clamp(f.level + input*segment)
				} else {
					// Expm1 avoids cancellation for tiny drainage*time_step.
					gain := -math.Expm1(-m.config.DrainageFactor * segment)
					f.level = clamp(f.level*(1-gain) + input*(gain/m.config.DrainageFactor))
				}
			}
			at = next
		}
		for i := range m.foci {
			f := &m.foci[i]
			f.radius = f.config.RadiusMinM + (f.config.RadiusMaxM-f.config.RadiusMinM)*f.level
		}
		m.step++
		m.updateConditions()
	}
}

func exposure(f focus, d float64) float64 {
	if d >= f.radius {
		return 0
	}
	x := d / f.radius
	return clamp(f.level * (1 - x*x))
}

func nextState(previous string, risk float64, t RoadThresholds) string {
	if risk >= t.Blocked {
		return "blocked"
	}
	if previous == "blocked" && risk >= t.Blocked-t.Hysteresis {
		return "blocked"
	}
	if risk >= t.Caution || (previous != "passable" && risk >= t.Caution-t.Hysteresis) {
		return "caution"
	}
	return "passable"
}

func (m *Model) updateConditions() {
	for i := range m.roads {
		r := &m.roads[i]
		risk := 0.0
		for _, d := range r.distances {
			risk = math.Max(risk, exposure(m.foci[d.focus], d.value))
		}
		state := nextState(r.condition.State, risk, m.config.RoadRiskThresholds)
		if risk != r.condition.RiskScore || state != r.condition.State {
			r.condition.RiskScore, r.condition.State = risk, state
			r.condition.UpdatedAtSimulationStep = m.step
			r.condition.CostMultiplier = 1
			if state == "caution" {
				r.condition.CostMultiplier += m.config.RoadRiskThresholds.CautionPenalty
			}
		}
	}
	for i := range m.shelters {
		sh := &m.shelters[i]
		risk := m.ExposureAt(m.shelterNodes[i])
		state := "available"
		threshold := m.config.ShelterExposureThreshold
		if sh.State == "exposed" {
			threshold = math.Max(threshold*.5, threshold-m.config.RoadRiskThresholds.Hysteresis)
		}
		if risk >= threshold {
			state = "exposed"
		}
		if risk != sh.RiskScore || state != sh.State {
			sh.RiskScore, sh.State = risk, state
			sh.UpdatedAtSimulationStep = m.step
		}
	}
}

func (m *Model) Zones() []world.FloodZone {
	zones := make([]world.FloodZone, 0, len(m.foci))
	for _, f := range m.foci {
		zones = append(zones, world.FloodZone{ID: f.config.ID, Center: f.center, RadiusM: f.radius, Intensity: f.level})
	}
	return zones
}

// Roads returns only the pre-indexed candidate overlay, including recovered
// passable roads. Baseline and explicit-event closures are combined by the core.
func (m *Model) Roads() []world.RoadCondition {
	roads := make([]world.RoadCondition, len(m.roads))
	for i := range m.roads {
		roads[i] = m.roads[i].condition
	}
	return roads
}

// Shelters reports only exposure. Occupancy, reservations and road access remain
// authoritative simulator/planner responsibilities.
func (m *Model) Shelters() []world.ShelterCondition {
	return append([]world.ShelterCondition(nil), m.shelters...)
}

func (m *Model) ExposureAt(nodeID string) float64 {
	p, ok := m.nodes[nodeID]
	if !ok {
		return 0
	}
	risk := 0.0
	for _, f := range m.foci {
		risk = math.Max(risk, exposure(f, pointDistance(f.center, p)))
	}
	return risk
}

func (m *Model) Rainfall() float64 { return m.rainfall }

// Local equirectangular coordinates are adequate for these bounded synthetic
// footprints on the Manta graph; no terrain, slope or hydrology is inferred.
func project(origin, p world.GeoPoint) (x, y float64) {
	const earthRadius = 6371000.0
	const radians = math.Pi / 180
	x = (p.Lng - origin.Lng) * radians * math.Cos(origin.Lat*radians) * earthRadius
	y = (p.Lat - origin.Lat) * radians * earthRadius
	return x, y
}

func pointDistance(origin, p world.GeoPoint) float64 {
	x, y := project(origin, p)
	return math.Hypot(x, y)
}

func polylineDistance(center world.GeoPoint, points []world.GeoPoint) float64 {
	best := math.Inf(1)
	for i := 1; i < len(points); i++ {
		ax, ay := project(center, points[i-1])
		bx, by := project(center, points[i])
		dx, dy := bx-ax, by-ay
		u := 0.0
		if length2 := dx*dx + dy*dy; length2 > 0 {
			u = math.Max(0, math.Min(1, -(ax*dx+ay*dy)/length2))
		}
		best = math.Min(best, math.Hypot(ax+u*dx, ay+u*dy))
	}
	return best
}
