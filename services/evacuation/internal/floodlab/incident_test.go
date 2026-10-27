package floodlab

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"

	"corodev/evacuation/internal/incidents"
	"corodev/evacuation/internal/world"
)

func managerStore(t *testing.T, m *Manager) *incidents.Store {
	t.Helper()
	g, err := m.Graph("full", "")
	if err != nil {
		t.Fatal(err)
	}
	s, err := incidents.Open(t.TempDir(), g)
	if err != nil {
		t.Fatal(err)
	}
	if err = m.SetIncidentStore(s); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = m.Close(); _ = s.Close() })
	return s
}
func pausedIncidentRun(t *testing.T, m *Manager) State {
	t.Helper()
	cfg := compactConfig(m)
	cfg.RainfallIntensity = 0
	cfg.IntervalMS = 5000
	cfg.SimulationDuration = 20
	s, err := m.Start(RunRequest{Config: cfg, ExpectedRunID: m.State().RunID})
	if err != nil {
		t.Fatal(err)
	}
	s, err = m.Act(Action{Action: "pause", ExpectedRunID: s.RunID})
	if err != nil {
		t.Fatal(err)
	}
	return s
}
func roadReport(t *testing.T, m *Manager) incidents.Create {
	t.Helper()
	w := m.current.app.Simulator.Snapshot()
	var from, to string
	for _, v := range w.Survivors {
		if len(v.PlannedRoute) > 1 {
			from, to = v.PlannedRoute[0], v.PlannedRoute[1]
			break
		}
	}
	nodes := map[string]world.GraphNode{}
	for _, n := range w.Graph.Nodes {
		nodes[n.ID] = n
	}
	for _, e := range w.Graph.Edges {
		if e.From == from && e.To == to || !e.Directed && e.From == to && e.To == from {
			points := e.Geometry
			if len(points) < 2 {
				a, b := nodes[e.From], nodes[e.To]
				points = []world.GeoPoint{{Lat: a.Lat, Lng: a.Lng}, {Lat: b.Lat, Lng: b.Lng}}
			}
			i := len(points) / 2
			a, b := points[i-1], points[i]
			return incidents.Create{IncidentType: "road_closed", Latitude: (a.Lat + b.Lat) / 2, Longitude: (a.Lng + b.Lng) / 2, EdgeIDHint: e.ID, Description: "Cierre declarado para prueba experimental", SeverityReported: "high", RoadPassabilityReported: "blocked", LocationMethod: "manual", EventTime: time.Now().UTC()}
		}
	}
	t.Fatal("no agent with a real planned road found")
	return incidents.Create{}
}
func roadInPlan(g *world.Graph, route []string, id string) bool {
	for _, e := range g.Edges {
		if e.ID != id {
			continue
		}
		for i := 1; i < len(route); i++ {
			if route[i-1] == e.From && route[i] == e.To || !e.Directed && route[i-1] == e.To && route[i] == e.From {
				return true
			}
		}
	}
	return false
}

func TestIncidentRunApplicationReplansIsIdempotentAndIsolated(t *testing.T) {
	a := newManager(t)
	store := managerStore(t, a)
	before := pausedIncidentRun(t, a)
	input := roadReport(t, a)
	i, created, err := store.Create(input, "integration_citizen_key_001", "citizen", "local-test")
	if err != nil || !created {
		t.Fatal(i, err)
	}
	b := newManager(t)
	if err = b.SetIncidentStore(store); err != nil {
		t.Fatal(err)
	}
	other := b.State()
	base := a.current.graph.Clone()
	oldWorld := a.current.app.Simulator.Snapshot()
	request := incidents.ApplyRequest{ExpectedRunID: before.RunID, DurationSteps: 2, Effect: "blocked", ExperimentalAck: true}
	result, err := a.ApplyIncident(context.Background(), i.IncidentID, request)
	if err != nil {
		t.Fatal(err)
	}
	if result.AlreadyApplied || result.Incident.VerificationStatus != "pending" || result.Application.SourceType != "citizen" || result.Application.VerificationStatusAtApplication != "pending" || result.Application.WorldVersion != before.Scenario.WorldVersion+1 || result.Application.ExpiresAtSimulationStep != before.Scenario.SimulationStep+3 {
		t.Fatal("bad audit receipt", result.Application)
	}
	after := a.current.app.Simulator.Snapshot()
	changed := false
	for n, v := range after.Survivors {
		if v.CurrentNode != oldWorld.Survivors[n].CurrentNode {
			t.Fatal("application moved an agent")
		}
		if !reflect.DeepEqual(v.PlannedRoute, oldWorld.Survivors[n].PlannedRoute) {
			changed = true
		}
		if roadInPlan(base, v.PlannedRoute, input.EdgeIDHint) {
			t.Fatal("published plan still traverses applied closure")
		}
	}
	if !changed || after.Turn != oldWorld.Turn || !slices.Contains(after.BlockedEdges, input.EdgeIDHint) || len(result.State.IncidentApplications) != 1 || !reflect.DeepEqual(base, a.current.graph.Clone()) {
		t.Fatal("no reroute or base graph changed")
	}
	if !reflect.DeepEqual(other, b.State()) {
		t.Fatal("shared observation store propagated an overlay into another lab manager")
	}
	if got, err := store.Get(i.IncidentID); err != nil || got.IncidentID != i.IncidentID {
		t.Fatal("second manager cannot see shared source", got, err)
	}
	retry, err := a.ApplyIncident(context.Background(), i.IncidentID, request)
	if err != nil || !retry.AlreadyApplied || retry.Application.ApplicationID != result.Application.ApplicationID || retry.State.Scenario.WorldVersion != result.State.Scenario.WorldVersion {
		t.Fatal("repeat added another overlay/version", err)
	}
	request.DurationSteps = 3
	if _, err = a.ApplyIncident(context.Background(), i.IncidentID, request); !errors.Is(err, incidents.ErrConflict) {
		t.Fatal("changed repeat duration accepted", err)
	}
	request.DurationSteps = 2
	reset, err := a.Act(Action{Action: "restart", ExpectedRunID: before.RunID})
	if err != nil {
		t.Fatal(err)
	}
	if len(reset.IncidentApplications) != 0 || slices.Contains(a.current.app.Simulator.Snapshot().BlockedEdges, input.EdgeIDHint) {
		t.Fatal("restart inherited incident overlay")
	}
	if _, err = a.ApplyIncident(context.Background(), i.IncidentID, request); !errors.Is(err, ErrChanged) {
		t.Fatal("old session applied to new run", err)
	}
	log, exists, err := store.Application(before.RunID, i.IncidentID)
	if err != nil || !exists || log.ApplicationID != result.Application.ApplicationID {
		t.Fatal("old audit record was not durable", log, exists, err)
	}
}

func TestIncidentApplyRejectsIdleUnacknowledgedRejectedAndComparison(t *testing.T) {
	m := newManager(t)
	s := managerStore(t, m)
	input := roadReport(t, m)
	i, _, err := s.Create(input, "rejection_citizen_key_01", "citizen", "test")
	if err != nil {
		t.Fatal(err)
	}
	req := incidents.ApplyRequest{ExpectedRunID: m.State().RunID, DurationSteps: 1, Effect: "blocked", ExperimentalAck: true}
	if _, err = m.ApplyIncident(context.Background(), i.IncidentID, req); !errors.Is(err, ErrState) {
		t.Fatal("idle run accepted incident", err)
	}
	paused := pausedIncidentRun(t, m)
	req.ExpectedRunID = paused.RunID
	req.ExperimentalAck = false
	if _, err = m.ApplyIncident(context.Background(), i.IncidentID, req); !errors.Is(err, incidents.ErrInvalid) {
		t.Fatal("unacknowledged report accepted", err)
	}
	req.ExperimentalAck = true
	updated, err := s.Review(i.IncidentID, incidents.StatusUpdate{VerificationStatus: "rejected", ExpectedUpdatedAt: i.UpdatedAt})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = m.ApplyIncident(context.Background(), i.IncidentID, req); !errors.Is(err, incidents.ErrIneligible) {
		t.Fatal("rejected report applied", err)
	}
	if _, err = s.Review(i.IncidentID, incidents.StatusUpdate{VerificationStatus: "pending", ExpectedUpdatedAt: updated.UpdatedAt}); err != nil {
		t.Fatal(err)
	}
	m.mu.Lock()
	m.state.Comparison = &Comparison{State: "running"}
	m.mu.Unlock()
	if _, err = m.ApplyIncident(context.Background(), i.IncidentID, req); !errors.Is(err, ErrState) {
		t.Fatal("running A/B contaminated by report", err)
	}
}

func TestIncidentHTTPPublicReceptionAndPrivilegedAllowlist(t *testing.T) {
	m := newManager(t)
	store := managerStore(t, m)
	state := pausedIncidentRun(t, m)
	report := roadReport(t, m)
	server := httptest.NewServer(m)
	defer server.Close()
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}
	request := func(method, path, origin, csrf, key string, body any) (int, []byte, http.Header) {
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
		if key != "" {
			req.Header.Set("Idempotency-Key", key)
		}
		res, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		raw, err := io.ReadAll(res.Body)
		if err != nil {
			t.Fatal(err)
		}
		if res.Header.Get("x-request-id") == "" || res.Header.Get("Cache-Control") != "no-store" {
			t.Fatal("response protections missing")
		}
		return res.StatusCode, raw, res.Header
	}
	code, raw, _ := request("POST", "/v1/incidents", "", "", "http_citizen_key_12345", report)
	if code != 201 {
		t.Fatal(code, string(raw))
	}
	for _, evidence := range []any{nil, map[string]any{}, map[string]any{"storage_status": "not_supported"}, map[string]any{"attachment_count": 0}, map[string]any{"attachment_count": nil, "storage_status": "not_supported"}} {
		encoded, _ := json.Marshal(report)
		var invalid map[string]any
		_ = json.Unmarshal(encoded, &invalid)
		invalid["evidence_metadata"] = evidence
		status, _, _ := request("POST", "/v1/incidents", "", "", "invalid_evidence_key_12345", invalid)
		if status != 400 {
			t.Fatal("incomplete evidence metadata accepted", status)
		}
	}
	var incident incidents.Incident
	if json.Unmarshal(raw, &incident) != nil {
		t.Fatal("invalid response")
	}
	code, raw, _ = request("POST", "/v1/incidents", "", "", "http_citizen_key_12345", report)
	if code != 200 {
		t.Fatal("mobile network retry duplicated or rejected", code, string(raw))
	}
	code, raw, _ = request("GET", "/v1/incidents?incident_type=road_closed", testOrigin, "", "", nil)
	if code != 200 || !strings.Contains(string(raw), incident.IncidentID) {
		t.Fatal("browser did not observe same public record", code, string(raw))
	}
	code, _, headers := request("OPTIONS", "/v1/incidents", testOrigin, "", "", nil)
	if code != 204 || !strings.Contains(headers.Get("Access-Control-Allow-Headers"), "Idempotency-Key") {
		t.Fatal("browser retry header not allowed")
	}
	for _, path := range []string{"/lab/incidents/synthetic", "/lab/incidents/" + incident.IncidentID + "/status", "/lab/incidents/" + incident.IncidentID + "/apply"} {
		code, _, _ = request("POST", path, testOrigin, "", "privileged_key_12345", report)
		if code != 401 {
			t.Fatal("public exception leaked into privileged operation", path, code)
		}
	}
	code, raw, _ = request("GET", "/lab/session", testOrigin, "", "", nil)
	if code != 200 {
		t.Fatal(code, string(raw))
	}
	var session Session
	if json.Unmarshal(raw, &session) != nil {
		t.Fatal("invalid session")
	}
	for _, path := range []string{"/lab/incidents/synthetic", "/lab/incidents/" + incident.IncidentID + "/apply"} {
		code, _, _ = request("POST", path, testOrigin, "wrong", "synthetic_key_12345", report)
		if code != 401 {
			t.Fatal("invalid csrf accepted", path, code)
		}
	}
	code, raw, _ = request("POST", "/lab/incidents/"+incident.IncidentID+"/apply", testOrigin, session.CSRFToken, "", incidents.ApplyRequest{ExpectedRunID: state.RunID, DurationSteps: 1, Effect: "blocked", ExperimentalAck: true})
	if code != 200 {
		t.Fatal("authorized experimental apply failed", code, string(raw))
	}
	var applied IncidentApplyResult
	if json.Unmarshal(raw, &applied) != nil || applied.Application.IncidentID != incident.IncidentID {
		t.Fatal("invalid application response")
	}
	code, raw, _ = request("POST", "/lab/incidents/"+incident.IncidentID+"/status", testOrigin, session.CSRFToken, "", incidents.StatusUpdate{VerificationStatus: "verified", ExpectedUpdatedAt: incident.UpdatedAt})
	if code != 200 {
		t.Fatal("authorized review failed", code, string(raw))
	}
	var reviewed incidents.Incident
	if json.Unmarshal(raw, &reviewed) != nil || reviewed.SourceType != "citizen" || reviewed.VerificationStatus != "verified" {
		t.Fatal("review forged official source")
	}
	code, _, _ = request("POST", "/lab/incidents/"+incident.IncidentID+"/status", testOrigin, session.CSRFToken, "", incidents.StatusUpdate{VerificationStatus: "rejected", ExpectedUpdatedAt: incident.UpdatedAt})
	if code != 409 {
		t.Fatal("stale HTTP review overwrote source", code)
	}
	code, raw, _ = request("POST", "/lab/incidents/synthetic", testOrigin, session.CSRFToken, "http_synthetic_key_12345", report)
	if code != 201 {
		t.Fatal(code, string(raw))
	}
	var synthetic incidents.Incident
	_ = json.Unmarshal(raw, &synthetic)
	if synthetic.SourceType != "synthetic" || synthetic.VerificationStatus != "pending" {
		t.Fatal("synthetic provenance lost")
	}
	for _, invalid := range []any{map[string]any{"latitude": nil, "longitude": report.Longitude}, map[string]any{"latitude": report.Latitude, "longitude": report.Longitude, "source_type": "official"}} {
		code, _, _ = request("POST", "/v1/incidents/resolve", "", "", "", invalid)
		if code != 400 {
			t.Fatal("invalid location accepted", code)
		}
	}
	code, raw, _ = request("GET", "/v1/incidents?bbox=NaN,0,1,1", testOrigin, "", "", nil)
	if code != 400 {
		t.Fatal("nonfinite bbox accepted", code, string(raw))
	}
	code, _, _ = request("GET", "/v1/incidents?limit=201", testOrigin, "", "", nil)
	if code != 400 {
		t.Fatal("unbounded list accepted")
	}
	code, _, _ = request("GET", "/v1/incidents?offset=0&offset=1", testOrigin, "", "", nil)
	if code != 400 {
		t.Fatal("ambiguous repeated query accepted")
	}
	code, _, _ = request("GET", "/v1/incidents", "https://untrusted.example", "", "", nil)
	if code != 403 {
		t.Fatal("unauthorized browser origin accepted")
	}
	code, raw, _ = request("GET", "/v1/incidents/config", testOrigin, "", "", nil)
	if code != 200 {
		t.Fatal(code, string(raw))
	}
	var config incidents.ServiceInfo
	_ = json.Unmarshal(raw, &config)
	if config.Bounds != store.Info().Bounds || config.PhotoUploadsEnabled {
		t.Fatal("capabilities do not match service")
	}
	// Proxy identity headers do not bypass rate limits; client identity comes
	// from the socket and is retained only as an ephemeral hash in memory.
	for n := 0; n < 10; n++ {
		code, _, _ = request("POST", "/v1/incidents", "", "", fmt.Sprintf("network_replay_key_%04d", n), report)
		if code == 429 {
			break
		}
	}
	code, _, headers = request("POST", "/v1/incidents", "", "", "network_rate_overflow_123", report)
	if code != 429 || headers.Get("Retry-After") != "60" {
		t.Fatal("reception rate not exposed", code, headers)
	}
}

func TestIncidentServiceDisabledWithoutPersistentStore(t *testing.T) {
	m := newManager(t)
	server := httptest.NewServer(m)
	defer server.Close()
	res, err := server.Client().Get(server.URL + "/v1/incidents")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 503 {
		t.Fatal("temporary in-memory reception enabled without persistent store")
	}
}
