package floodlab

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func labPublicRequest(t testing.TB, server *httptest.Server, method, path string, body any, etag string) (int, []byte, http.Header) {
	t.Helper()
	var raw []byte
	if body != nil {
		raw, _ = json.Marshal(body)
	}
	req, err := http.NewRequest(method, server.URL+path, bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("If-None-Match", etag)
	response, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	raw, err = io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	return response.StatusCode, raw, response.Header
}

func TestAnonymousStormSharedSnapshotLateJoinAndFinal(t *testing.T) {
	m := newManager(t)
	server := httptest.NewServer(m)
	defer server.Close()
	code, raw, _ := labPublicRequest(t, server, "GET", "/lab/published", nil, "")
	var initial State
	if code != 200 || json.Unmarshal(raw, &initial) != nil || initial.State != "idle" || len(initial.Timeline) != 0 {
		t.Fatal("idle published view is not compact", code, string(raw))
	}
	cfg := compactConfig(m)
	cfg.IntervalMS = 50
	code, raw, _ = labPublicRequest(t, server, "POST", "/lab/runs", RunRequest{Config: cfg, ExpectedRunID: initial.RunID}, "")
	var running State
	if code != 200 || json.Unmarshal(raw, &running) != nil || running.State != "running" {
		t.Fatal("anonymous storm did not start", code, string(raw))
	}
	late := waitState(t, m, func(s State) bool { return s.Scenario.SimulationStep >= 3 })
	code, raw, _ = labPublicRequest(t, server, "POST", "/lab/actions", Action{Action: "pause", ExpectedRunID: running.RunID}, "")
	var paused State
	if code != 200 || json.Unmarshal(raw, &paused) != nil || paused.State != "paused" {
		t.Fatal("anonymous pause failed", code, string(raw))
	}
	code, raw, headers := labPublicRequest(t, server, "GET", "/lab/published", nil, "")
	var published State
	if code != 200 || json.Unmarshal(raw, &published) != nil || published.RunID != running.RunID || published.Scenario.SimulationStep < late.Scenario.SimulationStep || published.Scenario.SimulationStep != paused.Scenario.SimulationStep || published.State != "paused" || len(published.Scenario.Agents) != cfg.Agents {
		t.Fatal("late spectator is not observing the same current execution", code, string(raw))
	}
	if len(published.Timeline) != 0 || published.Comparison != nil || strings.Contains(string(raw), `"nodes":`) || strings.Contains(string(raw), `"edges":`) {
		t.Fatal("historical timeline or static topology is repeated")
	}
	var wg sync.WaitGroup
	for spectator := 0; spectator < 50; spectator++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			code, payload, _ := labPublicRequest(t, server, "GET", "/lab/published", nil, headers.Get("ETag"))
			if code != 304 || len(payload) != 0 {
				t.Errorf("cached unchanged snapshot retransmitted: %d", code)
			}
		}()
	}
	wg.Wait()
	if m.State().RunID != published.RunID || m.State().Scenario.SimulationStep != published.Scenario.SimulationStep {
		t.Fatal("spectators advanced or replaced paused engine")
	}
	zero := 0
	code, _, _ = labPublicRequest(t, server, "POST", "/lab/actions", Action{Action: "speed", ExpectedRunID: running.RunID, IntervalMS: &zero}, "")
	if code != 200 {
		t.Fatal("anonymous pacing failed")
	}
	code, _, _ = labPublicRequest(t, server, "POST", "/lab/actions", Action{Action: "resume", ExpectedRunID: running.RunID}, "")
	if code != 200 {
		t.Fatal("anonymous resume failed")
	}
	final := waitState(t, m, func(s State) bool { return s.State == "finished" })
	code, raw, _ = labPublicRequest(t, server, "GET", "/lab/published", nil, "")
	if code != 200 || json.Unmarshal(raw, &published) != nil || published.State != "finished" || published.RunID != running.RunID || published.Scenario.SimulationStep != final.Scenario.SimulationStep || published.Scenario.EvacuationMetrics != final.Scenario.EvacuationMetrics {
		t.Fatal("final shared results not preserved")
	}
	code, _, _ = labPublicRequest(t, server, "GET", "/lab/graph?run_id="+published.RunID, nil, "")
	if code != 200 {
		t.Fatal("final geography unavailable")
	}
	code, _, _ = labPublicRequest(t, server, "POST", "/lab/actions", Action{Action: "restart", ExpectedRunID: running.RunID}, "")
	if code != 200 {
		t.Fatal("anonymous restart failed")
	}
	code, raw, _ = labPublicRequest(t, server, "GET", "/lab/published", nil, "")
	if code != 200 || json.Unmarshal(raw, &published) != nil || published.RunID == running.RunID || published.Scenario.SimulationStep != 0 || published.State != "idle" {
		t.Fatal("replacement mixed identities or snapshots")
	}
	code, _, _ = labPublicRequest(t, server, "GET", "/lab/graph?run_id="+running.RunID, nil, "")
	if code != 409 {
		t.Fatal("stale graph identity was accepted")
	}
}

func TestAnonymousConcurrentStormStartsStillHaveOneWinner(t *testing.T) {
	m := newManager(t)
	server := httptest.NewServer(m)
	defer server.Close()
	cfg := compactConfig(m)
	cfg.IntervalMS = 5000
	input := RunRequest{Config: cfg, ExpectedRunID: m.State().RunID}
	statuses := make(chan int, 4)
	var wg sync.WaitGroup
	for attempt := 0; attempt < 4; attempt++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			code, _, _ := labPublicRequest(t, server, "POST", "/lab/runs", input, "")
			statuses <- code
		}()
	}
	wg.Wait()
	close(statuses)
	created, rejected := 0, 0
	for code := range statuses {
		switch code {
		case 200:
			created++
		case 409:
			rejected++
		default:
			t.Fatalf("unexpected anonymous start status %d", code)
		}
	}
	if created != 1 || rejected != 3 {
		t.Fatal("duplicate submissions started multiple engines", created, rejected)
	}
	for _, path := range []string{"/lab/incidents/synthetic", "/lab/reference/refresh"} {
		code, raw, headers := labPublicRequest(t, server, "POST", path, map[string]any{}, "")
		var envelope struct {
			Error struct {
				RequestID string `json:"requestId"`
			} `json:"error"`
		}
		if json.Unmarshal(raw, &envelope) != nil || envelope.Error.RequestID == "" || envelope.Error.RequestID != headers.Get("x-request-id") {
			t.Fatal("error lost request ID", string(raw))
		}
		if code != 401 {
			t.Fatal("lifecycle exception exposed protected operations", path, code)
		}
	}
}
