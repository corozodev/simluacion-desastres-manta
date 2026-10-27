package floodlab

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"reflect"
	"sync"
	"testing"
	"time"

	"corodev/evacuation/internal/world"
)

const testOrigin = "http://127.0.0.1:5179"

func newManager(t *testing.T) *Manager {
	t.Helper()
	m, err := New("../../data", "../../scenarios/urban", []string{testOrigin})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := m.Close(); err != nil {
			t.Error(err)
		}
	})
	return m
}

func compactConfig(m *Manager) RunConfig {
	cfg := m.Catalog().DefaultConfig
	cfg.Agents = 8
	cfg.SimulationDuration = 12
	cfg.IntervalMS = 10
	return cfg
}

func waitState(t *testing.T, m *Manager, predicate func(State) bool) State {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		state := m.State()
		if predicate(state) {
			return state
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("state did not arrive: %+v", m.State())
	return State{}
}

func TestControllerPauseResumeRestartAndRepeatPreserveClockAndOrigins(t *testing.T) {
	m := newManager(t)
	cfg := compactConfig(m)
	cfg.IntervalMS = 100
	cfg.SimulationDuration = 20
	state, err := m.Start(RunRequest{Config: cfg, ExpectedRunID: m.State().RunID})
	if err != nil {
		t.Fatal(err)
	}
	state = waitState(t, m, func(s State) bool { return s.Scenario.SimulationStep >= 1 })
	paused, err := m.Act(Action{Action: "pause", ExpectedRunID: state.RunID})
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(130 * time.Millisecond)
	if current := m.State(); current.State != "paused" || current.Scenario.SimulationStep != paused.Scenario.SimulationStep {
		t.Fatal("pause acknowledged before the clock really stopped")
	}
	if _, err := m.Act(Action{Action: "resume", ExpectedRunID: state.RunID}); err != nil {
		t.Fatal(err)
	}
	waitState(t, m, func(s State) bool { return s.Scenario.SimulationStep > paused.Scenario.SimulationStep })
	reset, err := m.Act(Action{Action: "restart", ExpectedRunID: state.RunID})
	if err != nil {
		t.Fatal(err)
	}
	if reset.State != "idle" || reset.Scenario.SimulationStep != 0 || reset.RunID == state.RunID || !reflect.DeepEqual(reset.Origins, state.Origins) {
		t.Fatal("restart did not restore the same initial population")
	}
	activeGraph, err := m.Graph("", reset.RunID)
	if err != nil || activeGraph.Version != reset.GraphVersion {
		t.Fatal("active graph could not be selected by run_id alone")
	}
	if _, err := m.Graph("", state.RunID); err != ErrChanged {
		t.Fatal("stale graph run_id was accepted")
	}
	replayed, err := m.Act(Action{Action: "repeat", ExpectedRunID: reset.RunID})
	if err != nil {
		t.Fatal(err)
	}
	if replayed.State != "running" || !reflect.DeepEqual(replayed.Origins, reset.Origins) || replayed.Config.Seed != cfg.Seed {
		t.Fatal("same-seed repeat changed inputs")
	}
	zero := 0
	if _, err := m.Act(Action{Action: "speed", ExpectedRunID: replayed.RunID, IntervalMS: &zero}); err != nil {
		t.Fatal(err)
	}
	final := waitState(t, m, func(s State) bool { return s.State == "finished" })
	if final.Scenario.SimulationStep != 20 || final.Config.IntervalMS != 0 || len(final.Timeline) != 21 {
		t.Fatal("actual backend pacing/clock did not match the controls")
	}
	if _, err := m.Act(Action{Action: "pause", ExpectedRunID: reset.RunID}); err != ErrChanged {
		t.Fatal("stale control changed the new run")
	}
}

func TestCandidateValidationRejectsImpossibleAndDuplicateSites(t *testing.T) {
	m := newManager(t)
	defaults := m.Catalog().DefaultConfig
	valid, err := m.Validate(CandidateRequest{Mode: "competition", Candidates: defaults.Shelters})
	if err != nil || !valid.Valid {
		t.Fatal(valid, err)
	}
	for _, candidate := range valid.Candidates {
		if candidate.SnapDistanceM != 0 || candidate.NodeID == "" {
			t.Fatal("original site unexpectedly moved")
		}
	}
	duplicate := append([]Candidate{}, defaults.Shelters...)
	duplicate[1] = duplicate[0]
	result, err := m.Validate(CandidateRequest{Mode: "competition", Candidates: duplicate})
	if err != nil || result.Valid {
		t.Fatal("duplicate candidates accepted")
	}
	far := append([]Candidate{}, defaults.Shelters...)
	far[0].Lat, far[0].Lng = 30, 30
	result, err = m.Validate(CandidateRequest{Mode: "competition", Candidates: far})
	if err != nil || result.Valid || result.Candidates[0].Valid {
		t.Fatal("far-away site silently snapped to Manta")
	}
	bad := append([]Candidate{}, defaults.Shelters...)
	bad[0].Capacity = 0
	if _, err := m.Validate(CandidateRequest{Mode: "competition", Candidates: bad}); err != ErrInvalid {
		t.Fatal("malformed capacity did not produce a validation error")
	}
	if _, err := m.Start(RunRequest{Config: RunConfig{}, ExpectedRunID: m.State().RunID}); err == nil {
		t.Fatal("invalid simulation input accepted")
	}
	// A directed dead-end can leave the original shelter reachable while a new
	// candidate cannot be reached from every origin. Reject it explicitly.
	g := &world.Graph{Nodes: []world.GraphNode{{ID: "A"}, {ID: "B"}}, Edges: []world.GraphEdge{{ID: "AB", From: "A", To: "B", Directed: true}}}
	if reachableFromEveryNode(g, "A") {
		t.Fatal("inaccessible directed component accepted")
	}
}

func TestFrozenOriginsThreatAndGraphSelectionAreReal(t *testing.T) {
	m := newManager(t)
	cfg := compactConfig(m)
	a, err := m.prepare(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer a.app.Close()
	custom := cloneConfig(cfg)
	// Pick a former origin as a candidate: normal spawning would have excluded
	// it. Explicit initial survivors must keep the same source coordinates.
	origin := a.origins[0]
	custom.Shelters[0].ID = "custom-origin"
	custom.Shelters[0].Label = "Candidato sobre un origen congelado"
	custom.Shelters[0].Lat = origin.Lat
	custom.Shelters[0].Lng = origin.Lng
	if validation := validateCandidates(m.graphs[cfg.Mode], custom.Shelters); !validation.Valid {
		t.Fatal("test origin is not a usable candidate", validation)
	}
	b, err := m.prepare(custom)
	if err != nil {
		t.Fatal(err)
	}
	defer b.app.Close()
	if !reflect.DeepEqual(a.origins, b.origins) || a.threatHash != b.threatHash {
		t.Fatal("custom shelters changed population or artificial threat")
	}
	master := cloneConfig(cfg)
	master.Mode = "full"
	c, err := m.prepare(master)
	if err != nil {
		t.Fatal(err)
	}
	defer c.app.Close()
	if len(c.graph.Nodes) != 9179 || len(c.graph.Edges) != 13452 || c.app.Simulator.Snapshot().GraphVersion != c.graph.Version {
		t.Fatal("graph selection changed only a preview")
	}
	if originsHash(a.origins) != originsHash(c.origins) || a.threatHash != c.threatHash {
		t.Fatal("graph change did not preserve geographic inputs")
	}
	for _, origin := range c.origins {
		if origin.SnapDistanceM != 0 {
			t.Fatal("reviewed master should contain the competition origin IDs")
		}
	}
	if reflect.DeepEqual(a.graph.Shelters, b.graph.Shelters) || a.graph.Version == b.graph.Version {
		t.Fatal("custom shelter selection was not used by the motor")
	}
}

func TestComparisonUsesTheSamePopulationAndParameters(t *testing.T) {
	m := newManager(t)
	cfg := compactConfig(m)
	cfg.IntervalMS = 0
	state, err := m.Compare(RunRequest{Config: cfg, ExpectedRunID: m.State().RunID})
	if err != nil {
		t.Fatal(err)
	}
	if state.State != "paused" || state.Comparison.State != "running" {
		t.Fatal("comparison did not acknowledge the asynchronous job")
	}
	final := waitState(t, m, func(s State) bool { return s.Comparison != nil && s.Comparison.State != "running" })
	comparison := final.Comparison
	if comparison.State != "finished" || comparison.Progress != 2 || len(comparison.Results) != 2 {
		t.Fatal("comparison failed", comparison)
	}
	a, b := comparison.Results[0], comparison.Results[1]
	if a.Strategy != "original" || b.Strategy != "custom" || a.OriginsHash != b.OriginsHash || a.ConfigHash != b.ConfigHash || a.TotalAgents != b.TotalAgents || a.TotalAgents != cfg.Agents {
		t.Fatal("A/B compared different input populations or threats")
	}
	if !reflect.DeepEqual(a.EvacuationMetrics, b.EvacuationMetrics) {
		t.Fatal("identical shelter setup produced different simulation outcomes")
	}
	for _, result := range comparison.Results {
		if result.EvacuatedPercentage != 100*float64(result.EvacuationMetrics.EvacuatedAgents)/float64(cfg.Agents) || result.StepLatencyMS <= 0 {
			t.Fatal("comparison result used an invalid denominator or timing")
		}
	}
}

func TestLocalHTTPRequiresSessionOriginAndCSRF(t *testing.T) {
	m := newManager(t)
	server := httptest.NewServer(m)
	defer server.Close()
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}
	request := func(method, path, origin, csrf string, body any) *http.Response {
		t.Helper()
		var reader io.Reader
		if body != nil {
			raw, _ := json.Marshal(body)
			reader = bytes.NewReader(raw)
		}
		req, _ := http.NewRequest(method, server.URL+path, reader)
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		if csrf != "" {
			req.Header.Set("X-CSRF-Token", csrf)
		}
		res, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return res
	}
	res := request("POST", "/lab/actions", testOrigin, "", Action{Action: "resume", ExpectedRunID: m.State().RunID})
	res.Body.Close()
	if res.StatusCode != 401 {
		t.Fatal("mutation without session accepted")
	}
	res = request("GET", "/lab/session", testOrigin, "", nil)
	var session Session
	if err := json.NewDecoder(res.Body).Decode(&session); err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if !session.Authenticated || session.CSRFToken == "" || len(res.Cookies()) != 1 || !res.Cookies()[0].HttpOnly || res.Cookies()[0].SameSite != http.SameSiteStrictMode {
		t.Fatal("local session protections missing")
	}
	res = request("POST", "/lab/actions", "https://untrusted.example", session.CSRFToken, Action{Action: "resume", ExpectedRunID: m.State().RunID})
	res.Body.Close()
	if res.StatusCode != 403 {
		t.Fatal("untrusted origin accepted")
	}
	res = request("POST", "/lab/actions", testOrigin, "incorrect", Action{Action: "resume", ExpectedRunID: m.State().RunID})
	res.Body.Close()
	if res.StatusCode != 401 {
		t.Fatal("incorrect CSRF accepted")
	}
	cfg := compactConfig(m)
	cfg.IntervalMS = 100
	res = request("POST", "/lab/runs", testOrigin, session.CSRFToken, RunRequest{Config: cfg, ExpectedRunID: m.State().RunID})
	res.Body.Close()
	if res.StatusCode != 200 || res.Header.Get("x-request-id") == "" || res.Header.Get("Access-Control-Allow-Credentials") != "true" {
		t.Fatal("authenticated run failed")
	}
	res = request("POST", "/lab/runs", testOrigin, session.CSRFToken, map[string]any{"expected_run_id": m.State().RunID, "config": map[string]any{"mode": "competition", "agents": 8}})
	res.Body.Close()
	if res.StatusCode != 400 {
		t.Fatal("missing required storm parameters silently received zero values")
	}
	res = request("POST", "/lab/actions", testOrigin, session.CSRFToken, map[string]any{"action": "resume", "expected_run_id": m.State().RunID, "unexpected": true})
	res.Body.Close()
	if res.StatusCode != 400 {
		t.Fatal("unknown control field accepted")
	}
	res = request("GET", "/paso", testOrigin, "", nil)
	res.Body.Close()
	if res.StatusCode != 404 {
		t.Fatal("private movement endpoint exposed by laboratory")
	}
	req, _ := http.NewRequest("GET", server.URL+"/lab/state", nil)
	req.Host = "attacker.example"
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 403 {
		t.Fatal("DNS rebinding host accepted")
	}
}

func TestConcurrentCachedReadsAndTransitions(t *testing.T) {
	m := newManager(t)
	cfg := compactConfig(m)
	cfg.IntervalMS = 1
	cfg.SimulationDuration = 30
	state, err := m.Start(RunRequest{Config: cfg, ExpectedRunID: m.State().RunID})
	if err != nil {
		t.Fatal(err)
	}
	var readers sync.WaitGroup
	for i := 0; i < 8; i++ {
		readers.Add(1)
		go func() {
			defer readers.Done()
			for j := 0; j < 100; j++ {
				s := m.State()
				s.Config.Shelters[0].Capacity = 1
				s.Scenario.Agents[0].PlannedRoute = append(s.Scenario.Agents[0].PlannedRoute, "mutated")
			}
		}()
	}
	if _, err := m.Act(Action{Action: "pause", ExpectedRunID: state.RunID}); err != nil {
		t.Fatal(err)
	}
	readers.Wait()
	if m.State().Config.Shelters[0].Capacity == 1 {
		t.Fatal("public state aliases controller memory")
	}
}
