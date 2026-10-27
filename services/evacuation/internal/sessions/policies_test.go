package sessions

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestOfficialSettingsAreEnforcedAtConstruction(t *testing.T) {
	m, _ := testManager(t, func(o *Options) { o.DefaultMaxTicks = 2; o.DefaultTickInterval = time.Second })
	req := CreateRequest{Scenario: "zombie_outbreak", GraphProfile: "BASE", Config: InputConfig{Mode: "official", Round: "round2"}}
	info := create(t, m, req, "official-valid-key")
	if info.MaxTicks != 150 || info.TickIntervalMS != 2000 || info.Config.Survivors != 80 || info.Config.ZombiePolicy != "classic_random" {
		t.Fatalf("official drift: %+v", info)
	}
	_, _ = m.Control(info.SimulationID, info.AccessToken, "cancel")
	restarted, err := m.Restart(context.Background(), info.SimulationID, info.AccessToken, "official-restart-key", "test-ip")
	if err != nil || restarted.Config.Mode != "official" || restarted.Config.Survivors != 80 {
		t.Fatal("official replay rejected", err)
	}
	_, _ = m.Control(restarted.SimulationID, restarted.AccessToken, "cancel")
	for _, change := range []func(*CreateRequest){
		func(r *CreateRequest) { r.Config.ZombiePolicy = "adaptive_exploration" },
		func(r *CreateRequest) { r.Config.Pro = &ProInput{RescueFleet: pointer(true)} },
		func(r *CreateRequest) { r.Config.Survivors = pointer(20) },
		func(r *CreateRequest) { r.MaxTicks = pointer(2) },
		func(r *CreateRequest) { r.TickIntervalMS = pointer(1000) },
		func(r *CreateRequest) { r.GraphProfile = "FULL_MANTA" },
		func(r *CreateRequest) { r.Config.RefugeIDs = []string{"one"} },
	} {
		r := req
		change(&r)
		_, err := m.CreateAndStart(context.Background(), r, "official-invalid-key", "test-ip")
		expectError(t, err, 400)
	}
}

func TestPolicyHTTPRejectsMalformedAndFloodOptions(t *testing.T) {
	m, _ := testManager(t, nil)
	server := httptest.NewServer(m)
	defer server.Close()
	for _, config := range []string{
		`{"mode":""}`, `{"mode":"invented"}`, `{"zombie_policy":"oracle"}`, `{"evacuation_algorithm":"DStar"}`, `{"pro":{"runner_prediction":null}}`, `{"pro":{"rescue_fleet":2}}`, `{"pro":{"hidden":true}}`, `{"pro":null}`,
	} {
		body := `{"scenario":"zombie_outbreak","graph_profile":"BASE","config":` + config + `}`
		req, _ := http.NewRequest("POST", server.URL+"/v1/simulations", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Idempotency-Key", "invalid-policy-key")
		resp, err := server.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != 400 {
			t.Fatal(config, resp.StatusCode)
		}
	}
	r := request(2)
	r.Scenario = "urban_flood"
	r.Config.Pro = &ProInput{RunnerPrediction: pointer(false)}
	_, err := m.CreateAndStart(context.Background(), r, "flood-policy-invalid", "test-ip")
	expectError(t, err, 400)
}

func TestPoliciesAreIsolatedRestartedAndPauseReproducible(t *testing.T) {
	m, c := testManager(t, nil)
	r := request(3)
	r.Config.ZombiePolicy = "adaptive_exploration"
	r.Config.EvacuationAlgorithm = "predictive_temporal_astar"
	r.Config.Pro = &ProInput{RescueFleet: pointer(true)}
	a := create(t, m, r, "phase7-isolated-a")
	b := create(t, m, r, "phase7-isolated-b")
	_, err := m.Control(b.SimulationID, b.AccessToken, "pause")
	if err != nil {
		t.Fatal(err)
	}
	// Returned values cannot alter the retained policy.
	a.Config.Pro.RescueFleet = false
	i, err := m.Get(a.SimulationID, a.AccessToken)
	if err != nil || !i.Config.Pro.RescueFleet {
		t.Fatal("mutable pro options")
	}
	for tick := 1; tick <= 3; tick++ {
		advance(t, m, c, a, tick)
	}
	await(t, func() bool { return m.Stats().Active == 1 })
	_, _ = m.Control(b.SimulationID, b.AccessToken, "resume")
	for tick := 1; tick <= 3; tick++ {
		advance(t, m, c, b, tick)
	}
	if !reflect.DeepEqual(logical(state(t, m, a)), logical(state(t, m, b))) {
		t.Fatal("policy/fleet pause changed logical outcome")
	}
	results, err := m.GetSnapshot(b.SimulationID, b.AccessToken, true)
	if err != nil || results.Results.Analytics == nil {
		t.Fatal(err, "missing analytics")
	}
	raw, _ := json.Marshal(results)
	if strings.Contains(string(raw), "initial_zombies") || strings.Contains(string(raw), "access_token") || strings.Contains(string(raw), "rng") {
		t.Fatal("private diagnostics leaked")
	}
	if len(results.Snapshot.Fleet) != 5 || results.RunnerForecast == nil {
		t.Fatal("functional PRO state missing")
	}
	restarted, err := m.Restart(context.Background(), b.SimulationID, b.AccessToken, "phase7-restart-key", "test-ip")
	if err != nil || !reflect.DeepEqual(restarted.Config, b.Config) {
		t.Fatal(err, "lost replay configuration")
	}
}
