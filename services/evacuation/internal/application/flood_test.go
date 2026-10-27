package application_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"reflect"
	"slices"
	"sync"
	"testing"
	"time"

	"corodev/evacuation/internal/application"
	"corodev/evacuation/internal/flood"
	"corodev/evacuation/internal/graph"
	"corodev/evacuation/internal/simulation"
	"corodev/evacuation/internal/world"
)

// A deliberately synthetic diamond has a short avenue A-B-E and a longer
// alternative A-C-D-E. Four fictional shelters satisfy the existing HTTP API.
func floodFixture() *world.Graph {
	g := &world.Graph{Version: "synthetic-flood-http-v1", Source: "synthetic integration-test fixture"}
	g.Nodes = []world.GraphNode{
		{ID: "A", Lat: 0, Lng: 0}, {ID: "B", Lat: 0, Lng: .001},
		{ID: "C", Lat: .001, Lng: 0}, {ID: "D", Lat: .001, Lng: .001},
		{ID: "E", Lat: 0, Lng: .002}, {ID: "F", Lat: .001, Lng: .002},
	}
	for _, e := range []struct {
		from, to string
		length   float64
	}{{"A", "B", 100}, {"B", "E", 100}, {"A", "C", 150}, {"C", "D", 150}, {"D", "E", 150}, {"E", "F", 150}, {"D", "F", 150}} {
		var from, to world.GeoPoint
		for _, node := range g.Nodes {
			if node.ID == e.from {
				from = world.GeoPoint{Lat: node.Lat, Lng: node.Lng}
			}
			if node.ID == e.to {
				to = world.GeoPoint{Lat: node.Lat, Lng: node.Lng}
			}
		}
		g.Edges = append(g.Edges, world.GraphEdge{ID: e.from + e.to, From: e.from, To: e.to, DistanceM: e.length, SpeedMPS: 1.4, RoadType: "residential", Geometry: []world.GeoPoint{from, to}})
	}
	for i := 1; i <= 4; i++ {
		g.Shelters = append(g.Shelters, world.Shelter{ID: fmt.Sprintf("H%d", i), NodeID: "E", Capacity: 4})
	}
	return g
}

func floodConfig(behavior string, duration float64) simulation.Config {
	fc := flood.DefaultConfig()
	fc.RainfallIntensity = 0
	fc.EvacuationBehavior = behavior
	fc.SimulationDuration = duration
	return simulation.Config{ScenarioType: "urban_flood", Flood: &fc, Seed: 91, Concurrency: 3,
		InitialSurvivors: []world.Survivor{{ID: "S1", CurrentNode: "A", Status: world.Active}}}
}

func newFloodApp(t *testing.T, g *world.Graph, cfg simulation.Config) *application.App {
	t.Helper()
	key, err := application.EphemeralKey()
	if err != nil {
		t.Fatal(err)
	}
	app, err := application.New(g, cfg, "127.0.0.1:0", key, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := app.Close(); err != nil {
			t.Error(err)
		}
	})
	return app
}

func floodHTTPState(t *testing.T, app *application.App) *world.ScenarioSnapshot {
	t.Helper()
	response, err := http.Get(app.BaseURL + "/v1/scenario")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("scenario endpoint: HTTP %d", response.StatusCode)
	}
	var state world.ScenarioSnapshot
	decoder := json.NewDecoder(response.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&state); err != nil {
		t.Fatal(err)
	}
	if state.ScenarioType != "urban_flood" || state.GraphVersion == "" || len(state.ShelterConditions) != 4 || state.DataProvenance.Disclaimer == "" {
		t.Fatalf("incomplete flood contract: %+v", state)
	}
	return &state
}

func floodStep(t *testing.T, app *application.App) world.WorldSnapshot {
	t.Helper()
	if err := app.Simulator.Step(context.Background()); err != nil {
		t.Fatal(err)
	}
	w := app.Simulator.Snapshot()
	public := floodHTTPState(t, app)
	if public.SimulationStep != w.Turn || public.WorldVersion != w.WorldVersion || !reflect.DeepEqual(public, w.Scenario) {
		t.Fatal("HTTP scenario differs from the immutable decision snapshot")
	}
	if len(w.Zombies) != 0 || w.Metrics.Bitten != 0 || w.Metrics.RequestsInvalid != 0 || w.Metrics.RequestsTimeout != 0 {
		t.Fatalf("flood introduced zombie outcomes or failed real HTTP decisions: %+v", w.Metrics)
	}
	for _, sh := range w.Shelters {
		if sh.Occupancy < 0 || sh.Reserved < 0 || sh.Available < 0 || sh.Occupancy+sh.Reserved+sh.Available != sh.Capacity {
			t.Fatalf("incoherent shelter capacity: %+v", sh)
		}
	}
	return w
}

func deterministicFloodState(w world.WorldSnapshot) world.WorldSnapshot {
	w.Metrics.HTTPP50MS, w.Metrics.HTTPP95MS, w.Metrics.HTTPP99MS = 0, 0, 0
	if w.Scenario != nil {
		w.Scenario.Performance = world.SimulationPerformance{}
	}
	return w
}

func TestUrbanFloodHTTPDeterminismAndIndependentSeeds(t *testing.T) {
	run := func(seed int64) []world.WorldSnapshot {
		cfg := floodConfig("preventive", 12)
		cfg.Seed, cfg.InitialSurvivors, cfg.Survivors = seed, nil, 12
		cfg.Flood.RainfallIntensity = .8
		app := newFloodApp(t, floodFixture(), cfg)
		states := []world.WorldSnapshot{}
		for i := 0; i < 12; i++ {
			states = append(states, deterministicFloodState(floodStep(t, app)))
		}
		return states
	}
	a, b, c := run(91), run(91), run(92)
	if !reflect.DeepEqual(a, b) {
		t.Fatal("identical seeds did not reproduce all observable steps")
	}
	if reflect.DeepEqual(a[0].Scenario.FloodZones, c[0].Scenario.FloodZones) {
		t.Fatal("different seeds did not change synthetic flood foci")
	}
	if a[11].Turn != 12 || a[11].Scenario.EvacuationMetrics.SimulationTotalDuration != 12 {
		t.Fatal("configured flood simulation did not finish")
	}
}

func TestUrbanFloodAvenueClosureReplansAndReopeningRecovers(t *testing.T) {
	cfg := floodConfig("preventive", 8)
	cfg.Events = []simulation.ScheduledEvent{
		{Turn: 2, EdgeID: "BE", Blocked: true, Type: "synthetic_avenue_close"},
		{Turn: 3, EdgeID: "BE", Blocked: false, Type: "synthetic_avenue_reopen"},
	}
	app := newFloodApp(t, floodFixture(), cfg)
	if got := floodStep(t, app).Survivors[0].CurrentNode; got != "B" {
		t.Fatalf("expected initial avenue route, got %s", got)
	}
	closed := floodStep(t, app)
	if closed.Survivors[0].CurrentNode != "A" || !slices.Contains(closed.BlockedEdges, "BE") || closed.Scenario.EvacuationMetrics.RerouteCount < 1 {
		t.Fatalf("closed avenue did not trigger a legal alternative: %+v", closed.Survivors[0])
	}
	for _, road := range closed.Scenario.RoadConditions {
		if road.EdgeID == "BE" && (road.State != "blocked" || road.RiskSource != "external_event" || road.UpdatedAtSimulationStep != 2) {
			t.Fatalf("explicit closure lost its provenance: %+v", road)
		}
	}
	reopened := floodStep(t, app)
	if reopened.Survivors[0].CurrentNode != "B" || slices.Contains(reopened.BlockedEdges, "BE") {
		t.Fatal("reopened avenue was not available to routing")
	}
	if final := floodStep(t, app); final.Metrics.Evacuated != 1 || final.Scenario.EvacuationMetrics.EvacuatedAgents != 1 {
		t.Fatal("agent did not reach its shelter after replanning")
	}
}

func TestUrbanFloodNoRouteIsIsolationAndCanRecover(t *testing.T) {
	cfg := floodConfig("preventive", 8)
	cfg.Events = []simulation.ScheduledEvent{
		{Turn: 1, EdgeID: "AB", Blocked: true}, {Turn: 1, EdgeID: "AC", Blocked: true},
		{Turn: 3, EdgeID: "AB", Blocked: false},
	}
	app := newFloodApp(t, floodFixture(), cfg)
	for i := 0; i < 2; i++ {
		w := floodStep(t, app)
		if w.Survivors[0].CurrentNode != "A" || w.Survivors[0].Status != world.Active || w.Scenario.Agents[0].State != "isolated" || w.Scenario.EvacuationMetrics.IsolatedAgents != 1 {
			t.Fatal("absence of a safe route must isolate a living agent")
		}
	}
	if w := floodStep(t, app); w.Survivors[0].CurrentNode != "B" || w.Scenario.EvacuationMetrics.IsolatedAgents != 0 {
		t.Fatal("agent did not recover when access reopened")
	}
	if floodStep(t, app).Metrics.Evacuated != 1 {
		t.Fatal("recovered agent did not evacuate")
	}
}

func TestUrbanFloodPreventiveLateAndAdaptiveBehavior(t *testing.T) {
	firstMove := map[string]int{}
	for _, behavior := range []string{"preventive", "late", "adaptive"} {
		app := newFloodApp(t, floodFixture(), floodConfig(behavior, 20))
		for step := 1; step <= 20; step++ {
			w := floodStep(t, app)
			if firstMove[behavior] == 0 && w.Survivors[0].CurrentNode != "A" {
				firstMove[behavior] = step
			}
			if step == 1 && behavior != "preventive" && (w.Scenario.Agents[0].State != "waiting" || w.Scenario.EvacuationMetrics.WaitingAgents != 1 || w.Shelters[0].Reserved != 0) {
				t.Fatalf("%s did not publish deliberate waiting without a reservation", behavior)
			}
			if step == 20 && (w.Metrics.Evacuated != 1 || w.Scenario.Agents[0].EvacuationTime <= 0 || w.Scenario.EvacuationMetrics.AverageEvacuationTime != w.Scenario.Agents[0].EvacuationTime) {
				t.Fatalf("%s did not finish with a measured simulated evacuation time", behavior)
			}
		}
	}
	if firstMove["preventive"] != 1 || firstMove["adaptive"] <= firstMove["preventive"] || firstMove["late"] <= firstMove["adaptive"] {
		t.Fatalf("behavior did not change evacuation timing: %v", firstMove)
	}
}

func TestUrbanFloodExposedShelterReleasesReservationsAndRespectsSaturation(t *testing.T) {
	g := floodFixture()
	for i, node := range []string{"E", "F", "D", "C"} {
		g.Shelters[i].NodeID, g.Shelters[i].Capacity = node, 1
	}
	cfg := floodConfig("preventive", 8)
	cfg.InitialSurvivors = nil
	for i := 1; i <= 4; i++ {
		cfg.InitialSurvivors = append(cfg.InitialSurvivors, world.Survivor{ID: fmt.Sprintf("S%d", i), CurrentNode: "A", Status: world.Active})
	}
	cfg.Flood.RainfallProfile, cfg.Flood.RainfallIntensity = "constant", 1
	cfg.Flood.FloodGrowthRate, cfg.Flood.DrainageFactor = 1, 0
	cfg.Flood.Zones = []flood.ZoneConfig{{ID: "shelter-exposure", CenterNode: "C", RadiusMinM: 25, RadiusMaxM: 25}}
	app := newFloodApp(t, g, cfg)
	initial := app.Simulator.Snapshot()
	previous := ""
	for _, s := range initial.Survivors {
		if s.TargetShelterID == "H4" {
			previous = s.ID
		}
	}
	if previous == "" || initial.Shelters[3].Reserved != 1 {
		t.Fatal("fixture did not establish the initial H4 reservation")
	}
	changed := floodStep(t, app)
	if !world.ShelterUnavailable(changed, "H4") || changed.Shelters[3].Reserved != 0 {
		t.Fatal("flood-exposed shelter kept its reservation")
	}
	for _, agent := range changed.Survivors {
		if agent.ID == previous && agent.TargetShelterID == "H4" {
			t.Fatal("agent retained an exposed destination")
		}
	}
	for i := 1; i < 8; i++ {
		changed = floodStep(t, app)
	}
	if changed.Metrics.Evacuated != 3 || changed.Metrics.Active != 1 || changed.Scenario.EvacuationMetrics.IsolatedAgents != 1 || changed.Scenario.EvacuationMetrics.SheltersAtCapacity != 3 {
		t.Fatalf("saturation or alternative shelter assignment failed: %+v, %+v", changed.Metrics, changed.Scenario.EvacuationMetrics)
	}
	if changed.Shelters[3].Occupancy != 0 || changed.Scenario.EvacuationMetrics.RerouteCount == 0 {
		t.Fatal("exposed shelter admitted an agent or reassignment was not measured")
	}
}

func TestUrbanFloodConcurrentPollingAndOriginalGraphIntegrity(t *testing.T) {
	g := floodFixture()
	before, _ := json.Marshal(g)
	cfg := floodConfig("preventive", 12)
	cfg.Flood.RainfallIntensity = .8
	app := newFloodApp(t, g, cfg)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	errors := make(chan error, 4)
	var readers sync.WaitGroup
	for i := 0; i < 4; i++ {
		readers.Add(1)
		go func() {
			defer readers.Done()
			client := &http.Client{Timeout: 2 * time.Second}
			for ctx.Err() == nil {
				for _, path := range []string{"/estado", "/grafo", "/v1/scenario"} {
					response, err := client.Get(app.BaseURL + path)
					if err != nil {
						errors <- err
						return
					}
					var value map[string]any
					err = json.NewDecoder(response.Body).Decode(&value)
					response.Body.Close()
					if err != nil || response.StatusCode != http.StatusOK {
						errors <- fmt.Errorf("poll %s: HTTP %d, %v", path, response.StatusCode, err)
						return
					}
				}
			}
		}()
	}
	for step := 0; step < 12; step++ {
		floodStep(t, app)
	}
	cancel()
	readers.Wait()
	close(errors)
	for err := range errors {
		t.Error(err)
	}
	after, _ := json.Marshal(g)
	if string(before) != string(after) {
		t.Fatal("flood overlay mutated the original graph")
	}
	w := app.Simulator.Snapshot()
	w.Scenario.Agents[0].CurrentNode = "malicious mutation"
	if app.Simulator.Snapshot().Scenario.Agents[0].CurrentNode == "malicious mutation" {
		t.Fatal("polling snapshot shares mutable scenario storage")
	}
}

func TestUrbanFloodDispatchRejectsZombieThreatsAndPreservesLegacyDefault(t *testing.T) {
	for _, mutate := range []func(*simulation.Config){
		func(c *simulation.Config) { c.Walkers = 1 },
		func(c *simulation.Config) {
			c.InitialZombies = []world.Zombie{{ID: "Z1", Type: world.Walker, CurrentNode: "A"}}
		},
		func(c *simulation.Config) { c.ScenarioType = "earthquake" },
		func(c *simulation.Config) { c.ScenarioType = "tsunami" },
		func(c *simulation.Config) { c.ScenarioType = "zombie" },
	} {
		cfg := floodConfig("preventive", 8)
		mutate(&cfg)
		app, err := application.New(floodFixture(), cfg, "127.0.0.1:0", "test-only-key", nil, nil)
		if err == nil {
			app.Close()
			t.Fatal("accepted incompatible or unimplemented scenario configuration")
		}
	}
	var worlds []world.WorldSnapshot
	for _, kind := range []string{"", "zombie"} {
		cfg := simulation.Config{ScenarioType: kind, Seed: 91, Turns: 4, Survivors: 2}
		app := newFloodApp(t, floodFixture(), cfg)
		response, err := http.Get(app.BaseURL + "/v1/scenario")
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != http.StatusNotFound {
			t.Fatal("zombie unexpectedly served flood state")
		}
		if err := app.Simulator.Run(context.Background(), 4, 0); err != nil {
			t.Fatal(err)
		}
		w := app.Simulator.Snapshot()
		if w.ScenarioType != "" || w.Scenario != nil {
			t.Fatal("default zombie snapshot gained flood-specific data")
		}
		worlds = append(worlds, deterministicFloodState(w))
	}
	if !reflect.DeepEqual(worlds[0], worlds[1]) {
		t.Fatal("explicit zombie scenario changed the historical default")
	}
}

func TestUrbanFloodReviewedOfficialAndMasterGraphsComplete(t *testing.T) {
	for _, preset := range []struct {
		name, file string
		nodes      int
	}{{"competition", "manta-v2.json", 300}, {"master", "manta-master.json", 9179}} {
		t.Run(preset.name, func(t *testing.T) {
			g, err := graph.Load("../../data/" + preset.file)
			if err != nil {
				t.Fatal(err)
			}
			if len(g.Nodes) != preset.nodes {
				t.Fatal("reviewed graph identity changed")
			}
			cfg := floodConfig("preventive", 3)
			cfg.InitialSurvivors, cfg.Survivors = nil, 3
			app := newFloodApp(t, g, cfg)
			for i := 0; i < 3; i++ {
				floodStep(t, app)
			}
			w := app.Simulator.Snapshot()
			if w.Turn != 3 || w.Scenario.SimulationDuration != 3 || w.Scenario.EvacuationMetrics.TotalAgents != 3 {
				t.Fatal("reviewed graph did not finish its complete configured scenario")
			}
		})
	}
}

func TestUrbanFloodFullStormChangesRoutesAndDrainsOnOfficialGraph(t *testing.T) {
	g, err := graph.Load("../../data/manta-v2.json")
	if err != nil {
		t.Fatal(err)
	}
	cfg, err := simulation.LoadConfig("../../scenarios/flood/urban-storm-stress.json")
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Flood == nil || cfg.Flood.SimulationDuration != 150 || cfg.Flood.TimeStep != 1 || cfg.Survivors != 80 || len(g.Nodes) != 300 {
		t.Fatal("reviewed full-storm scenario or official graph identity changed")
	}
	before, err := json.Marshal(g)
	if err != nil {
		t.Fatal(err)
	}
	app := newFloodApp(t, g, cfg)
	peakBlocked, peakCaution := 0, 0
	previouslyBlocked := map[string]bool{}
	reopened := false
	var final world.WorldSnapshot
	for step := 1; step <= 150; step++ {
		// application.New uses the real authenticated loopback /paso client;
		// reading its immutable store adds no extra public polling workload.
		if err := app.Simulator.Step(context.Background()); err != nil {
			t.Fatalf("storm step %d: %v", step, err)
		}
		final = app.Simulator.Snapshot()
		if final.Scenario == nil || final.Turn != step {
			t.Fatal("storm did not publish the expected scenario step")
		}
		metrics := final.Scenario.EvacuationMetrics
		peakBlocked = max(peakBlocked, metrics.BlockedEdges)
		peakCaution = max(peakCaution, metrics.CautionEdges)
		for _, road := range final.Scenario.RoadConditions {
			if road.State == "blocked" {
				previouslyBlocked[road.EdgeID] = true
			} else if road.State == "passable" && previouslyBlocked[road.EdgeID] {
				reopened = true
			}
		}
		if final.Metrics.Bitten != 0 || len(final.Zombies) != 0 || final.Metrics.RequestsInvalid != 0 || final.Metrics.RequestsTimeout != 0 {
			t.Fatalf("storm produced zombie outcomes or failed real HTTP at step %d: %+v", step, final.Metrics)
		}
		for _, shelter := range final.Shelters {
			if shelter.Occupancy < 0 || shelter.Reserved < 0 || shelter.Available < 0 || shelter.Occupancy+shelter.Reserved+shelter.Available != shelter.Capacity {
				t.Fatalf("storm violated shelter capacity at step %d: %+v", step, shelter)
			}
		}
	}
	metrics := final.Scenario.EvacuationMetrics
	if peakBlocked == 0 || peakCaution == 0 || metrics.RerouteCount == 0 || !reopened {
		t.Fatalf("storm did not exercise dynamic risk and replanning: peak blocked=%d, caution=%d, reroutes=%d, reopened=%v", peakBlocked, peakCaution, metrics.RerouteCount, reopened)
	}
	if metrics.BlockedEdges != 0 || metrics.CautionEdges != 0 || len(final.BlockedEdges) != 0 {
		t.Fatal("streets remained restricted after the synthetic storm drained")
	}
	if final.Metrics.Evacuated != 80 || final.Metrics.Active != 0 || metrics.EvacuatedAgents != 80 || metrics.TotalAgents != 80 || metrics.SimulationTotalDuration != 150 || final.Metrics.RequestsSuccess == 0 {
		t.Fatalf("full storm did not finish with all 80 agents evacuated: %+v, %+v", final.Metrics, metrics)
	}
	after, err := json.Marshal(g)
	if err != nil {
		t.Fatal(err)
	}
	if string(before) != string(after) || !reflect.DeepEqual(g.Nodes, final.Graph.Nodes) || !reflect.DeepEqual(g.Edges, final.Graph.Edges) {
		t.Fatal("full storm changed the static official graph")
	}
}
