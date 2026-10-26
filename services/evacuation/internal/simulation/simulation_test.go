package simulation

import (
	"context"
	"fmt"
	"reflect"
	"sync/atomic"
	"testing"
	"time"

	"corodev/evacuation/internal/world"
)

type decisionFunc func(context.Context, world.StepRequest) (world.StepResponse, error)

func (f decisionFunc) NextStep(ctx context.Context, request world.StepRequest) (world.StepResponse, error) {
	return f(ctx, request)
}

func stay(_ context.Context, request world.StepRequest) (world.StepResponse, error) {
	return world.StepResponse{NextNode: request.CurrentNode}, nil
}

func chain(n int) *world.Graph {
	g := &world.Graph{Version: "synthetic-test-v1", Source: "synthetic test fixture", Nodes: []world.GraphNode{}, Edges: []world.GraphEdge{}, Shelters: []world.Shelter{}}
	for i := 0; i < n; i++ {
		g.Nodes = append(g.Nodes, world.GraphNode{ID: string(rune('A' + i)), Lat: 0, Lng: float64(i) / 1000})
		if i > 0 {
			g.Edges = append(g.Edges, world.GraphEdge{ID: fmt.Sprintf("E%d", i), From: string(rune('A' + i - 1)), To: string(rune('A' + i)), DistanceM: 100, SpeedMPS: 1.4, RoadType: "residential"})
		}
	}
	g.Shelters = append(g.Shelters, world.Shelter{ID: "H1", NodeID: string(rune('A' + n - 1)), Capacity: 300})
	return g
}

func survivor(id, node string) world.Survivor {
	return world.Survivor{ID: id, CurrentNode: node, Status: world.Active, PlannedRoute: []string{}}
}

func zombie(kind, node string) world.Zombie {
	return world.Zombie{ID: "Z1", Type: kind, CurrentNode: node, Awake: kind != world.Sleeper}
}

func create(t *testing.T, g *world.Graph, cfg Config, client DecisionClient) *Simulator {
	t.Helper()
	s, err := New(g, world.NewStore(), cfg, client)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func step(t *testing.T, s *Simulator) world.WorldSnapshot {
	t.Helper()
	if err := s.Step(context.Background()); err != nil {
		t.Fatal(err)
	}
	return s.Snapshot()
}

func TestWalkerFrequencyAndSeededValidMovement(t *testing.T) {
	s := create(t, chain(5), Config{Seed: 42, InitialSurvivors: []world.Survivor{survivor("S1", "D")}, InitialZombies: []world.Zombie{zombie(world.Walker, "A")}}, decisionFunc(stay))
	for turn := 1; turn <= 4; turn++ {
		w := step(t, s)
		z := w.Zombies[0]
		if turn%2 == 1 && len(z.Path) != 1 {
			t.Fatalf("walker moved on resting turn %d: %+v", turn, z)
		}
		if turn%2 == 0 {
			if len(z.Path) != 2 || !s.index.CanMove(z.Path[0], z.Path[1], s.blocked) {
				t.Fatalf("walker must move one valid street on turn %d: %+v", turn, z)
			}
		}
	}
}

func TestRunnerPursuitRecordsIntermediateNodes(t *testing.T) {
	s := create(t, chain(5), Config{InitialSurvivors: []world.Survivor{survivor("S1", "D")}, InitialZombies: []world.Zombie{zombie(world.Runner, "A")}}, decisionFunc(stay))
	w := step(t, s)
	if z := w.Zombies[0]; z.CurrentNode != "C" || !reflect.DeepEqual(z.Path, []string{"A", "B", "C"}) || z.MovementState != "chasing" {
		t.Fatalf("runner did not chase through two streets: %+v", z)
	}
	w = step(t, s)
	if w.Survivors[0].Status != world.Bitten {
		t.Fatal("runner must catch stationary survivor at D")
	}
}

func TestHordeBlocksItsNodeAndAllNeighbors(t *testing.T) {
	s := create(t, chain(5), Config{InitialSurvivors: []world.Survivor{survivor("S1", "D")}, InitialZombies: []world.Zombie{zombie(world.Horde, "B")}}, decisionFunc(func(context.Context, world.StepRequest) (world.StepResponse, error) {
		return world.StepResponse{NextNode: "C"}, nil
	}))
	if blocked := s.hordeBlockedNodes(); !blocked["A"] || !blocked["B"] || !blocked["C"] || blocked["D"] {
		t.Fatalf("horde footprint: %v", blocked)
	}
	for i := 0; i < 3; i++ {
		w := step(t, s)
		if w.Survivors[0].CurrentNode != "D" || w.Zombies[0].CurrentNode != "B" {
			t.Fatalf("horde must remain fixed and prohibit entry: %+v", w)
		}
	}
	if s.Snapshot().Metrics.RequestsInvalid != 3 {
		t.Fatal("unsafe movements must be counted as invalid")
	}
}

func TestSleeperHiddenUntilWithinTwoNodesThenWalkerCadence(t *testing.T) {
	s := create(t, chain(5), Config{InitialSurvivors: []world.Survivor{survivor("S1", "D")}, InitialZombies: []world.Zombie{zombie(world.Sleeper, "A")}}, decisionFunc(func(_ context.Context, r world.StepRequest) (world.StepResponse, error) {
		if r.Turn == 1 {
			return world.StepResponse{NextNode: "C"}, nil
		}
		return world.StepResponse{NextNode: r.CurrentNode}, nil
	}))
	if len(s.Snapshot().Zombies) != 0 {
		t.Fatal("dormant sleeper leaked in initial snapshot")
	}
	if w := step(t, s); len(w.Zombies) != 0 {
		t.Fatal("sleeper woke at distance 3")
	}
	w := step(t, s)
	if len(w.Zombies) != 1 || !w.Zombies[0].Awake || w.Zombies[0].CurrentNode != "A" || len(w.Zombies[0].Path) != 1 {
		t.Fatalf("sleeper must wake and rest: %+v", w.Zombies)
	}
	w = step(t, s)
	if w.Zombies[0].CurrentNode != "B" || len(w.Zombies[0].Path) != 2 {
		t.Fatalf("awakened sleeper must follow walker cadence: %+v", w.Zombies)
	}
}

func TestDynamicBlockBeforeDecisionsAndInvalidNeighborStay(t *testing.T) {
	for _, next := range []string{"B", "D", "unknown"} {
		t.Run(next, func(t *testing.T) {
			cfg := Config{InitialSurvivors: []world.Survivor{survivor("S1", "A")}, Events: []ScheduledEvent{{Turn: 1, EdgeID: "E1", Blocked: true}}}
			s := create(t, chain(5), cfg, decisionFunc(func(context.Context, world.StepRequest) (world.StepResponse, error) {
				return world.StepResponse{NextNode: next}, nil
			}))
			w := step(t, s)
			if w.Survivors[0].CurrentNode != "A" || !reflect.DeepEqual(w.BlockedEdges, []string{"E1"}) || w.Metrics.RequestsInvalid != 1 {
				t.Fatalf("invalid movement was applied: %+v", w)
			}
		})
	}
}

func TestSameNodeCollisionBeforeShelterAdmission(t *testing.T) {
	s := create(t, chain(2), Config{InitialSurvivors: []world.Survivor{survivor("S1", "A")}, InitialZombies: []world.Zombie{zombie(world.Walker, "B")}}, decisionFunc(func(context.Context, world.StepRequest) (world.StepResponse, error) {
		return world.StepResponse{NextNode: "B"}, nil
	}))
	w := step(t, s)
	if w.Survivors[0].Status != world.Bitten || w.Shelters[0].Occupancy != 0 {
		t.Fatal("same-node bite must precede shelter admission")
	}
}

func TestDynamicEventsPreventZombieStreetTraversal(t *testing.T) {
	for _, kind := range []string{world.Walker, world.Runner} {
		t.Run(kind, func(t *testing.T) {
			s := create(t, chain(4), Config{
				InitialSurvivors: []world.Survivor{survivor("S1", "C")},
				InitialZombies:   []world.Zombie{zombie(kind, "A")},
				Events:           []ScheduledEvent{{Turn: 1, EdgeID: "E1", Blocked: true}},
			}, decisionFunc(stay))
			for i := 0; i < 3; i++ {
				w := step(t, s)
				if w.Zombies[0].CurrentNode != "A" || len(w.Zombies[0].Path) != 1 {
					t.Fatalf("%s crossed a closed street: %+v", kind, w.Zombies[0])
				}
			}
		})
	}
}

func TestOppositeEdgeCollisionAndRunnerIntermediateEdge(t *testing.T) {
	s := create(t, chain(2), Config{InitialSurvivors: []world.Survivor{survivor("S1", "A")}, InitialZombies: []world.Zombie{zombie(world.Walker, "B")}}, decisionFunc(func(_ context.Context, r world.StepRequest) (world.StepResponse, error) {
		if r.Turn == 1 {
			return world.StepResponse{NextNode: "A"}, nil
		}
		return world.StepResponse{NextNode: "B"}, nil
	}))
	step(t, s)
	w := step(t, s)
	if w.Survivors[0].Status != world.Bitten || w.Survivors[0].CurrentNode != "B" || w.Zombies[0].CurrentNode != "A" {
		t.Fatal("opposite crossings must bite even with different final nodes")
	}
	// Runner's A->B->C traversal crosses both edges; final-node-only checks fail.
	s.zombies[0].observable = world.Zombie{ID: "R1", Type: world.Runner, Awake: true, CurrentNode: "C", Path: []string{"A", "B", "C"}}
	if !s.bitten("B", "A") || !s.bitten("C", "B") || s.bitten("D", "D") {
		t.Fatal("every intermediate runner edge must participate in collision checks")
	}
}

func TestShelterCapacityAndEvacuatedSurvivorsStopRequests(t *testing.T) {
	g := chain(3)
	g.Shelters[0].Capacity = 1
	s := create(t, g, Config{InitialSurvivors: []world.Survivor{survivor("S2", "B"), survivor("S1", "B")}}, decisionFunc(func(context.Context, world.StepRequest) (world.StepResponse, error) {
		return world.StepResponse{NextNode: "C"}, nil
	}))
	w := step(t, s)
	if w.Survivors[0].ID != "S1" || w.Survivors[0].Status != world.Evacuated || w.Survivors[1].Status != world.Active || w.Shelters[0].Occupancy != 1 {
		t.Fatalf("capacity and stable ID admission: %+v", w)
	}
	w = step(t, s)
	if w.Metrics.RequestsSuccess != 3 || w.Metrics.Evacuated != 1 || w.Metrics.Active != 1 {
		t.Fatalf("evacuated survivor requested another move: %+v", w.Metrics)
	}
}

func TestDeterminismIndependentOfWorkerScheduling(t *testing.T) {
	cfg := Config{Seed: 57, Survivors: 20, Walkers: 2, Runners: 1, Hordes: 1, Sleepers: 2, Concurrency: 4}
	a := create(t, chain(20), cfg, decisionFunc(stay))
	b := create(t, chain(20), cfg, decisionFunc(stay))
	for turn := 0; turn < 12; turn++ {
		wa, wb := step(t, a), step(t, b)
		wa.Metrics.HTTPP50MS, wa.Metrics.HTTPP95MS, wa.Metrics.HTTPP99MS = 0, 0, 0
		wb.Metrics.HTTPP50MS, wb.Metrics.HTTPP95MS, wb.Metrics.HTTPP99MS = 0, 0, 0
		if !reflect.DeepEqual(wa, wb) {
			t.Fatalf("seeded worlds diverged on turn %d", turn+1)
		}
	}
}

func TestConcurrencyBoundAndSnapshotReads(t *testing.T) {
	var active, maximum atomic.Int32
	store := world.NewStore()
	client := decisionFunc(func(ctx context.Context, r world.StepRequest) (world.StepResponse, error) {
		current := active.Add(1)
		defer active.Add(-1)
		for {
			old := maximum.Load()
			if current <= old || maximum.CompareAndSwap(old, current) {
				break
			}
		}
		w, ok := store.Load()
		if !ok || w.Turn != r.Turn || w.Survivors[0].CurrentNode == "" {
			return world.StepResponse{}, fmt.Errorf("decision snapshot unavailable")
		}
		select {
		case <-ctx.Done():
			return world.StepResponse{}, ctx.Err()
		case <-time.After(time.Millisecond):
		}
		return world.StepResponse{NextNode: r.CurrentNode}, nil
	})
	s, err := New(chain(8), store, Config{Seed: 12, Survivors: 20, Concurrency: 3}, client)
	if err != nil {
		t.Fatal(err)
	}
	w := step(t, s)
	if maximum.Load() < 2 || maximum.Load() > 3 || w.Metrics.RequestsSuccess != 20 {
		t.Fatalf("worker bound violated: max=%d metrics=%+v", maximum.Load(), w.Metrics)
	}
}

func TestRunAcceleratedAndCancellation(t *testing.T) {
	s := create(t, chain(4), Config{Seed: 1, Survivors: 1}, decisionFunc(stay))
	start := time.Now()
	if err := s.Run(context.Background(), 150, 0); err != nil || s.Snapshot().Turn != 150 {
		t.Fatalf("accelerated run: %v", err)
	}
	if time.Since(start) > time.Second {
		t.Fatal("accelerated mode unexpectedly waited")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := s.Step(ctx); err != context.Canceled || s.Snapshot().Turn != 150 {
		t.Fatal("canceled turn mutated the world")
	}
}

func TestScenarioFilesAndInvalidConfiguration(t *testing.T) {
	for i, survivors := range []int{20, 80, 200} {
		cfg, err := LoadConfig(fmt.Sprintf("../../scenarios/round%d.json", i+1))
		if err != nil || cfg.Survivors != survivors || cfg.Turns != 150 {
			t.Fatalf("round%d: %+v %v", i+1, cfg, err)
		}
	}
	if _, err := New(chain(3), world.NewStore(), Config{Survivors: 201}, decisionFunc(stay)); err == nil {
		t.Fatal("accepted >200 survivors")
	}
}
