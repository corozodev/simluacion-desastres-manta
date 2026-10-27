package world

import (
	"encoding/json"
	"strings"
	"testing"
)

func scenarioFixture() *ScenarioSnapshot {
	return &ScenarioSnapshot{
		ScenarioType:      "urban_flood",
		FloodZones:        []FloodZone{{ID: "zone", Center: GeoPoint{Lat: 1, Lng: 2}, RadiusM: 100, Intensity: .5}},
		RoadConditions:    []RoadCondition{{EdgeID: "edge", State: "blocked", RiskScore: .8}},
		ShelterConditions: []ShelterCondition{{ShelterID: "shelter", State: "exposed", RiskScore: .7}},
		Agents:            []FloodAgent{{ID: "agent", State: "waiting", PlannedRoute: []string{"A", "B"}}},
	}
}

func TestScenarioStoreOwnsOverlayAndAgentRoutes(t *testing.T) {
	source := scenarioFixture()
	store := NewStore()
	store.Publish(WorldSnapshot{ScenarioType: "urban_flood", Scenario: source})
	source.FloodZones[0].Center.Lat = 99
	source.RoadConditions[0].State = "passable"
	source.ShelterConditions[0].State = "available"
	source.Agents[0].PlannedRoute[0] = "mutated"
	source.Agents[0].State = "moving"
	first, _ := store.Load()
	if first.Scenario.FloodZones[0].Center.Lat != 1 || first.Scenario.RoadConditions[0].State != "blocked" ||
		!ShelterUnavailable(first, "shelter") || !AgentWaiting(first, "agent") || first.Scenario.Agents[0].PlannedRoute[0] != "A" {
		t.Fatal("caller mutation changed the published scenario")
	}
	first.Scenario.FloodZones[0].Intensity = 0
	first.Scenario.RoadConditions[0].RiskScore = 0
	first.Scenario.ShelterConditions[0].RiskScore = 0
	first.Scenario.Agents[0].PlannedRoute[1] = "mutated"
	second, _ := store.Load()
	if second.Scenario.FloodZones[0].Intensity != .5 || second.Scenario.RoadConditions[0].RiskScore != .8 ||
		second.Scenario.ShelterConditions[0].RiskScore != .7 || second.Scenario.Agents[0].PlannedRoute[1] != "B" {
		t.Fatal("snapshot-reader mutation changed the published scenario")
	}
}

func TestScenarioHelpersPreserveZombieAndSeparateShelterCapacity(t *testing.T) {
	if ShelterUnavailable(WorldSnapshot{}, "H1") || AgentWaiting(WorldSnapshot{}, "S1") || (*ScenarioSnapshot)(nil).Clone() != nil {
		t.Fatal("missing scenario must preserve historical behavior")
	}
	w := WorldSnapshot{Scenario: scenarioFixture()}
	if ShelterUnavailable(w, "unknown") || AgentWaiting(w, "unknown") {
		t.Fatal("unknown entities were given a scenario restriction")
	}
	for _, state := range []string{"available", "full", "exposed", "inaccessible"} {
		w.Scenario.ShelterConditions[0].State = state
		if got := ShelterUnavailable(w, "shelter"); got != (state == "exposed" || state == "inaccessible") {
			t.Fatalf("unexpected restriction for shelter state %s", state)
		}
	}
}

func TestScenarioDetailsDoNotExpandLegacyStatePayload(t *testing.T) {
	w := WorldSnapshot{ScenarioType: "urban_flood", Scenario: scenarioFixture()}
	body, err := json.Marshal(w)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), `"scenario_type":"urban_flood"`) || strings.Contains(string(body), "flood_zones") {
		t.Fatal("legacy state must contain only the scenario marker, not the full overlay")
	}
	w.ScenarioType, w.Scenario = "", nil
	body, err = json.Marshal(w)
	if err != nil || strings.Contains(string(body), "scenario_type") {
		t.Fatal("zombie JSON gained a flood-specific marker")
	}
}
