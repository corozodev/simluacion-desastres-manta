package coordination_test

import (
	"context"
	"testing"

	"corodev/evacuation/internal/coordination"
	"corodev/evacuation/internal/decision"
	"corodev/evacuation/internal/world"
)

func TestFloodPlannerRejectsClosedRoadAndExposedShelterFromAnyProvider(t *testing.T) {
	w := star(4, 1)
	w.Scenario = &world.ScenarioSnapshot{
		RoadConditions:    []world.RoadCondition{{EdgeID: "AR2", State: "blocked"}},
		ShelterConditions: []world.ShelterCondition{{ShelterID: "R1", State: "exposed"}},
	}
	// This deliberately permissive provider returns all streets and shelters.
	// The coordinator must independently validate scenario hard restrictions.
	p := coordination.New(providerFunc(choices), coordination.Options{})
	got := p.Prepare(context.Background(), w)
	assertCapacity(t, got)
	assigned := 0
	for _, v := range got.Survivors {
		if v.TargetShelterID == "R1" || v.TargetShelterID == "R2" {
			t.Fatalf("unsafe reservation accepted: %+v", v)
		}
		if v.TargetShelterID != "" {
			assigned++
		}
	}
	if assigned != 2 || p.Stats().CapacityLimited != 2 {
		t.Fatalf("capacity or alternatives lost: assigned=%d stats=%+v", assigned, p.Stats())
	}
	// Available access restores routing without changing the base graph.
	w.Scenario.RoadConditions[0].State = "passable"
	w.Scenario.ShelterConditions[0].State = "available"
	got = p.Prepare(context.Background(), w)
	assertCapacity(t, got)
	if p.Stats().Assigned != 4 {
		t.Fatalf("reopened routes did not restore four reservations: %+v", p.Stats())
	}
}

func TestFloodWaitingReleasesReservationAndDoesNotRequestCandidates(t *testing.T) {
	w := star(2, 1)
	w.Survivors[0].TargetShelterID = "R1"
	w.Survivors[0].PlannedRoute = []string{"A", "R1"}
	w.Shelters[0].Reserved = 1
	w.Scenario = &world.ScenarioSnapshot{Agents: []world.FloodAgent{{ID: w.Survivors[0].ID, State: "waiting", Behavior: "late"}}}
	calls := 0
	provider := providerFunc(func(ctx context.Context, snapshot world.WorldSnapshot, survivor world.Survivor) []world.DecisionResult {
		calls++
		if survivor.ID == w.Survivors[0].ID {
			t.Fatal("waiting agent reached route provider")
		}
		return choices(ctx, snapshot, survivor)
	})
	p := coordination.New(provider, coordination.Options{})
	got := p.Prepare(context.Background(), w)
	assertCapacity(t, got)
	if calls != 1 || got.Survivors[0].TargetShelterID != "" || len(got.Survivors[0].PlannedRoute) != 1 || got.Survivors[0].PlannedRoute[0] != "A" || got.Survivors[0].Status != world.Active {
		t.Fatalf("waiting did not release the old plan and preserve the agent: calls=%d survivor=%+v", calls, got.Survivors[0])
	}
	if stats := p.Stats(); stats.Active != 2 || stats.Assigned != 1 || stats.Unassigned != 1 || stats.NoRoute != 0 {
		t.Fatalf("intentional waiting counted as missing route: %+v", stats)
	}
}

func TestFloodRealEngineReplansCapacityAfterShelterExposure(t *testing.T) {
	w := star(6, 2)
	w.Scenario = &world.ScenarioSnapshot{}
	e := decision.New()
	p := coordination.New(e, coordination.Options{})
	first := p.Prepare(context.Background(), w)
	assertCapacity(t, first)
	first.Scenario.ShelterConditions = []world.ShelterCondition{{ShelterID: "R1", State: "exposed"}}
	got := p.Prepare(context.Background(), first)
	assertCapacity(t, got)
	for _, v := range got.Survivors {
		if v.TargetShelterID == "R1" || v.TargetShelterID == "" {
			t.Fatalf("six agents should fit in three remaining refuges: %+v", v)
		}
		step := e.NextStep(context.Background(), got, v)
		if step.TargetShelterID != v.TargetShelterID || step.NextNode != v.PlannedRoute[1] {
			t.Fatalf("HTTP-facing decision disagrees with reserved plan: %+v survivor=%+v", step, v)
		}
	}
}
