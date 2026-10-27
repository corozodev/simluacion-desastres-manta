package flood

import (
	"fmt"
	"math"
	"sort"

	"corodev/evacuation/internal/graph"
	"corodev/evacuation/internal/world"
)

// ElevationProvider is reserved for a sourced DEM adapter. The current domain
// uses named synthetic terrain and never claims elevations measured in Manta.
type ElevationProvider interface {
	ElevationAt(world.GeoPoint) (metres float64, available bool, provenance string)
}

type hydraulicRoad struct {
	condition world.RoadCondition
	depth     float64
	cells     []int
}

// Model belongs exclusively to the simulator writer. It retains one grid and
// precomputed street-cell intersections, never a per-turn map history. There is
// no radial exposure runtime; old radial configuration fields remain accepted
// solely for HTTP/scenario compatibility and do not drive this engine.
type Model struct {
	config       Config
	step         int
	rainfall     float64
	domain       *hydraulicDomain
	roads        []hydraulicRoad
	nodes        map[string]int
	shelters     []world.ShelterCondition
	shelterCells []int
}

func New(g *world.Graph, _ int64, cfg Config) (*Model, error) {
	cfg, err := cfg.WithDefaults()
	if err != nil {
		return nil, err
	}
	if err := graph.Validate(g); err != nil {
		return nil, fmt.Errorf("flood graph: %w", err)
	}
	m := &Model{config: cfg, domain: buildDomain(g, *cfg.Hydrology), nodes: map[string]int{}}
	for _, n := range g.Nodes {
		m.nodes[n.ID] = m.domain.cellAt(world.GeoPoint{Lat: n.Lat, Lng: n.Lng})
	}
	points := map[string]world.GeoPoint{}
	for _, n := range g.Nodes {
		points[n.ID] = world.GeoPoint{Lat: n.Lat, Lng: n.Lng}
	}
	for _, edge := range g.Edges {
		geometry := edge.Geometry
		if len(geometry) < 2 {
			geometry = []world.GeoPoint{points[edge.From], points[edge.To]}
		}
		m.roads = append(m.roads, hydraulicRoad{condition: world.RoadCondition{EdgeID: edge.ID, State: "passable", RiskSource: cfg.HydraulicModel, CostMultiplier: 1}, cells: m.cellsAlong(geometry)})
	}
	sort.Slice(m.roads, func(i, j int) bool { return m.roads[i].condition.EdgeID < m.roads[j].condition.EdgeID })
	shelters := append([]world.Shelter{}, g.Shelters...)
	sort.Slice(shelters, func(i, j int) bool { return shelters[i].ID < shelters[j].ID })
	for _, sh := range shelters {
		m.shelters = append(m.shelters, world.ShelterCondition{ShelterID: sh.ID, State: "available"})
		m.shelterCells = append(m.shelterCells, m.nodes[sh.NodeID])
	}
	if cfg.Hydrology.AntecedentRainHours > 0 {
		m.domain.advance(cfg.Hydrology.AntecedentRainHours*3600, cfg.RainfallIntensity*RainfallScaleMMH)
	}
	m.domain.rainfall = 0
	m.updateConditions()
	return m, nil
}

func (m *Model) Config() Config {
	c := m.config
	c.Zones = append([]ZoneConfig(nil), c.Zones...)
	c.GeographicReference = c.GeographicReference.Clone()
	if c.Hydrology != nil {
		h := *c.Hydrology
		c.Hydrology = &h
	}
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
	default:
		if x < .55 {
			return 1
		}
	}
	return 0
}

// Advance integrates exact profile boundaries, then bounded physical substeps.
// Repeated/older indices are idempotent and skipped indices run every step.
// Physical rain never depends on visual playback or HTTP request timing.
func (m *Model) Advance(step int) {
	last := int(math.Ceil(m.config.SimulationDuration / m.config.TimeStep))
	if step > last {
		step = last
	}
	for m.step < step {
		start := float64(m.step) * m.config.TimeStep
		dt := math.Min(m.config.TimeStep, m.config.SimulationDuration-start)
		end := start + dt
		m.rainfall = 0
		for at := start; at < end; {
			next := end
			for _, fraction := range [...]float64{.15, .45, .55} {
				boundary := fraction * m.config.SimulationDuration
				if boundary > at && boundary < next {
					next = boundary
				}
			}
			segment := next - at
			rain := m.config.RainfallIntensity * m.profile(at)
			m.rainfall += rain * segment / dt
			m.domain.advance(segment/m.config.TimeStep*m.config.Hydrology.SecondsPerTurn, rain*RainfallScaleMMH)
			at = next
		}
		m.domain.rainfall = m.rainfall * RainfallScaleMMH
		m.step++
		m.updateConditions()
	}
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

func (m *Model) depthAt(cell int) float64 {
	if cell < 0 || cell >= len(m.domain.depth) {
		return 0
	}
	return m.domain.depth[cell]
}
func (m *Model) risk(depth float64) float64 { return clamp(depth / m.config.Hydrology.BlockedDepthM) }

func (m *Model) updateConditions() {
	h := m.config.Hydrology
	t := RoadThresholds{Caution: h.CautionDepthM, Blocked: h.BlockedDepthM, Hysteresis: h.HysteresisM, CautionPenalty: m.config.RoadRiskThresholds.CautionPenalty}
	for i := range m.roads {
		r := &m.roads[i]
		depth := 0.0
		for _, cell := range r.cells {
			depth = math.Max(depth, m.depthAt(cell))
		}
		state, risk := nextState(r.condition.State, depth, t), m.risk(depth)
		if risk != r.condition.RiskScore || state != r.condition.State {
			r.condition.UpdatedAtSimulationStep = m.step
		}
		// Public Roads() deep-copies this internal scalar.
		r.depth = depth
		r.condition.DepthM = &r.depth
		r.condition.State = state
		r.condition.RiskScore = risk
		r.condition.CostMultiplier = 1
		if state == "caution" {
			r.condition.CostMultiplier += t.CautionPenalty
		}
	}
	for i := range m.shelters {
		sh := &m.shelters[i]
		risk := m.risk(m.depthAt(m.shelterCells[i]))
		threshold := m.config.ShelterExposureThreshold
		if sh.State == "exposed" {
			threshold = math.Max(threshold*.5, threshold-h.HysteresisM/h.BlockedDepthM)
		}
		state := "available"
		if risk >= threshold {
			state = "exposed"
		}
		if risk != sh.RiskScore || state != sh.State {
			sh.UpdatedAtSimulationStep = m.step
		}
		sh.RiskScore, sh.State = risk, state
	}
}

// Zones is an empty compatibility collection. Calculated hydraulic cells are
// the only active inundation extent; no circles or polygons substitute flow.
func (m *Model) Zones() []world.FloodZone { return []world.FloodZone{} }
func (m *Model) Roads() []world.RoadCondition {
	roads := make([]world.RoadCondition, len(m.roads))
	for i := range m.roads {
		roads[i] = m.roads[i].condition
		if roads[i].DepthM != nil {
			depth := *roads[i].DepthM
			roads[i].DepthM = &depth
		}
	}
	return roads
}
func (m *Model) Shelters() []world.ShelterCondition {
	return append([]world.ShelterCondition{}, m.shelters...)
}
func (m *Model) ExposureAt(nodeID string) float64 {
	cell, ok := m.nodes[nodeID]
	if !ok {
		return 0
	}
	return m.risk(m.depthAt(cell))
}
func (m *Model) Rainfall() float64 { return m.rainfall }

func (m *Model) HydraulicSnapshot() *world.HydraulicSnapshot {
	d := m.domain
	s := &world.HydraulicSnapshot{Model: m.config.HydraulicModel, TerrainSource: "synthetic-coastal-basin-v1", Grid: d.grid, DepthsM: append([]float64{}, d.depth...), RainfallMMH: d.rainfall, HydrologicalTimeSeconds: d.clock, MassBalance: d.budget()}
	for _, depth := range d.depth {
		if depth >= .01 {
			s.FloodedAreaM2 += d.grid.CellSizeM * d.grid.CellSizeM
		}
		s.MaxDepthM = math.Max(s.MaxDepthM, depth)
	}
	return s
}

// cellsAlong visits every grid cell intersected by a segment interior. Splitting
// at each vertical/horizontal grid line avoids missing a flooded interior cell
// even when both road endpoints are dry. Geometry is indexed once at creation.
func (m *Model) cellsAlong(points []world.GeoPoint) []int {
	seen := map[int]bool{}
	grid := m.domain.grid
	add := func(p world.GeoPoint) {
		if i := m.domain.cellAt(p); i >= 0 {
			seen[i] = true
		}
	}
	for j := 1; j < len(points); j++ {
		a, b := points[j-1], points[j]
		add(a)
		add(b)
		times := []float64{0, 1}
		if b.Lng != a.Lng {
			for c := 0; c <= grid.Cols; c++ {
				x := grid.Origin.Lng + float64(c)*grid.LngStep
				t := (x - a.Lng) / (b.Lng - a.Lng)
				if t > 0 && t < 1 {
					times = append(times, t)
				}
			}
		}
		if b.Lat != a.Lat {
			for r := 0; r <= grid.Rows; r++ {
				y := grid.Origin.Lat + float64(r)*grid.LatStep
				t := (y - a.Lat) / (b.Lat - a.Lat)
				if t > 0 && t < 1 {
					times = append(times, t)
				}
			}
		}
		sort.Float64s(times)
		for k := 1; k < len(times); k++ {
			t := (times[k-1] + times[k]) * .5
			add(world.GeoPoint{Lat: a.Lat + t*(b.Lat-a.Lat), Lng: a.Lng + t*(b.Lng-a.Lng)})
		}
	}
	cells := make([]int, 0, len(seen))
	for cell := range seen {
		cells = append(cells, cell)
	}
	sort.Ints(cells)
	return cells
}
