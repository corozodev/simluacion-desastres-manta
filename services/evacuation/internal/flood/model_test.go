package flood

import (
	"encoding/json"
	"fmt"
	"math"
	"reflect"
	"testing"

	"corodev/evacuation/internal/world"
)

func fixture() *world.Graph {
	return &world.Graph{
		Version: "synthetic-flood-test", Source: "synthetic-test-only",
		Nodes: []world.GraphNode{
			{ID: "a", Lat: 0, Lng: -.001}, {ID: "b", Lat: 0, Lng: .001},
			{ID: "c", Lat: 0, Lng: 0}, {ID: "d", Lat: .01, Lng: .01},
			{ID: "e", Lat: .01, Lng: .011},
		},
		Edges: []world.GraphEdge{
			{ID: "ab", From: "a", To: "b", DistanceM: 222, SpeedMPS: 1.4, RoadType: "residential", Geometry: []world.GeoPoint{{Lat: 0, Lng: -.001}, {Lat: 0, Lng: 0}, {Lat: 0, Lng: .001}}},
			{ID: "bc", From: "b", To: "c", DistanceM: 111, SpeedMPS: 1.4, RoadType: "residential"},
			{ID: "cd", From: "c", To: "d", DistanceM: 1572, SpeedMPS: 1.4, RoadType: "residential"},
			{ID: "de", From: "d", To: "e", DistanceM: 111, SpeedMPS: 1.4, RoadType: "residential"},
		},
		Shelters: []world.Shelter{{ID: "far", NodeID: "e", Capacity: 10}, {ID: "near", NodeID: "c", Capacity: 10}},
	}
}

func focusedConfig() Config {
	c := DefaultConfig()
	c.Zones = []ZoneConfig{{ID: "focus", CenterNode: "c", RadiusMinM: 20, RadiusMaxM: 50}}
	return c
}

func mustModel(t *testing.T, g *world.Graph, seed int64, cfg Config) *Model {
	t.Helper()
	m, err := New(g, seed, cfg)
	if err != nil {
		t.Fatal(err)
	}
	return m
}

func domainFixture(rows, cols int, z []float64, outfalls []int) *hydraulicDomain {
	h := DefaultHydrologyConfig()
	h.InfiltrationMMH = 0
	h.DrainageMMH = 0
	return newDomain(world.HydraulicGrid{Rows: rows, Cols: cols, CellSizeM: 10, LatStep: .001, LngStep: .001}, z, regularLinks(rows, cols), outfalls, h)
}
func initialDepth(d *hydraulicDomain, depths ...float64) {
	copy(d.depth, depths)
	d.ledger.InitialStorageM3 = 0
	for _, depth := range d.depth {
		d.ledger.InitialStorageM3 += depth * d.grid.CellSizeM * d.grid.CellSizeM
	}
}
func assertMass(t *testing.T, d *hydraulicDomain) {
	t.Helper()
	b := d.budget()
	scale := math.Max(1, b.InitialStorageM3+b.RainfallM3+b.ChannelInflowM3+b.SeaInflowM3)
	if math.Abs(b.ResidualM3) > scale*1e-9 {
		t.Fatalf("surface mass was not conserved: %+v", b)
	}
	for _, depth := range d.depth {
		if !finite(depth) || depth < 0 {
			t.Fatalf("invalid water depth %g", depth)
		}
	}
}

func TestConstantRainOnFlatClosedTerrain(t *testing.T) {
	d := domainFixture(2, 2, []float64{0, 0, 0, 0}, nil)
	d.advance(3600, 120)
	for _, depth := range d.depth {
		if math.Abs(depth-.12) > 1e-12 {
			t.Fatalf("expected 120 mm accumulated, got %gm", depth)
		}
	}
	if math.Abs(d.budget().RainfallM3-48) > 1e-9 {
		t.Fatal("rain does not match area and physical duration")
	}
	assertMass(t, d)
}
func TestSlopePropagationDepressionAndBarrier(t *testing.T) {
	t.Run("slope", func(t *testing.T) {
		d := domainFixture(1, 3, []float64{1, .5, 0}, nil)
		initialDepth(d, .2, 0, 0)
		d.advance(600, 0)
		if d.depth[2] <= 0 || d.depth[0] >= .2 {
			t.Fatalf("runoff did not propagate down slope: %v", d.depth)
		}
		assertMass(t, d)
	})
	t.Run("depression", func(t *testing.T) {
		d := domainFixture(1, 3, []float64{1, 0, 1}, nil)
		initialDepth(d, .1, .1, .1)
		d.advance(600, 0)
		if d.depth[1] <= .1 || d.depth[1] <= d.depth[0] {
			t.Fatalf("depression did not accumulate: %v", d.depth)
		}
		assertMass(t, d)
	})
	t.Run("disconnected", func(t *testing.T) {
		d := domainFixture(1, 3, []float64{1, .5, 0}, nil)
		d.links = []hydraulicLink{{0, 1}}
		d.flux = make([]float64, 1)
		initialDepth(d, .3, 0, 0)
		d.advance(3600, 0)
		if d.depth[2] != 0 {
			t.Fatalf("water crossed an impermeable barrier: %v", d.depth)
		}
		assertMass(t, d)
	})
}
func TestSeaOutletAndHighTideBackwater(t *testing.T) {
	low := domainFixture(1, 1, []float64{0}, []int{0})
	initialDepth(low, .2)
	low.advance(600, 0)
	if low.budget().SeaOutflowM3 <= 0 || low.depth[0] >= .2 {
		t.Fatal("connected sea outlet did not discharge")
	}
	assertMass(t, low)
	high := domainFixture(1, 1, []float64{0}, []int{0})
	high.cfg.SeaLevelM = .3
	initialDepth(high, .2)
	high.advance(600, 0)
	if high.budget().SeaInflowM3 <= 0 || high.depth[0] <= low.depth[0] {
		t.Fatal("raised sea boundary had no backwater effect")
	}
	assertMass(t, high)
	disconnected := domainFixture(1, 1, []float64{0}, nil)
	disconnected.cfg.SeaLevelM = 1
	disconnected.advance(600, 0)
	if disconnected.depth[0] != 0 || disconnected.budget().SeaInflowM3 != 0 {
		t.Fatal("sea flooded a disconnected cell")
	}
	assertMass(t, disconnected)
	// Even without direct sea ingress, a submerged pipe outlet limits drainage.
	pipeLow := domainFixture(1, 1, []float64{0}, nil)
	pipeLow.cfg.DrainageMMH = 10
	initialDepth(pipeLow, .2)
	pipeLow.advance(3600, 0)
	pipeHigh := domainFixture(1, 1, []float64{0}, nil)
	pipeHigh.cfg.DrainageMMH = 10
	pipeHigh.cfg.SeaLevelM = 1
	initialDepth(pipeHigh, .2)
	pipeHigh.advance(3600, 0)
	if pipeHigh.budget().DrainageM3 != 0 || pipeLow.budget().DrainageM3 <= 0 {
		t.Fatal("submerged drainage was not limited")
	}
}
func TestRainCessationDrainsGraduallyAndSaturationReducesInfiltration(t *testing.T) {
	d := domainFixture(1, 1, []float64{1}, nil)
	d.cfg.DrainageMMH = 6
	d.advance(3600, 120)
	peak := d.depth[0]
	d.advance(3600, 0)
	if d.depth[0] <= 0 || d.depth[0] >= peak {
		t.Fatalf("water did not recede gradually after rain: peak=%g now=%g", peak, d.depth[0])
	}
	assertMass(t, d)
	dry := domainFixture(1, 1, []float64{1}, nil)
	dry.cfg.InfiltrationMMH = 20
	dry.advance(3600, 120)
	wet := domainFixture(1, 1, []float64{1}, nil)
	wet.cfg.InfiltrationMMH = 20
	wet.saturation[0] = 1
	wet.advance(3600, 120)
	if wet.depth[0] <= dry.depth[0] || wet.budget().InfiltrationM3 != 0 || dry.budget().InfiltrationM3 <= 0 {
		t.Fatal("antecedent saturation did not affect surface runoff")
	}
	assertMass(t, dry)
	assertMass(t, wet)
}
func TestChannelInputAndExtremeTransfersRemainConservative(t *testing.T) {
	z := make([]float64, 16)
	for i := range z {
		z[i] = float64(i%4)*.8 + float64(i/4)*.2
	}
	d := domainFixture(4, 4, z, []int{0, 4, 8, 12})
	d.cfg.ChannelInflowM3S = 50
	d.cfg.InfiltrationMMH = 8
	d.cfg.DrainageMMH = 6
	d.cfg.SeaLevelM = 2
	for i := 0; i < 3000; i++ {
		rain := 0.0
		if i%3 != 0 {
			rain = 120
		}
		d.advance(60, rain)
		if i%100 == 0 {
			assertMass(t, d)
		}
	}
	if d.budget().ChannelInflowM3 != 50*3000*60 {
		t.Fatal("channel inflow not accounted")
	}
	assertMass(t, d)
}
func TestJSONDefaultsAndConfigValidation(t *testing.T) {
	var c Config
	if err := json.Unmarshal([]byte(`{"rainfall_intensity":0,"drainage_factor":0,"hydrology":{"infiltration_mm_h":0,"drainage_mm_h":0,"initial_saturation":0}}`), &c); err != nil {
		t.Fatal(err)
	}
	c, err := c.WithDefaults()
	if err != nil {
		t.Fatal(err)
	}
	if c.HydraulicModel != "rainfall_runoff_2d" || c.Hydrology.SecondsPerTurn != 60 || c.Hydrology.InfiltrationMMH != 0 || c.Hydrology.DrainageMMH != 0 || c.RainfallIntensity != 0 {
		t.Fatalf("defaults/explicit zero lost: %+v", c)
	}
	for _, invalid := range []string{`null`, `[]`, `{"unknown":1}`, `{"hydrology":{"unknown":1}}`, `{"hydrology":{"seconds_per_turn":0}}`, `{"time_step":0}`, `{"simulation_duration":0}`, `{"hydrology":{"initial_saturation":2}}`, `{"hydrology":{"blocked_depth_m":0.05}}`} {
		if err := json.Unmarshal([]byte(invalid), &c); err == nil {
			if _, err = c.WithDefaults(); err == nil {
				t.Fatalf("accepted %s", invalid)
			}
		}
	}
	cases := map[string]func(*Config){
		"legacy-removed": func(c *Config) { c.HydraulicModel = "legacy" }, "profile": func(c *Config) { c.RainfallProfile = "fake" }, "behavior": func(c *Config) { c.EvacuationBehavior = "fatal" },
		"nan": func(c *Config) { c.RainfallIntensity = math.NaN() }, "duration": func(c *Config) { c.SimulationDuration = -1 }, "steps": func(c *Config) { c.TimeStep = 1e-10 },
		"coastal-without-compound": func(c *Config) { h := DefaultHydrologyConfig(); h.SeaLevelM = 1; c.Hydrology = &h },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			cfg := DefaultConfig()
			mutate(&cfg)
			if _, err := New(fixture(), 1, cfg); err == nil {
				t.Fatal("invalid configuration accepted")
			}
		})
	}
}
func TestExistingRainProfilesAndPhysicalTime(t *testing.T) {
	rain := map[string]float64{}
	for _, profile := range []string{"storm", "constant", "pulse"} {
		cfg := DefaultConfig()
		cfg.RainfallProfile = profile
		cfg.RainfallIntensity = 1
		a := mustModel(t, fixture(), 17, cfg)
		a.Advance(150)
		h := a.HydraulicSnapshot()
		rain[profile] = h.MassBalance.RainfallM3
		if math.Abs(h.HydrologicalTimeSeconds-150*60) > 1e-8 || len(a.Zones()) != 0 {
			t.Fatal("storm clock incorrect or obsolete circles remain")
		}
		assertMass(t, a.domain)
	}
	if math.Abs(rain["storm"]/rain["constant"]-.55) > 1e-10 || math.Abs(rain["pulse"]/rain["constant"]-.30) > 1e-10 {
		t.Fatalf("rain profiles lost their definitions: %v", rain)
	}
}
func TestAntecedentRainAndInitialWaterHaveExplicitLedger(t *testing.T) {
	cfg := DefaultConfig()
	h := DefaultHydrologyConfig()
	h.AntecedentRainHours = 2
	h.InitialWaterDepthM = .05
	h.InitialSaturation = .8
	cfg.Hydrology = &h
	m := mustModel(t, fixture(), 8, cfg)
	snap := m.HydraulicSnapshot()
	if snap.HydrologicalTimeSeconds != 7200 || snap.MassBalance.InitialStorageM3 <= 0 || snap.MassBalance.RainfallM3 <= 0 || snap.MassBalance.StoredM3 <= 0 {
		t.Fatalf("antecedent conditions not integrated: %+v", snap.MassBalance)
	}
	m.Advance(1)
	if m.HydraulicSnapshot().HydrologicalTimeSeconds != 7260 {
		t.Fatal("antecedent and evacuation clocks were conflated")
	}
	assertMass(t, m.domain)
}
func TestDeterministicAdvanceDurationAndBoundedStorage(t *testing.T) {
	for _, duration := range []int{30, 150, 300, 600, 1200, 3000} {
		t.Run(fmt.Sprint(duration), func(t *testing.T) {
			cfg := DefaultConfig()
			cfg.SimulationDuration = float64(duration)
			h := DefaultHydrologyConfig()
			h.SecondsPerTurn = 2
			cfg.Hydrology = &h
			a, b := mustModel(t, fixture(), 42, cfg), mustModel(t, fixture(), 42, cfg)
			cells, links, roads := len(a.domain.depth), len(a.domain.links), len(a.roads)
			for i := 1; i <= duration; i++ {
				a.Advance(i)
			}
			b.Advance(duration)
			if !reflect.DeepEqual(a.HydraulicSnapshot(), b.HydraulicSnapshot()) || !reflect.DeepEqual(a.Roads(), b.Roads()) {
				t.Fatal("same config/seed differed across pause/advance partitions")
			}
			before := b.HydraulicSnapshot()
			b.Advance(1)
			b.Advance(math.MaxInt)
			if !reflect.DeepEqual(before, b.HydraulicSnapshot()) {
				t.Fatal("old/repeated/out-of-duration advance modified final state")
			}
			if a.step != duration || len(a.domain.depth) != cells || len(a.domain.links) != links || len(a.roads) != roads || cells > MaxHydraulicCells {
				t.Fatal("effective duration or bounded storage violated")
			}
			assertMass(t, a.domain)
		})
	}
}
func TestStreetInteriorSamplingAndDepthHysteresis(t *testing.T) {
	m := mustModel(t, fixture(), 1, DefaultConfig())
	var crossing *hydraulicRoad
	for i := range m.roads {
		if m.roads[i].condition.EdgeID == "ab" {
			crossing = &m.roads[i]
		}
	}
	if crossing == nil || len(crossing.cells) < 2 {
		t.Fatal("road geometry not intersected")
	}
	cell := crossing.cells[len(crossing.cells)/2]
	m.domain.depth[cell] = .35
	m.updateConditions()
	if crossing.condition.State != "blocked" || crossing.condition.DepthM == nil || *crossing.condition.DepthM != .35 {
		t.Fatalf("interior water not coupled to street: %+v", crossing.condition)
	}
	m.domain.depth[cell] = .28
	m.updateConditions()
	if crossing.condition.State != "blocked" {
		t.Fatal("blocked street reopened within hysteresis")
	}
	m.domain.depth[cell] = .26
	m.updateConditions()
	if crossing.condition.State != "caution" {
		t.Fatal("street did not reopen below release threshold")
	}
	m.domain.depth[cell] = .06
	m.updateConditions()
	if crossing.condition.State != "passable" {
		t.Fatal("street did not recover after water receded")
	}
}
func TestOriginalGraphAndObservableCopiesAreIndependent(t *testing.T) {
	g := fixture()
	before, _ := json.Marshal(g)
	m := mustModel(t, g, 1, DefaultConfig())
	m.Advance(10)
	roads, cfg, snap := m.Roads(), m.Config(), m.HydraulicSnapshot()
	roads[0].State = "mutated"
	*roads[0].DepthM = 99
	cfg.Hydrology.SecondsPerTurn = 299
	snap.DepthsM[0] = 99
	if m.Roads()[0].State == "mutated" || *m.Roads()[0].DepthM == 99 || m.Config().Hydrology.SecondsPerTurn != 60 || m.HydraulicSnapshot().DepthsM[0] == 99 {
		t.Fatal("observer/configuration aliases model state")
	}
	after, _ := json.Marshal(g)
	if string(before) != string(after) {
		t.Fatal("hydraulics modified immutable street graph")
	}
}
func TestRequestedResolutionCoarsensBeforeExceedingCellBudget(t *testing.T) {
	g := fixture()
	g.Nodes[4].Lat = .4
	g.Nodes[4].Lng = .4
	h := DefaultHydrologyConfig()
	h.CellSizeM = 50
	cfg := DefaultConfig()
	cfg.Hydrology = &h
	m := mustModel(t, g, 1, cfg)
	if len(m.domain.depth) > MaxHydraulicCells || m.domain.grid.CellSizeM <= 50 {
		t.Fatalf("unbounded resolution: %+v", m.domain.grid)
	}
}
func BenchmarkAdvance(b *testing.B) {
	cfg := DefaultConfig()
	cfg.SimulationDuration = 10000
	m, err := New(fixture(), 1, cfg)
	if err != nil {
		b.Fatal(err)
	}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		m.step = 0
		m.Advance(1)
	}
}

func TestPulseHasDelayedDownstreamResponse(t *testing.T) {
	d := domainFixture(1, 5, []float64{.08, .06, .04, .02, 0}, nil)
	d.rainWeights = []float64{5, 0, 0, 0, 0}
	d.advance(300, 120)
	downstreamAtCessation := d.depth[4]
	upstreamAtCessation := d.depth[0]
	d.advance(1800, 0)
	if d.depth[4] <= downstreamAtCessation || d.depth[0] >= upstreamAtCessation {
		t.Fatalf("stopping rain did not retain and propagate water downstream: at cutoff upstream=%g downstream=%g, later=%v", upstreamAtCessation, downstreamAtCessation, d.depth)
	}
	if d.budget().RainfallM3 <= 0 || d.budget().StoredM3 <= 0 {
		t.Fatal("pulse water disappeared after the forcing stopped")
	}
	assertMass(t, d)
}

func TestHydraulicObserverCloneOwnsDepthArraysAndRoadDepthScalars(t *testing.T) {
	m := mustModel(t, fixture(), 1, DefaultConfig())
	m.Advance(2)
	source := &world.ScenarioSnapshot{Hydraulic: m.HydraulicSnapshot(), RoadConditions: m.Roads()}
	copy := source.Clone()
	copy.Hydraulic.DepthsM[0] = 99
	*copy.RoadConditions[0].DepthM = 99
	if source.Hydraulic.DepthsM[0] == 99 || *source.RoadConditions[0].DepthM == 99 {
		t.Fatal("observer snapshot clone shares water arrays or road scalar pointers")
	}
}
