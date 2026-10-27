package simulation

import (
	"context"
	"encoding/json"
	"math/rand"
	"reflect"
	"testing"

	"corodev/evacuation/internal/world"
)

func TestClassicPolicyPreservesOriginalRandomDraws(t *testing.T) {
	g := chain(8)
	s := create(t, g, Config{Seed: 714, InitialZombies: []world.Zombie{zombie(world.Runner, "D")}}, decisionFunc(stay))
	rng := rand.New(rand.NewSource(714))
	node := "D"
	for turn := 0; turn < 30; turn++ {
		for step := 0; step < 2; step++ {
			neighbors := s.index.Neighbors(node, s.blocked)
			node = neighbors[rng.Intn(len(neighbors))].To
		}
		w := step(t, s)
		if w.Zombies[0].CurrentNode != node {
			t.Fatalf("original RNG trajectory changed at %d", turn)
		}
	}
}

func TestPoliciesReproducibleAndRespectMovementInvariants(t *testing.T) {
	for _, policy := range []string{ClassicRandom, CorrelatedRandomWalk, AdaptiveExploration} {
		t.Run(policy, func(t *testing.T) {
			cfg := Config{Seed: 91, ZombiePolicy: policy, InitialZombies: []world.Zombie{
				{ID: "walker", Type: world.Walker, CurrentNode: "B"},
				{ID: "runner", Type: world.Runner, CurrentNode: "D"},
				{ID: "horde", Type: world.Horde, CurrentNode: "G"},
				{ID: "hidden", Type: world.Sleeper, CurrentNode: "A"},
			}, Events: []ScheduledEvent{{Turn: 3, EdgeID: "E3", Blocked: true}}}
			a := create(t, chain(8), cfg, decisionFunc(stay))
			b := create(t, chain(8), cfg, decisionFunc(stay))
			for turn := 1; turn <= 40; turn++ {
				wa, wb := step(t, a), step(t, b)
				if !reflect.DeepEqual(wa.Zombies, wb.Zombies) {
					t.Fatal("same seed differs")
				}
				for _, z := range wa.Zombies {
					limit := 1
					if z.Type == world.Runner {
						limit = 3
					}
					if z.Type == world.Walker && turn%2 == 0 {
						limit = 2
					}
					if z.Type == world.Sleeper {
						t.Fatal("hidden sleeper leaked")
					}
					if len(z.Path) > limit {
						t.Fatalf("movement limit: %+v", z)
					}
					for i := 1; i < len(z.Path); i++ {
						if !a.index.CanMove(z.Path[i-1], z.Path[i], a.blocked) {
							t.Fatal("illegal edge")
						}
					}
				}
				for _, state := range a.zombies {
					if len(state.memory.recent) > 16 {
						t.Fatal("unbounded memory")
					}
				}
			}
			encoded, _ := json.Marshal(a.Snapshot())
			var decoded map[string]any
			if err := json.Unmarshal(encoded, &decoded); err != nil {
				t.Fatal(err)
			}
			if _, exists := decoded["memory"]; exists {
				t.Fatal("private memory published")
			}
		})
	}
}

func TestPersistentPoliciesPermitDeadEndBacktracking(t *testing.T) {
	for _, policy := range []string{CorrelatedRandomWalk, AdaptiveExploration} {
		s := create(t, chain(2), Config{ZombiePolicy: policy, InitialZombies: []world.Zombie{zombie(world.Runner, "A")}}, decisionFunc(stay))
		for i := 0; i < 10; i++ {
			w := step(t, s)
			if !reflect.DeepEqual(w.Zombies[0].Path, []string{"A", "B", "A"}) {
				t.Fatal("dead end trapped agent")
			}
		}
	}
}

func TestPolicyConfigurationValidationAndFloodIsolation(t *testing.T) {
	for _, cfg := range []Config{{ZombiePolicy: "unknown"}, {ScenarioType: "urban_flood", ZombiePolicy: AdaptiveExploration}, {ScenarioType: "urban_flood", RescueFleet: true}} {
		if _, err := New(chain(3), world.NewStore(), cfg, decisionFunc(stay)); err == nil {
			t.Fatalf("accepted %+v", cfg)
		}
	}
	for _, policy := range []string{CorrelatedRandomWalk, AdaptiveExploration} {
		s := create(t, chain(6), Config{ZombiePolicy: policy, InitialSurvivors: []world.Survivor{survivor("S1", "D")}, InitialZombies: []world.Zombie{zombie(world.Runner, "A")}}, decisionFunc(stay))
		if err := s.Step(context.Background()); err != nil {
			t.Fatal(err)
		}
		if z := s.Snapshot().Zombies[0]; !reflect.DeepEqual(z.Path, []string{"A", "B", "C"}) || z.MovementState != "chasing" {
			t.Fatal("policy changed detection/pursuit")
		}
	}
}
