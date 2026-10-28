package simulation

import (
	"context"
	"errors"
	"testing"

	"corodev/evacuation/internal/world"
)

func TestObservableImmobilityReasons(t *testing.T) {
	for _, tc := range []struct {
		name, want string
		change     func(*world.Graph, *Config)
		client     decisionFunc
	}{
		{name: "wait with route", want: "wait_with_route"},
		{name: "closures", want: "blocked_route", change: func(_ *world.Graph, c *Config) { c.Events = []ScheduledEvent{{Turn: 1, EdgeID: "E2", Blocked: true}} }},
		{name: "capacity", want: "shelter_full", change: func(g *world.Graph, _ *Config) { g.Shelters[0].Occupancy = g.Shelters[0].Capacity }},
		{name: "visible threat", want: "visible_threat_route", change: func(_ *world.Graph, c *Config) { c.InitialZombies = []world.Zombie{zombie(world.Horde, "C")} }},
		{name: "hidden sleeper does not explain wait", want: "wait_with_route", change: func(_ *world.Graph, c *Config) { c.InitialZombies = []world.Zombie{zombie(world.Sleeper, "D")} }},
		{name: "invalid edge", want: "invalid_movement", client: func(context.Context, world.StepRequest) (world.StepResponse, error) {
			return world.StepResponse{NextNode: "C"}, nil
		}},
		{name: "http error", want: "decision_error", client: func(context.Context, world.StepRequest) (world.StepResponse, error) {
			return world.StepResponse{}, errors.New("transport failed")
		}},
		{name: "timeout", want: "timeout", client: func(context.Context, world.StepRequest) (world.StepResponse, error) {
			return world.StepResponse{}, context.DeadlineExceeded
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			g := chain(4)
			cfg := Config{InitialSurvivors: []world.Survivor{survivor("S", "A")}}
			if tc.change != nil {
				tc.change(g, &cfg)
			}
			client := tc.client
			if client == nil {
				client = stay
			}
			s := create(t, g, cfg, client)
			w := step(t, s)
			v := w.Survivors[0]
			if v.CurrentNode != "A" || v.StationaryTurns != 1 || v.ImmobilityReason != tc.want {
				t.Fatalf("unexpected observable wait: %+v", v)
			}
			if tc.name == "hidden sleeper does not explain wait" && len(w.Zombies) != 0 {
				t.Fatal("dormant sleeper leaked")
			}
		})
	}
}

func TestStationaryTurnsAreConsecutiveAndFreezeAfterEvacuation(t *testing.T) {
	s := create(t, chain(2), Config{InitialSurvivors: []world.Survivor{survivor("S", "A")}}, decisionFunc(func(_ context.Context, r world.StepRequest) (world.StepResponse, error) {
		if r.Turn == 3 {
			return world.StepResponse{NextNode: "B"}, nil
		}
		return world.StepResponse{NextNode: r.CurrentNode}, nil
	}))
	for turn := 1; turn <= 4; turn++ {
		v := step(t, s).Survivors[0]
		want := turn
		if turn >= 3 {
			want = 0
		}
		if v.StationaryTurns != want || turn >= 3 && v.ImmobilityReason != "" {
			t.Fatalf("turn %d: %+v", turn, v)
		}
	}
}

func TestStationaryPassengerCountedOncePerTurn(t *testing.T) {
	s := create(t, chain(8), Config{RescueFleet: true, InitialSurvivors: []world.Survivor{survivor("S", "A")}, Events: []ScheduledEvent{{Turn: 2, EdgeID: "E3", Blocked: true}}}, decisionFunc(stay))
	s.fleet[0].CurrentNode = "A"
	if v := step(t, s).Survivors[0]; v.StationaryTurns != 0 || v.ImmobilityReason != "" {
		t.Fatalf("moving passenger was labeled stationary: %+v", v)
	}
	w := step(t, s)
	if v := w.Survivors[0]; v.StationaryTurns != 1 || v.ImmobilityReason != "aboard" || v.VehicleID == "" {
		t.Fatalf("stationary passenger count: %+v", v)
	}
	if w.Fleet[0].WaitReason != "no_available_safe_shelter" {
		t.Fatalf("missing vehicle wait cause: %+v", w.Fleet[0])
	}
}
