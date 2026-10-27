package flood

import (
	"encoding/json"
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

func TestJSONDefaultsAndExplicitZero(t *testing.T) {
	var c Config
	if err := json.Unmarshal([]byte(`{"rainfall_intensity":0,"drainage_factor":0,"road_risk_thresholds":{"hysteresis":0,"caution_penalty":0}}`), &c); err != nil {
		t.Fatal(err)
	}
	if c.RainfallIntensity != 0 || c.DrainageFactor != 0 || c.RoadRiskThresholds.Hysteresis != 0 || c.RoadRiskThresholds.CautionPenalty != 0 || c.FloodGrowthRate != .08 || c.RoadRiskThresholds.Caution != .3 {
		t.Fatalf("defaults or intentional zero lost: %+v", c)
	}
	if _, err := c.WithDefaults(); err != nil {
		t.Fatal(err)
	}
	for _, invalid := range []string{`null`, `[]`, `{"unknown":1}`, `{"road_risk_thresholds":{"unknown":1}}`, `{"time_step":0}`, `{"simulation_duration":0}`, `{"shelter_exposure_threshold":0}`, `{"road_risk_thresholds":{"caution":0}}`} {
		if err := json.Unmarshal([]byte(invalid), &c); err == nil {
			t.Fatalf("accepted invalid config %s", invalid)
		}
	}
}

func TestConfigRejectsInvalidBounds(t *testing.T) {
	cases := map[string]func(*Config){
		"profile":         func(c *Config) { c.RainfallProfile = "hydrodynamic" },
		"behavior":        func(c *Config) { c.EvacuationBehavior = "fatal" },
		"nan":             func(c *Config) { c.FloodGrowthRate = math.NaN() },
		"infinity":        func(c *Config) { c.TimeStep = math.Inf(1) },
		"duration":        func(c *Config) { c.SimulationDuration = -1 },
		"too-many-steps":  func(c *Config) { c.TimeStep = 1e-10 },
		"intensity":       func(c *Config) { c.RainfallIntensity = 1.1 },
		"drainage":        func(c *Config) { c.DrainageFactor = -.1 },
		"threshold-order": func(c *Config) { c.RoadRiskThresholds.Blocked = .1 },
		"hysteresis":      func(c *Config) { c.RoadRiskThresholds.Hysteresis = .4 },
		"shelter":         func(c *Config) { c.ShelterExposureThreshold = 1.1 },
		"many-zones":      func(c *Config) { c.Zones = make([]ZoneConfig, 33) },
		"duplicate-zone":  func(c *Config) { c.Zones = append(c.Zones, c.Zones[0]) },
		"radius":          func(c *Config) { c.Zones[0].RadiusMaxM = 5 },
		"large-radius":    func(c *Config) { c.Zones[0].RadiusMaxM = 10001 },
		"duplicate-center": func(c *Config) {
			z := c.Zones[0]
			z.ID = "another"
			c.Zones = append(c.Zones, z)
		},
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			cfg := focusedConfig()
			mutate(&cfg)
			if _, err := New(fixture(), 1, cfg); err == nil {
				t.Fatal("accepted invalid config")
			}
		})
	}
	cfg := focusedConfig()
	cfg.Zones[0].CenterNode = "missing"
	if _, err := New(fixture(), 1, cfg); err == nil {
		t.Fatal("accepted missing geographic center")
	}
}

func TestSeedReproducibilityAndDifference(t *testing.T) {
	a := mustModel(t, fixture(), 17, DefaultConfig())
	b := mustModel(t, fixture(), 17, DefaultConfig())
	c := mustModel(t, fixture(), 18, DefaultConfig())
	for step := 1; step <= 100; step++ {
		a.Advance(step)
		b.Advance(step)
		c.Advance(step)
		if !reflect.DeepEqual(a.Zones(), b.Zones()) || !reflect.DeepEqual(a.Roads(), b.Roads()) || !reflect.DeepEqual(a.Shelters(), b.Shelters()) {
			t.Fatalf("same seed differed at step %d", step)
		}
	}
	if reflect.DeepEqual(a.Zones(), c.Zones()) {
		t.Fatal("different seeds produced identical spatial exposure")
	}
}

func TestGrowthDrainageBlocksAndReopens(t *testing.T) {
	m := mustModel(t, fixture(), 1, focusedConfig())
	previous := m.Zones()[0]
	sawCaution, sawBlocked, sawExposed := false, false, false
	for step := 1; step <= 80; step++ {
		m.Advance(step)
		current := m.Zones()[0]
		if current.Intensity < previous.Intensity || current.RadiusM < previous.RadiusM {
			t.Fatal("risk decreased during constant storm input")
		}
		previous = current
		for _, r := range m.Roads() {
			sawCaution = sawCaution || r.State == "caution"
			sawBlocked = sawBlocked || r.State == "blocked"
			if r.State == "caution" && r.CostMultiplier != 3 {
				t.Fatal("caution penalty is not constant")
			}
		}
		for _, sh := range m.Shelters() {
			sawExposed = sawExposed || sh.State == "exposed"
		}
	}
	if !sawCaution || !sawBlocked || !sawExposed {
		t.Fatalf("storm did not affect roads/refuges: caution=%v blocked=%v exposed=%v", sawCaution, sawBlocked, sawExposed)
	}
	m.Advance(150)
	if m.Zones()[0].Intensity >= previous.Intensity || m.Zones()[0].RadiusM >= previous.RadiusM || m.Rainfall() != 0 {
		t.Fatal("dry period did not drain and shrink exposure")
	}
	for _, r := range m.Roads() {
		if r.State != "passable" || r.CostMultiplier != 1 {
			t.Fatalf("road failed to reopen: %+v", r)
		}
	}
	for _, sh := range m.Shelters() {
		if sh.State != "available" {
			t.Fatalf("refuge failed to recover: %+v", sh)
		}
	}
}

func TestPolylineIntersectionAndSparseCandidates(t *testing.T) {
	m := mustModel(t, fixture(), 1, focusedConfig())
	m.Advance(20)
	found := false
	for _, r := range m.Roads() {
		if r.EdgeID == "ab" {
			found = true
			if r.State != "blocked" || r.RiskScore != m.Zones()[0].Intensity {
				t.Fatalf("crossing polyline ignored: %+v", r)
			}
		}
		if r.EdgeID == "de" {
			t.Fatal("unaffected road included in candidate overlay")
		}
	}
	if !found || m.ExposureAt("a") != 0 || m.ExposureAt("b") != 0 || m.ExposureAt("c") == 0 {
		t.Fatal("interior crossing incorrectly evaluated from endpoints")
	}
}

func TestHysteresis(t *testing.T) {
	thresholds := DefaultConfig().RoadRiskThresholds
	state := "passable"
	for _, item := range []struct {
		risk     float64
		expected string
	}{
		{.31, "caution"}, {.28, "caution"}, {.23, "caution"}, {.21, "passable"},
		{.7, "blocked"}, {.64, "blocked"}, {.58, "blocked"}, {.56, "caution"}, {.1, "passable"},
	} {
		state = nextState(state, item.risk, thresholds)
		if state != item.expected {
			t.Fatalf("risk %v: got %s want %s", item.risk, state, item.expected)
		}
	}
}

func TestZeroRainAndDrainageAndStableAdvance(t *testing.T) {
	cfg := focusedConfig()
	cfg.RainfallIntensity = 0
	m := mustModel(t, fixture(), 1, cfg)
	m.Advance(150)
	if m.Zones()[0].Intensity != 0 || m.ExposureAt("c") != 0 {
		t.Fatal("zero rainfall grew flood")
	}
	cfg.RainfallIntensity, cfg.DrainageFactor = 1, 0
	a := mustModel(t, fixture(), 1, cfg)
	b := mustModel(t, fixture(), 1, cfg)
	for i := 1; i <= 150; i++ {
		a.Advance(i)
	}
	b.Advance(150)
	if !reflect.DeepEqual(a.Roads(), b.Roads()) || !reflect.DeepEqual(a.Zones(), b.Zones()) {
		t.Fatal("jump advance differs from sequential advance")
	}
	previous := b.Zones()
	b.Advance(1)
	b.Advance(150)
	b.Advance(math.MaxInt)
	if !reflect.DeepEqual(previous, b.Zones()) || b.Zones()[0].Intensity != 1 {
		t.Fatal("repeated/older/out-of-duration step changed final exposure")
	}
}

func TestProfileBoundariesAreIndependentOfTimeStep(t *testing.T) {
	for _, profile := range []string{"storm", "pulse", "constant"} {
		cfg := focusedConfig()
		cfg.SimulationDuration = 10
		cfg.RainfallProfile = profile
		cfg.FloodGrowthRate = .01 // Avoid saturation when comparing integration.
		a := mustModel(t, fixture(), 1, cfg)
		cfg.TimeStep = 10
		b := mustModel(t, fixture(), 1, cfg)
		a.Advance(10)
		b.Advance(1)
		if math.Abs(a.Zones()[0].Intensity-b.Zones()[0].Intensity) > 1e-12 {
			t.Fatalf("%s exposure depends on time_step partition: %v vs %v", profile, a.Zones(), b.Zones())
		}
	}
}

func TestOriginalGraphAndReturnedValuesAreIndependent(t *testing.T) {
	g := fixture()
	before, err := json.Marshal(g)
	if err != nil {
		t.Fatal(err)
	}
	cfg := focusedConfig()
	m := mustModel(t, g, 1, cfg)
	cfg.Zones[0].RadiusMaxM = 999
	m.Advance(20)
	zones, roads, shelters, config := m.Zones(), m.Roads(), m.Shelters(), m.Config()
	zones[0].Intensity = -1
	roads[0].State = "mutated"
	shelters[0].State = "mutated"
	config.Zones[0].CenterNode = "mutated"
	if m.Zones()[0].Intensity < 0 || m.Roads()[0].State == "mutated" || m.Shelters()[0].State == "mutated" || m.Config().Zones[0].CenterNode != "c" || m.Config().Zones[0].RadiusMaxM != 50 {
		t.Fatal("returned/configuration values alias model internals")
	}
	after, err := json.Marshal(g)
	if err != nil {
		t.Fatal(err)
	}
	if string(before) != string(after) {
		t.Fatal("source graph mutated")
	}
}

func TestModelStorageRemainsBounded(t *testing.T) {
	cfg := focusedConfig()
	cfg.SimulationDuration = 10000
	m := mustModel(t, fixture(), 1, cfg)
	roads, foci, shelters := len(m.roads), len(m.foci), len(m.shelters)
	for i := 1; i <= 10000; i++ {
		m.Advance(i)
		if len(m.roads) != roads || len(m.foci) != foci || len(m.shelters) != shelters {
			t.Fatal("model accumulated history during advance")
		}
		for _, r := range m.roads {
			if r.condition.RiskScore < 0 || r.condition.RiskScore > 1 {
				t.Fatal("risk escaped normalized bounds")
			}
		}
	}
	if allocs := testing.AllocsPerRun(100, func() { m.updateConditions() }); allocs != 0 {
		t.Fatalf("per-step overlay update allocates: %v", allocs)
	}
}

func BenchmarkAdvance(b *testing.B) {
	cfg := focusedConfig()
	cfg.SimulationDuration = 10000
	m, err := New(fixture(), 1, cfg)
	if err != nil {
		b.Fatal(err)
	}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		// Reset simulated clock, preserving bounded initialized spatial indexes.
		m.step = 0
		m.Advance(1)
	}
}
