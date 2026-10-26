package simulation

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"

	"corodev/evacuation/internal/world"
)

type plannerFunc func(context.Context, world.WorldSnapshot) world.WorldSnapshot

func (f plannerFunc) Prepare(ctx context.Context, w world.WorldSnapshot) world.WorldSnapshot {
	return f(ctx, w)
}

func zoneGraph() *world.Graph {
	g := chain(40)
	for i, id := range []string{"tarqui", "los-esteros", "barbasquillo", "jocay"} {
		n := g.Nodes[i*2]
		delta := .0001
		g.SpawnZones = append(g.SpawnZones, world.SpawnZone{ID: id, Name: id, Source: "synthetic unit-test polygon", Weight: 1, NodeIDs: []string{n.ID}, Geometry: []world.GeoPoint{{Lat: n.Lat - delta, Lng: n.Lng - delta}, {Lat: n.Lat + delta, Lng: n.Lng - delta}, {Lat: n.Lat + delta, Lng: n.Lng + delta}, {Lat: n.Lat - delta, Lng: n.Lng + delta}, {Lat: n.Lat - delta, Lng: n.Lng - delta}}})
	}
	return g
}

func TestSpawnZonesBalancedReproducibleAndZombiesAcrossNetwork(t *testing.T) {
	cfg := Config{Seed: 2026, UseSpawnZones: true, Survivors: 20, Walkers: 3, Hordes: 2, Sleepers: 2}
	a, b := create(t, zoneGraph(), cfg, decisionFunc(stay)), create(t, zoneGraph(), cfg, decisionFunc(stay))
	wa, wb := a.Snapshot(), b.Snapshot()
	if !reflect.DeepEqual(wa, wb) {
		t.Fatal("zone spawns are not deterministic")
	}
	counts := map[string]int{}
	occupied := map[string]bool{}
	for _, v := range wa.Survivors {
		counts[v.SpawnZoneID]++
		occupied[v.CurrentNode] = true
	}
	if len(counts) != 4 {
		t.Fatalf("missing zone: %v", counts)
	}
	for _, count := range counts {
		if count != 5 {
			t.Fatalf("unbalanced defaults: %v", counts)
		}
	}
	outside := false
	for _, z := range a.zombies {
		if occupied[z.observable.CurrentNode] {
			t.Fatal("new urban initialization overlaps survivor/zombie")
		}
		if z.observable.Type == world.Horde {
			for _, n := range a.proximity[z.observable.CurrentNode] {
				if occupied[n] {
					t.Fatal("horde starts beside a survivor")
				}
			}
		}
		if z.observable.CurrentNode > "G" {
			outside = true
		}
	}
	if !outside {
		t.Fatal("zombies were restricted to spawn zones")
	}
	if len(wa.Zombies) != 5 {
		t.Fatal("dormant sleepers leaked")
	}
}

func TestSpawnWeightsAndInvalidZoneInputs(t *testing.T) {
	cfg := Config{Seed: 1, UseSpawnZones: true, Survivors: 20, SpawnZoneWeights: []ZoneWeight{{ZoneID: "tarqui", Weight: 1}, {ZoneID: "los-esteros", Weight: 3}, {ZoneID: "barbasquillo", Weight: 0}, {ZoneID: "jocay", Weight: 0}}}
	s := create(t, zoneGraph(), cfg, decisionFunc(stay))
	counts := map[string]int{}
	for _, v := range s.Snapshot().Survivors {
		counts[v.SpawnZoneID]++
	}
	if counts["tarqui"] != 5 || counts["los-esteros"] != 15 {
		t.Fatal(counts)
	}
	for _, change := range []func(*world.Graph, *Config){
		func(g *world.Graph, cfg *Config) { g.SpawnZones = nil },
		func(g *world.Graph, cfg *Config) { g.SpawnZones[0].NodeIDs = []string{"missing"} },
		func(g *world.Graph, cfg *Config) { g.SpawnZones[0].NodeIDs = []string{"Z"} },
		func(g *world.Graph, cfg *Config) { cfg.SpawnZoneWeights = []ZoneWeight{{ZoneID: "unknown", Weight: 1}} },
	} {
		g := zoneGraph()
		c := Config{UseSpawnZones: true, Survivors: 1}
		change(g, &c)
		if _, err := New(g, world.NewStore(), c, decisionFunc(stay)); err == nil {
			t.Fatal("invalid zones accepted")
		}
	}
}

func TestExplicitReplayPreservesLegacyRandomState(t *testing.T) {
	cfg := Config{Seed: 11, Survivors: 20, Walkers: 2, Runners: 1, Sleepers: 1}
	original := create(t, chain(20), cfg, decisionFunc(stay))
	replayCfg := cfg
	replayCfg.InitialSurvivors = original.Snapshot().Survivors
	replayCfg.InitialZombies = []world.Zombie{}
	for _, z := range original.zombies {
		replayCfg.InitialZombies = append(replayCfg.InitialZombies, z.observable)
	}
	replayCfg.InitialRandomNodeCount = 19
	replay := create(t, chain(20), replayCfg, decisionFunc(stay))
	for i := 0; i < 10; i++ {
		a, b := step(t, original), step(t, replay)
		a.Metrics.HTTPP50MS, a.Metrics.HTTPP95MS, a.Metrics.HTTPP99MS = 0, 0, 0
		b.Metrics.HTTPP50MS, b.Metrics.HTTPP95MS, b.Metrics.HTTPP99MS = 0, 0, 0
		if !reflect.DeepEqual(a, b) {
			t.Fatalf("explicit replay changed PRNG state on turn%d", i+1)
		}
	}
}

func TestPlannerOnlyCopiesAssignmentsAndReleasesDeadReservations(t *testing.T) {
	g := chain(4)
	s := create(t, g, Config{InitialSurvivors: []world.Survivor{survivor("S1", "B")}, InitialZombies: []world.Zombie{zombie(world.Walker, "C")}}, decisionFunc(func(context.Context, world.StepRequest) (world.StepResponse, error) {
		return world.StepResponse{NextNode: "C"}, nil
	}))
	s.SetPlanner(plannerFunc(func(_ context.Context, w world.WorldSnapshot) world.WorldSnapshot {
		w.Survivors[0].TargetShelterID = "H1"
		w.Survivors[0].PlannedRoute = []string{"B", "C", "D"}
		w.Survivors[0].CurrentNode = "D"
		w.Survivors[0].Status = world.Evacuated
		w.Shelters[0].Capacity = 999
		w.Shelters[0].Occupancy = 100
		return w
	}))
	initial := s.Snapshot()
	if initial.Survivors[0].CurrentNode != "B" || initial.Survivors[0].Status != world.Active || initial.Shelters[0].Occupancy != 0 || initial.Shelters[0].Capacity != 300 || initial.Shelters[0].Reserved != 1 {
		t.Fatalf("planner mutated authoritative state: %+v", initial)
	}
	w := step(t, s)
	if w.Survivors[0].Status != world.Bitten || w.Shelters[0].Reserved != 0 || w.Survivors[0].TargetShelterID != "" {
		t.Fatal("dead survivor retained reservation")
	}
	d := s.Diagnostics()
	if len(d.Bites) != 1 || d.Bites[0].ZombieType != world.Walker || d.Bites[0].Mechanism != "same_node" {
		t.Fatal("mechanism and zombie type must be separate")
	}
}

func TestPlannerCapacityAndRouteValidation(t *testing.T) {
	g := chain(3)
	g.Shelters[0].Capacity = 1
	s := create(t, g, Config{InitialSurvivors: []world.Survivor{survivor("S1", "A"), survivor("S2", "A")}}, decisionFunc(stay))
	s.SetPlanner(plannerFunc(func(_ context.Context, w world.WorldSnapshot) world.WorldSnapshot {
		for i := range w.Survivors {
			w.Survivors[i].TargetShelterID = "H1"
			w.Survivors[i].PlannedRoute = []string{"A", "B", "C"}
		}
		return w
	}))
	w := s.Snapshot()
	if w.Shelters[0].Reserved != 1 || w.Shelters[0].Available != 0 || w.Survivors[1].TargetShelterID != "" {
		t.Fatal("planner over-reserved shelter")
	}
	s.SetPlanner(plannerFunc(func(_ context.Context, w world.WorldSnapshot) world.WorldSnapshot {
		for i := range w.Survivors {
			w.Survivors[i].TargetShelterID = "H1"
			w.Survivors[i].PlannedRoute = []string{"A", "C"}
		}
		return w
	}))
	if s.Snapshot().Shelters[0].Reserved != 0 {
		t.Fatal("nonadjacent route accepted")
	}
}

func TestDiagnosticsSeparateBlockThreatAndPrivateInitialPositions(t *testing.T) {
	s := create(t, chain(5), Config{InitialSurvivors: []world.Survivor{survivor("S1", "A")}, InitialZombies: []world.Zombie{zombie(world.Sleeper, "E")}, Events: []ScheduledEvent{{Turn: 1, EdgeID: "E1", Blocked: true}}}, decisionFunc(stay))
	w := step(t, s)
	d := s.Diagnostics()
	if len(w.Zombies) != 0 || len(d.InitialZombies) != 1 {
		t.Fatal("public and private initial states not separated")
	}
	if d.Summary.StationaryTurns != 1 || d.Failures["blocked_route"] != 1 || d.Survivors[0].BlockedRouteTurns != 1 || d.Survivors[0].InitialNearestShelterHops != 4 {
		t.Fatalf("wrong route diagnosis: %+v", d)
	}
	d.InitialSurvivors[0].NodeID = "mutated"
	d.Failures["blocked_route"] = 99
	if s.Diagnostics().InitialSurvivors[0].NodeID == "mutated" || s.Diagnostics().Failures["blocked_route"] != 1 {
		t.Fatal("diagnostics mutation leaked")
	}
	public, _ := json.Marshal(w)
	if len(public) == 0 {
		t.Fatal("invalid public snapshot")
	}
}

func TestUnassignedArrivalCannotConsumeAnotherSurvivorReservation(t *testing.T) {
	g := chain(3)
	g.Shelters[0].Capacity = 1
	s := create(t, g, Config{InitialSurvivors: []world.Survivor{survivor("S1", "B"), survivor("S2", "A")}}, decisionFunc(func(_ context.Context, r world.StepRequest) (world.StepResponse, error) {
		if r.SurvivorID == "S1" {
			return world.StepResponse{NextNode: "C"}, nil
		}
		return world.StepResponse{NextNode: r.CurrentNode}, nil
	}))
	s.SetPlanner(plannerFunc(func(_ context.Context, w world.WorldSnapshot) world.WorldSnapshot {
		w.Survivors[0].PlannedRoute = []string{"B"}
		w.Survivors[1].TargetShelterID = "H1"
		w.Survivors[1].PlannedRoute = []string{"A", "B", "C"}
		return w
	}))
	w := step(t, s)
	if w.Survivors[0].Status != world.Active || w.Shelters[0].Occupancy != 0 || w.Shelters[0].Reserved != 1 || w.Shelters[0].Available != 0 {
		t.Fatalf("unassigned arrival stole a reserved place: %+v", w.Shelters)
	}
}

func TestFinalDiagnosisUsesCapacityAfterTheLastAdmission(t *testing.T) {
	g := chain(3)
	g.Shelters[0].Capacity = 1
	s := create(t, g, Config{InitialSurvivors: []world.Survivor{survivor("S1", "B"), survivor("S2", "B")}}, decisionFunc(func(context.Context, world.StepRequest) (world.StepResponse, error) {
		return world.StepResponse{NextNode: "C"}, nil
	}))
	step(t, s)
	d := s.Diagnostics()
	if d.Survivors[0].Status != world.Evacuated || d.Survivors[1].Status != world.Active || d.Survivors[1].FinalFailure != "shelter_full" {
		t.Fatalf("final failure used stale pre-admission capacity: %+v", d.Survivors)
	}
	if d.Survivors[1].NoRouteTurns != 0 {
		t.Fatal("decision-phase diagnosis must retain the available pre-admission seat")
	}
}

func TestDiagnosticsSeparateUnoccupiedReservedAndAvailableCapacity(t *testing.T) {
	g := chain(3)
	g.Shelters[0].Capacity = 3
	s := create(t, g, Config{InitialSurvivors: []world.Survivor{survivor("S1", "A"), survivor("S2", "B")}}, decisionFunc(stay))
	s.SetPlanner(plannerFunc(func(_ context.Context, w world.WorldSnapshot) world.WorldSnapshot {
		for i := range w.Survivors {
			w.Survivors[i].TargetShelterID = "H1"
		}
		w.Survivors[0].PlannedRoute = []string{"A", "B", "C"}
		w.Survivors[1].PlannedRoute = []string{"B", "C"}
		return w
	}))
	d := s.Diagnostics()
	if d.Summary.ShelterUnoccupiedCapacity != 3 || d.Summary.ShelterReserved != 2 || d.Summary.ShelterCapacityAvailable != 1 {
		t.Fatalf("unoccupied, reserved and available seats were conflated: %+v", d.Summary)
	}
}
