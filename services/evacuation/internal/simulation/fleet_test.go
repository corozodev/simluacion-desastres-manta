package simulation

import (
	"context"
	"reflect"
	"testing"

	"corodev/evacuation/internal/coordination"
	decisionengine "corodev/evacuation/internal/decision"
	"corodev/evacuation/internal/world"
)

func checkFleetConservation(t *testing.T, s *Simulator, w world.WorldSnapshot) {
	t.Helper()
	if len(w.Fleet) != 5 {
		t.Fatalf("fleet size: %d", len(w.Fleet))
	}
	passengers := map[string]bool{}
	for _, v := range w.Fleet {
		if v.Capacity != 4 || len(v.PassengerIDs) > 4 || len(v.Path) > 3 || len(v.Path) == 0 || v.Path[len(v.Path)-1] != v.CurrentNode {
			t.Fatalf("invalid vehicle: %+v", v)
		}
		for i := 1; i < len(v.Path); i++ {
			if !s.index.CanMove(v.Path[i-1], v.Path[i], s.blocked) {
				t.Fatal("vehicle teleported or crossed closure")
			}
		}
		for _, id := range v.PassengerIDs {
			if passengers[id] {
				t.Fatal("duplicate passenger")
			}
			passengers[id] = true
			found := false
			for _, p := range w.Survivors {
				if p.ID == id {
					found = true
					if p.VehicleID != v.ID || p.CurrentNode != v.CurrentNode || p.Status != world.Active {
						t.Fatalf("passenger mismatch: %+v", p)
					}
				}
			}
			if !found {
				t.Fatal("unknown passenger")
			}
		}
	}
	for _, p := range w.Survivors {
		if (p.VehicleID != "") != passengers[p.ID] {
			t.Fatal("passenger ownership differs")
		}
	}
	for _, sh := range w.Shelters {
		if sh.Occupancy+sh.Reserved > sh.Capacity || sh.Reserved < 0 || sh.Available < 0 {
			t.Fatalf("overassigned shelter: %+v", sh)
		}
	}
	if w.Metrics.Active+w.Metrics.Bitten+w.Metrics.Evacuated != len(w.Survivors) {
		t.Fatal("agents not conserved")
	}
}

func TestFleetCapacityDeliveryAndPassengerConservation(t *testing.T) {
	g := chain(10)
	g.Shelters[0].Capacity = 5
	people := []world.Survivor{}
	for _, id := range []string{"A1", "A2", "A3", "A4", "A5", "A6"} {
		people = append(people, survivor(id, "A"))
	}
	s := create(t, g, Config{RescueFleet: true, InitialSurvivors: people}, decisionFunc(stay))
	for i := range s.fleet {
		s.fleet[i].CurrentNode = "A"
	}
	for turn := 1; turn <= 5; turn++ {
		w := step(t, s)
		checkFleetConservation(t, s, w)
		if turn == 1 {
			if len(w.Fleet[0].PassengerIDs) != 4 || len(w.Fleet[1].PassengerIDs) != 1 || w.Metrics.Evacuated != 0 || w.Shelters[0].Reserved != 5 {
				t.Fatalf("pickup capacity/early evacuation: %+v", w)
			}
			if w.Metrics.RequestsSuccess != 1 {
				t.Fatal("passengers received foot HTTP decisions")
			}
		}
		if turn == 5 {
			if w.Metrics.Evacuated != 5 || w.Metrics.Active != 1 || w.FleetMetrics.Delivered != 5 || w.FleetMetrics.UsefulTrips != 2 || w.Shelters[0].Reserved != 0 {
				t.Fatalf("delivery not conserved: %+v", w)
			}
		}
	}
}

func TestFleetReplansBlocksAndReleasesUnreachableReservation(t *testing.T) {
	s := create(t, chain(8), Config{RescueFleet: true, InitialSurvivors: []world.Survivor{survivor("S", "A")}, Events: []ScheduledEvent{{Turn: 2, EdgeID: "E3", Blocked: true}, {Turn: 3, EdgeID: "E3", Blocked: false}}}, decisionFunc(stay))
	s.fleet[0].CurrentNode = "A"
	w := step(t, s)
	if w.Survivors[0].CurrentNode != "C" || w.Survivors[0].VehicleID == "" {
		t.Fatal("pickup/movement missing")
	}
	w = step(t, s)
	checkFleetConservation(t, s, w)
	if w.Fleet[0].CurrentNode != "C" || len(w.Fleet[0].Path) != 1 || w.Fleet[0].State != "waiting" || w.Shelters[0].Reserved != 0 || w.Survivors[0].TargetShelterID != "" {
		t.Fatalf("closed route did not release: %+v", w.Fleet[0])
	}
	for turn := 3; turn <= 5; turn++ {
		w = step(t, s)
		checkFleetConservation(t, s, w)
	}
	if w.Metrics.Evacuated != 1 || w.FleetMetrics.Delivered != 1 {
		t.Fatal("did not resume after reopening")
	}
}

func TestFleetReassignsShelterAtomically(t *testing.T) {
	g := chain(10)
	g.Shelters = append(g.Shelters, world.Shelter{ID: "H2", NodeID: "A", Capacity: 1})
	p := survivor("S", "B")
	p.TargetShelterID = "H1"
	s := create(t, g, Config{RescueFleet: true, InitialSurvivors: []world.Survivor{p}, Events: []ScheduledEvent{{Turn: 2, EdgeID: "E8", Blocked: true}}}, decisionFunc(stay))
	s.fleet[0].CurrentNode = "B"
	w := step(t, s)
	if w.Survivors[0].TargetShelterID != "H1" {
		t.Fatal("preferred assignment not retained")
	}
	w = step(t, s)
	checkFleetConservation(t, s, w)
	if w.Survivors[0].TargetShelterID != "H2" || w.Shelters[0].Reserved != 0 || w.Shelters[1].Reserved != 1 {
		t.Fatal("reservation not reassigned atomically")
	}
	w = step(t, s)
	if w.Survivors[0].Status != world.Evacuated || w.Survivors[0].CurrentNode != "A" {
		t.Fatal("alternate shelter delivery failed")
	}
}

func TestFleetNoRouteHordeAndDeadTargets(t *testing.T) {
	s := create(t, chain(10), Config{RescueFleet: true, InitialSurvivors: []world.Survivor{survivor("S", "A")}, InitialZombies: []world.Zombie{zombie(world.Horde, "F")}}, decisionFunc(stay))
	w := step(t, s)
	for _, v := range w.Fleet {
		if v.CurrentNode != "J" || len(v.Path) != 1 || v.TargetSurvivorID != "" {
			t.Fatal("truck selected impossible horde route")
		}
	}
	s = create(t, chain(10), Config{RescueFleet: true, InitialSurvivors: []world.Survivor{survivor("S", "A")}}, decisionFunc(stay))
	s.fleet[0].TargetSurvivorID = "S"
	s.fleet[0].TargetShelterID = "H1"
	s.survivors[0].Status = world.Bitten
	w = step(t, s)
	if w.Fleet[0].TargetSurvivorID != "" || len(w.Fleet[0].Path) != 1 || w.FleetMetrics.Pickups != 0 {
		t.Fatal("truck pursued dead target")
	}
}

func TestFleetAvoidsUnnecessaryDepotRoundTrip(t *testing.T) {
	s := create(t, chain(10), Config{RescueFleet: true, InitialSurvivors: []world.Survivor{survivor("S", "A")}}, decisionFunc(stay))
	w := step(t, s)
	for _, v := range w.Fleet {
		if v.CurrentNode != "J" || len(v.Path) != 1 || v.TargetSurvivorID != "" {
			t.Fatal("unthreatened depot round trip has no positive time saving")
		}
	}
}

func TestFleetPassengersRemainExposedToNodeAndOppositeCrossings(t *testing.T) {
	for _, test := range []struct {
		from, to  string
		path      []string
		mechanism string
	}{{"B", "C", []string{"C"}, "same_node"}, {"B", "C", []string{"C", "B"}, "opposite_edge"}} {
		s := create(t, chain(6), Config{RescueFleet: true, InitialSurvivors: []world.Survivor{survivor("S", test.from)}}, decisionFunc(stay))
		v := &s.fleet[0]
		v.CurrentNode = test.from
		v.PassengerIDs = []string{"S"}
		v.TargetShelterID = "H1"
		s.survivors[0].VehicleID = v.ID
		s.survivors[0].TargetShelterID = "H1"
		s.zombies = []zombieState{{observable: world.Zombie{ID: "Z", Type: world.Runner, Awake: true, CurrentNode: test.path[len(test.path)-1], Path: test.path}}}
		events := []world.Event{}
		s.fleetPassengerStep(v, test.from, test.to, &events)
		s.reconcileReservations()
		if s.survivors[0].Status != world.Bitten || s.survivors[0].VehicleID != "" || len(v.PassengerIDs) != 0 || s.shelters[0].Reserved != 0 || s.diagnostic.bites[0].Mechanism != test.mechanism {
			t.Fatal("passenger gained collision immunity")
		}
	}
}

func TestFleetAdmissionNeverPrecedesSameNodeBite(t *testing.T) {
	s := create(t, chain(6), Config{RescueFleet: true, InitialSurvivors: []world.Survivor{survivor("S", "F")}}, decisionFunc(stay))
	v := &s.fleet[0]
	v.PassengerIDs = []string{"S"}
	v.TargetShelterID = "H1"
	s.survivors[0].VehicleID = v.ID
	s.survivors[0].TargetShelterID = "H1"
	s.zombies = []zombieState{{observable: world.Zombie{ID: "Z", Type: world.Walker, Awake: true, CurrentNode: "F", Path: []string{"E", "F"}}}}
	events := []world.Event{}
	if s.fleetDeliver(v, &events) || s.survivors[0].Status != world.Bitten || s.shelters[0].Occupancy != 0 || s.fleetMetrics.Delivered != 0 {
		t.Fatal("vehicle admission bypassed node collision")
	}
}

func TestFleetPlannerSeatsAndReproducibility(t *testing.T) {
	g := chain(9)
	g.Shelters[0].Capacity = 2
	cfg := Config{Seed: 42, RescueFleet: true, InitialSurvivors: []world.Survivor{survivor("A", "A"), survivor("B", "B"), survivor("C", "C")}}
	build := func() *Simulator {
		s := create(t, g, cfg, decisionFunc(stay))
		s.fleet[0].CurrentNode = "A"
		engine := decisionengine.New()
		s.SetPlanner(coordination.New(engine, coordination.Options{}))
		return s
	}
	a, b := build(), build()
	for turn := 0; turn < 8; turn++ {
		wa, wb := step(t, a), step(t, b)
		checkFleetConservation(t, a, wa)
		wa.Metrics = world.Metrics{}
		wb.Metrics = world.Metrics{}
		if !reflect.DeepEqual(wa, wb) {
			t.Fatal("fleet world differs for same configuration and seed")
		}
	}
	if err := a.Step(context.Background()); err != nil {
		t.Fatal(err)
	}
}
